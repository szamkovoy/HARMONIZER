// @ts-nocheck
import { buildHistoryCompact, buildStatesMapCompact, logDTOSize } from "../_shared/dto.ts";
import { addDays, assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";
import { isPendingProposal, isRejectedRecently, PROPOSAL_TTL_DAYS } from "./proposal.ts";

const MIN_DAYS_BETWEEN_CALIBRATIONS = 7;
const MIN_USER_MESSAGES = 5;
const BATCH_SIZE = 50;

function compactUserMessages(messages: any[]): string {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => String(message.content ?? message.transcript ?? "").trim())
    .filter(Boolean)
    .slice(-40)
    .join("\n");
}

function fallbackDigest(messages: any[]) {
  const text = compactUserMessages(messages);
  const phrases = text
    .toLowerCase()
    .split(/[.!?\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  const repeatedHints = new Set(phrases.map((item) => item.split(/\s+/).slice(0, 4).join(" ")));
  const significantChanges = Math.min(5, Math.floor(messages.filter((message) => message.role === "user").length / 3));

  return {
    significantChanges: Math.max(significantChanges, repeatedHints.size >= 3 ? 3 : 0),
    summary: phrases.slice(0, 5).join("; "),
    proposedFocus: [],
    confidence: repeatedHints.size >= 3 ? 0.55 : 0.35,
    source: "heuristic",
  };
}

async function buildDigestWithGemini(db: any, userId: string, messages: any[], calibration: any | null) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return fallbackDigest(messages);

  const historyDTO = buildHistoryCompact(messages, 8000);
  const statesDTO = buildStatesMapCompact(calibration?.states_map ?? {});
  const historySize = logDTOSize("auto-calibrate.history", historyDTO, 2300);
  const statesSize = logDTOSize("auto-calibrate.states", statesDTO, 250);
  await logPromptSize(db, userId, {
    endpoint: "auto-calibrate",
    stage: "digest",
    history_tokens: historySize.tokens,
    states_tokens: statesSize.tokens,
    total_tokens: historySize.tokens + statesSize.tokens,
  });

  const userText = historyDTO.messages
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean)
    .join("\n");
  if (!userText) return fallbackDigest(messages);

  const prompt = `Ты анализируешь диалоги пользователя HARMONIZER для мягкого предложения калибровки.
Не меняй профиль сам. Нужно только понять, есть ли устойчивые новые паттерны за неделю.

Текущая states_map (compact):
${JSON.stringify(statesDTO)}

История диалога (compact):
${JSON.stringify(historyDTO)}

Верни строгий JSON:
{
  "significantChanges": 0..5,
  "summary": "1-2 тёплых предложения без диагностики",
  "proposedFocus": ["короткие темы"],
  "confidence": 0..1
}`;

  const model = Deno.env.get("GEMINI_PRO_MODEL") ?? "gemini-3.1-pro-preview";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!res.ok) {
    console.warn("[auto-calibrate] Gemini digest failed", res.status, await res.text().catch(() => ""));
    return fallbackDigest(messages);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  try {
    const parsed = JSON.parse(raw);
    return {
      significantChanges: Number(parsed.significantChanges ?? 0),
      summary: String(parsed.summary ?? ""),
      proposedFocus: Array.isArray(parsed.proposedFocus) ? parsed.proposedFocus.slice(0, 6) : [],
      confidence: Number(parsed.confidence ?? 0),
      source: model,
    };
  } catch (_error) {
    return fallbackDigest(messages);
  }
}

async function logPromptSize(db: any, userId: string, payload: Record<string, unknown>) {
  const { error } = await db.from("user_event_log").insert({
    user_id: userId,
    kind: "llm_prompt_size",
    payload,
  });
  if (error) console.warn("[auto-calibrate] Failed to log prompt size", error);
}

async function loadPreferences(db: any, userId: string) {
  const { data, error } = await db.from("user_settings").select("preferences").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data?.preferences ?? {};
}

async function loadMessagesSince(db: any, userId: string, since: string) {
  const { data: conversations, error: conversationsError } = await db
    .from("conversations")
    .select("id,started_at")
    .eq("user_id", userId)
    .gte("started_at", since)
    .order("started_at", { ascending: true })
    .limit(20);
  if (conversationsError) throw conversationsError;
  const ids = (conversations ?? []).map((item) => item.id);
  if (ids.length === 0) return [];

  const { data: messages, error: messagesError } = await db
    .from("messages")
    .select("conversation_id,role,content,transcript,created_at")
    .eq("user_id", userId)
    .in("conversation_id", ids)
    .order("created_at", { ascending: true });
  if (messagesError) throw messagesError;

  return messages ?? [];
}

async function saveProposal(db: any, userId: string, preferences: any, payload: any) {
  const now = new Date();
  const proposal = {
    ...payload,
    status: "pending",
    suggestedAt: now.toISOString(),
    createdAt: now.toISOString(),
    expiresAt: addDays(now, PROPOSAL_TTL_DAYS).toISOString(),
  };

  const nextPreferences = {
    ...preferences,
    autoCalibrationProposal: proposal,
  };

  const { error: settingsError } = await db
    .from("user_settings")
    .upsert({ user_id: userId, preferences: nextPreferences }, { onConflict: "user_id" });
  if (settingsError) throw settingsError;

  const { error: logError } = await db.from("user_event_log").insert({
    user_id: userId,
    kind: "calibration_suggested",
    payload: proposal,
  });
  if (logError) throw logError;
}

async function processCalibration(db: any, calibration: any) {
  const userId = calibration.user_id;
  const lastDate = calibration.last_calibration_date ?? calibration.created_at;
  if (!lastDate) return { status: "skipped", reason: "missing_last_calibration_date" };

  const ageDays = (Date.now() - new Date(lastDate).getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays < MIN_DAYS_BETWEEN_CALIBRATIONS) return { status: "skipped", reason: "too_recent" };

  const preferences = await loadPreferences(db, userId);
  const currentProposal = preferences?.autoCalibrationProposal;
  if (isPendingProposal(currentProposal)) return { status: "skipped", reason: "proposal_already_pending" };
  if (isRejectedRecently(currentProposal)) return { status: "skipped", reason: "rejected_cooldown" };

  const messages = await loadMessagesSince(db, userId, lastDate);
  const userMessages = messages.filter((message) => message.role === "user");
  if (userMessages.length < MIN_USER_MESSAGES) return { status: "skipped", reason: "not_enough_dialogue" };

  const digest = await buildDigestWithGemini(db, userId, messages, calibration);
  if (digest.significantChanges < 3 || digest.confidence < 0.45) {
    return { status: "skipped", reason: "no_significant_changes", digest };
  }

  await saveProposal(db, userId, preferences, {
    calibrationVersion: calibration.version,
    digest,
    conversationWindowStartedAt: lastDate,
    userMessageCount: userMessages.length,
  });

  return { status: "suggested", significantChanges: digest.significantChanges, userMessageCount: userMessages.length };
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    const { data: calibrations, error } = await db
      .from("user_calibrations")
      .select("id,user_id,version,states_map,last_calibration_date,created_at")
      .eq("is_active", true)
      .lte("last_calibration_date", addDays(new Date(), -MIN_DAYS_BETWEEN_CALIBRATIONS).toISOString())
      .order("last_calibration_date", { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw error;

    const results = [];
    for (const calibration of calibrations ?? []) {
      try {
        results.push({ userId: calibration.user_id, ...(await processCalibration(db, calibration)) });
      } catch (error) {
        console.error("[auto-calibrate] user failed", calibration.user_id, error);
        results.push({ userId: calibration.user_id, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }

    return json({
      ok: true,
      processed: results.length,
      suggestedCount: results.filter((item) => item.status === "suggested").length,
      results,
    });
  } catch (error) {
    console.error("[auto-calibrate]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
