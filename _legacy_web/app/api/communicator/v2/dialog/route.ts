import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import chakraStatesBaseline from "@/data/chakra_states_baseline.json";
import planetChakraMap from "@/data/planet_chakra_map.json";
import { decideTurnMode, ORCHESTRATOR_INSTRUCTIONS } from "@legacy/app/api/_utils/dialogArcOrchestrator";
import { getMaxDialogLength } from "@legacy/app/api/_utils/dialogConfig";
import {
  generateGeminiText,
  getModelByHint,
  streamGeminiText,
  type GeminiContent,
} from "@legacy/app/api/_utils/gemini";
import { computeCSI, computeETV, detectTTMStage, estimateEmotionalValence } from "@legacy/app/api/_utils/insightDetection";
import {
  containsReadyMarker,
  parseResponseMarkers,
  sanitizeAssistantText,
  validateHistoryHasDurationAndType,
  type ValidationResult,
} from "@legacy/app/api/_utils/markers";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { getActivePrompt, renderPrompt } from "@legacy/app/api/_utils/prompts";
import { getScenario } from "@legacy/app/api/_utils/scenarios";
import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
import { attachThumbnailToPracticeRecommendation } from "@legacy/app/api/_utils/vimeo";
import {
  isConversationExpired,
  loadHistory,
  summarizeConversationIfNeeded,
  type ConversationRecord,
  type MessageRecord,
} from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import { choosePractice, publicPracticePickedPayload } from "@legacy/app/api/communicator/v2/dialog/practiceSelection";

export const runtime = "nodejs";

type DialogueUseCase = "calibration" | "daily_dialog";
type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";

type Body = {
  scenario_id?: string;
  conversationId?: string | null;
  useCase?: DialogueUseCase;
  entrySource?: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  userMessage?: string;
  userTimezone?: string;
  initiateDialog?: boolean;
};

type Planet = keyof typeof chakraStatesBaseline;
type ChakraBaseline = (typeof chakraStatesBaseline)[Planet];
type PlanetMeta = (typeof planetChakraMap)["planets"][Planet];
type LoadedContext = Awaited<ReturnType<typeof loadContext>>;
type ResponseMode =
  | "opening"
  | "inquiry"
  | "forced_final"
  | "post_recommendation"
  | "final_recommendation"
  | "final_recommendation_with_validation_warning";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function warnDeprecatedDialogRoute(req: Request): void {
  if (new URL(req.url).pathname.includes("/api/communicator/v2/dialog")) {
    console.warn("[DEPRECATED] /api/communicator/v2/dialog is deprecated. Use /api/ai/dialog with scenario_id.");
  }
}

function assertUseCase(useCase: unknown): DialogueUseCase {
  return useCase === "calibration" ? "calibration" : "daily_dialog";
}

async function resolveDialogueScenario(
  db: SupabaseClient,
  body: Pick<Body, "scenario_id" | "useCase">,
): Promise<{ useCase: DialogueUseCase; scenarioId: string | null }> {
  const scenarioId = body.scenario_id?.trim();
  if (!scenarioId) {
    const useCase = assertUseCase(body.useCase);
    return {
      useCase,
      scenarioId: useCase === "calibration" || useCase === "daily_dialog" ? useCase : null,
    };
  }

  const scenario = await getScenario(scenarioId, db);
  if (!scenario) throw new Response(JSON.stringify({ error: "Scenario not found" }), { status: 404 });
  if (scenario.scenario_type !== "dialogue") {
    throw new Response(JSON.stringify({ error: "Invalid scenario for dialog endpoint" }), { status: 400 });
  }
  if (!scenario.dialogue_use_case) {
    throw new Response(JSON.stringify({ error: "Scenario has no dialogue_use_case configured" }), { status: 500 });
  }
  return { useCase: assertUseCase(scenario.dialogue_use_case), scenarioId: scenario.id };
}

function planetMeta(planet: Planet): PlanetMeta {
  return planetChakraMap.planets[planet];
}

function normalizePlanet(value: unknown): Planet {
  return (typeof value === "string" && value in chakraStatesBaseline ? value : "Sun") as Planet;
}

function forecastHarmoniousness(forecast: LoadedContext["forecast"]): number {
  const planetState = (forecast?.today_planet_state ?? forecast?.todayPlanetState ?? {}) as {
    naturalHarmoniousness?: unknown;
    natural_harmoniousness?: unknown;
  };
  const value = typeof planetState.naturalHarmoniousness === "number"
    ? planetState.naturalHarmoniousness
    : typeof planetState.natural_harmoniousness === "number"
      ? planetState.natural_harmoniousness
      : 0;
  return Number.isFinite(value) ? value : 0;
}

function harmoniousnessLabel(value: number): "гармоничная" | "дисгармоничная" | "смешанная" {
  if (value > 0.3) return "гармоничная";
  if (value < -0.3) return "дисгармоничная";
  return "смешанная";
}

function timeOfDayForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "утро";
  if (hour >= 12 && hour < 17) return "день";
  if (hour >= 17 && hour < 22) return "вечер";
  return "ночь";
}

function formatLocalDate(dt: DateTime, locale: string): { dayOfWeek: string; date: string } {
  return {
    dayOfWeek: dt.setLocale(locale).toFormat("cccc"),
    date: dt.setLocale(locale).toFormat("d LLLL"),
  };
}

function listOrFallback(items: readonly string[] | undefined, fallback: string): string {
  return items && items.length ? items.join(", ") : fallback;
}

function joinLines(items: readonly string[] | undefined): string {
  return items && items.length ? items.join("\n") : "";
}

function textFromMessage(message: Pick<MessageRecord, "content" | "transcript">): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

function countAssistantTurns(history: MessageRecord[]): number {
  return history.filter((message) => message.role === "assistant").length;
}

function mapHistoryToGemini(history: MessageRecord[]): GeminiContent[] {
  return history
    .map((message) => {
      const text = textFromMessage(message);
      if (!text) return null;
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text }],
      } satisfies GeminiContent;
    })
    .filter((item): item is GeminiContent => Boolean(item));
}

function turnDecisionEvent(mode: ResponseMode, modelTier: "premium" | "standard") {
  const phaseMap: Record<ResponseMode, string> = {
    opening: "contextual_greeting",
    inquiry: "deepen_inquiry",
    forced_final: "suggest_practice",
    post_recommendation: "confirm_and_close",
    final_recommendation: "suggest_practice",
    final_recommendation_with_validation_warning: "suggest_practice",
  };
  return {
    mode,
    modelTier,
    next_phase: phaseMap[mode],
  };
}

function buildInsightMetrics(history: MessageRecord[], userMessage: string, locale?: string | null) {
  const language = (locale ?? "ru").slice(0, 2);
  const previousUserMessages = history
    .filter((message) => message.role === "user")
    .map((message) => textFromMessage(message))
    .filter(Boolean);
  const recentMessages = [...previousUserMessages, userMessage].slice(-5);
  const csiTrend = recentMessages.map((message) => computeCSI(message, language));
  const valenceTrend = recentMessages.map((message) => estimateEmotionalValence(message, language));
  const ttm = detectTTMStage(recentMessages, language);
  return {
    csi: csiTrend.at(-1) ?? 0,
    csi_trend: csiTrend,
    ttm_stage: ttm.stage,
    ttm_confidence: ttm.confidence,
    etv: computeETV(valenceTrend),
    valence_trend: valenceTrend,
  };
}

async function createConversation(
  db: SupabaseClient,
  userId: string,
  body: Required<Pick<Body, "entrySource" | "triggerMeta">> & Body,
  useCase: DialogueUseCase,
  scenarioId: string | null,
  extraMeta: Record<string, unknown> = {},
): Promise<ConversationRecord> {
  const { data, error } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      scenario_id: scenarioId,
      entry_source: body.entrySource,
      trigger_meta: {
        ...(body.triggerMeta ?? {}),
        use_case: useCase,
        ...extraMeta,
      },
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ConversationRecord;
}

async function loadConversation(
  db: SupabaseClient,
  userId: string,
  body: Required<Pick<Body, "entrySource" | "triggerMeta">> & Body,
  useCase: DialogueUseCase,
  scenarioId: string | null,
  timezone: string,
) {
  if (body.conversationId) {
    const { data, error } = await db
      .from("conversations")
      .select("*")
      .eq("id", body.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 });
    const conversation = data as ConversationRecord;
    if (!isConversationExpired(conversation, timezone)) return conversation;

    const summary = await summarizeConversationIfNeeded(db, userId, conversation.id);
    await db.from("conversations").update({ ended_at: new Date().toISOString() }).eq("id", conversation.id);
    return createConversation(db, userId, body, useCase, scenarioId, {
      reset_reason: "session_expired",
      previous_conversation_id: conversation.id,
      previous_conversation_summary: summary,
    });
  }

  return createConversation(db, userId, body, useCase, scenarioId);
}

async function loadContext(db: SupabaseClient, userId: string) {
  const [forecastResult, userResult] = await Promise.all([
    db
      .from("user_daily_forecasts")
      .select("*")
      .eq("user_id", userId)
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("users")
      .select("display_name,locale,address_form,tz,membership_tier,trial_expires_at")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (forecastResult.error) throw forecastResult.error;
  if (userResult.error) throw userResult.error;
  return {
    forecast: forecastResult.data as Record<string, unknown> | null,
    user:
      (userResult.data as {
        display_name?: string | null;
        locale?: string | null;
        address_form?: string | null;
        tz?: string | null;
        membership_tier?: string | null;
        trial_expires_at?: string | null;
      } | null) ?? {},
  };
}

function buildDialogSystemInstruction(
  promptTemplate: string,
  context: LoadedContext,
  userTimezone: string,
): {
  systemInstruction: string;
  planet: Planet;
  chakraLabel: string;
  harmoniousnessValue: number;
  harmoniousnessLabel: "гармоничная" | "дисгармоничная" | "смешанная";
} {
  const forecast = context.forecast;
  if (!forecast) {
    throw new Response(JSON.stringify({ error: "Daily forecast not found" }), { status: 404 });
  }

  const locale = context.user.locale?.startsWith("en") ? "en" : "ru";
  const now = DateTime.now().setZone(userTimezone || "UTC");
  const formatted = formatLocalDate(now, locale);
  const planet = normalizePlanet(forecast.planet_of_the_day);
  const chakraData = chakraStatesBaseline[planet] as ChakraBaseline;
  const chakraMeta = planetMeta(planet);
  const harmoniousnessValue = forecastHarmoniousness(forecast);
  const harmoniousnessLabelValue = harmoniousnessLabel(harmoniousnessValue);

  return {
    systemInstruction: renderPrompt(
      promptTemplate,
      {
        day_of_week: formatted.dayOfWeek,
        date: formatted.date,
        time_of_day: timeOfDayForHour(now.hour),
        local_hour: now.hour,
        chakra_label: chakraMeta.chakra_name_ru,
        planet,
        harmoniousness_label: harmoniousnessLabelValue,
        harmoniousness_value: Number(harmoniousnessValue.toFixed(2)),
        harmonic_states_pool: (chakraData.harmonicStates ?? []).slice(0, 12).join(", "),
        dissonant_states_pool: (chakraData.dissonantStates ?? []).slice(0, 12).join(", "),
        body_zones: listOrFallback(chakraData.body_zones, ""),
        endocrine: listOrFallback(chakraData.endocrine, "не выделена специфическая железа"),
        hormones: listOrFallback(chakraData.hormones, ""),
        nervous_system: listOrFallback(chakraData.nervous_system, ""),
        lexical_psychological: joinLines(chakraData.lexical_registers.psychological),
        lexical_somatic: joinLines(chakraData.lexical_registers.somatic),
        lexical_neurophysiological: joinLines(chakraData.lexical_registers.neurophysiological),
        lexical_pragmatic: joinLines(chakraData.lexical_registers.pragmatic),
        address_form: context.user.address_form === "informal" ? "ты" : "вы",
        historical_context: "",
        user_self_description: "",
      },
    ),
    planet,
    chakraLabel: chakraMeta.chakra_name_ru,
    harmoniousnessValue,
    harmoniousnessLabel: harmoniousnessLabelValue,
  };
}

async function maybeApplyRecommendationCorrection(
  db: SupabaseClient,
  forecastId: string | undefined,
  forecast: LoadedContext["forecast"],
  recommendationCorrection: { short_text?: string; windows_correction?: string } | null,
) {
  if (!recommendationCorrection || !forecastId) return;
  await db
    .from("user_daily_forecasts")
    .update({
      recommendation_short_text: recommendationCorrection.short_text ?? forecast?.recommendation_short_text,
      is_corrected_via_dialog: true,
      corrected_at: new Date().toISOString(),
    })
    .eq("id", forecastId);
}

async function resolvePracticePublic(
  db: SupabaseClient,
  userId: string,
  marker: ReturnType<typeof parseResponseMarkers>["practicePick"],
  context: LoadedContext,
  userMessage: string,
  history: MessageRecord[],
) {
  if (!marker) return null;
  const { picked, markerIdResolved } = await choosePractice(db, userId, marker, context, userMessage, history);
  if (!picked) return null;
  const publicPayload = await attachThumbnailToPracticeRecommendation(publicPracticePickedPayload(picked, marker.reason), 295);
  const overrides: { durationMin?: number; chakraIndex?: number } = {};
  if (marker.durationMin) overrides.durationMin = marker.durationMin;
  if (marker.chakra) overrides.chakraIndex = marker.chakra;
  return {
    ...publicPayload,
    ...(Object.keys(overrides).length ? { overrides } : {}),
    ...(markerIdResolved === false ? { markerIdResolved: false } : {}),
  };
}

async function persistAssistantMessage(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  useCase: DialogueUseCase;
  scenarioId: string | null;
  text: string;
  meta: Record<string, unknown>;
}) {
  const { data, error } = await params.db
    .from("messages")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      role: "assistant",
      content: params.text,
      content_type: "text",
      meta: {
        use_case: params.useCase,
        scenario_id: params.scenarioId,
        ...params.meta,
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function GET(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  try {
    warnDeprecatedDialogRoute(req);
    userId = await requireUserId(req);
    const url = new URL(req.url);
    db = createServiceSupabase();
    const { useCase, scenarioId } = await resolveDialogueScenario(db, {
      scenario_id: url.searchParams.get("scenario_id") ?? undefined,
      useCase: assertUseCase(url.searchParams.get("useCase") ?? undefined),
    });
    const entrySource = (url.searchParams.get("entrySource") as DialogueEntrySource | null) ?? "home";

    const context = await loadContext(db, userId);
    const userTimezone = context.user.tz ?? "UTC";
    const { data, error } = await db
      .from("conversations")
      .select("id,scenario_id,trigger_meta,entry_source,started_at,ended_at,last_message_at")
      .eq("user_id", userId)
      .eq("entry_source", entrySource)
      .is("ended_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10);
    if (error) throw error;

    const conversation = ((data ?? []) as ConversationRecord[]).find((item) => {
      const metaUseCase = typeof item.trigger_meta?.use_case === "string" ? item.trigger_meta.use_case : null;
      const scenarioMatches = !scenarioId || item.scenario_id === scenarioId || (!item.scenario_id && metaUseCase === useCase);
      return scenarioMatches && (!metaUseCase || metaUseCase === useCase) && !isConversationExpired(item, userTimezone);
    });
    if (!conversation) return json({ conversationId: null, messages: [], reset: true });

    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    const history = (await loadHistory(db, userId, conversation.id)).filter((message) => {
      const createdMs = Date.parse(message.created_at ?? "");
      return Number.isFinite(createdMs) && createdMs >= cutoffMs;
    });
    return json({
      conversationId: conversation.id,
      messages: history.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? message.transcript ?? "",
        createdAt: message.created_at ? Date.parse(message.created_at) : undefined,
        meta: {
          ...(message.meta ?? {}),
          practicePicked:
            (message.meta as { practicePicked?: unknown; practice_picked?: unknown } | null)?.practicePicked ??
            (message.meta as { practice_picked?: unknown } | null)?.practice_picked,
        },
      })),
      reset: history.length === 0,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/dialog",
      stage: "session_sync",
    });
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  try {
    warnDeprecatedDialogRoute(req);
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const isInitiate = Boolean(body.initiateDialog);
    const userMessage = isInitiate ? "" : String(body.userMessage ?? "").trim();
    if (!isInitiate && !userMessage) return json({ error: "userMessage is required" }, { status: 400 });

    db = createServiceSupabase();
    const { useCase, scenarioId } = await resolveDialogueScenario(db, body);
    if (useCase !== "daily_dialog") {
      return json({ error: "dialog v3 is implemented only for daily_dialog" }, { status: 400 });
    }

    endpointStage = "load_context";
    const [context, systemPromptRecord] = await Promise.all([
      loadContext(db, userId),
      getActivePrompt(db, "dialog_system_v3"),
    ]);
    const userTimezone = context.user.tz ?? body.userTimezone ?? "UTC";
    const conversation = await loadConversation(
      db,
      userId,
      {
        ...body,
        entrySource: body.entrySource ?? "home",
        triggerMeta: body.triggerMeta ?? {},
      },
      useCase,
      scenarioId,
      userTimezone,
    );
    const history = await loadHistory(db, userId, conversation.id);
    const systemPromptData = buildDialogSystemInstruction(systemPromptRecord.template, context, userTimezone);
    const iteration = countAssistantTurns(history) + 1;
    const maxDialogLength = getMaxDialogLength();
    const turnDecision = decideTurnMode(history, iteration, maxDialogLength);
    const insightMetrics = buildInsightMetrics(history, userMessage, context.user.locale);

    console.log("[DIALOG_V3_DIAG]", JSON.stringify({
      conversationId: conversation.id,
      isInitiate,
      historyLength: history.length,
      iteration,
      maxDialogLength,
      turnMode: turnDecision.mode,
      turnModelTier: turnDecision.modelTier,
      promptKey: systemPromptRecord.prompt_key,
      promptVersion: systemPromptRecord.version,
      systemPromptLen: systemPromptData.systemInstruction.length,
      userMessage: isInitiate ? "(none)" : userMessage.slice(0, 100),
    }));

    if (!isInitiate) {
      await db.from("messages").insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: userMessage,
        content_type: "text",
        meta: { use_case: useCase, scenario_id: scenarioId },
      });
    }

    const baseHistory = mapHistoryToGemini(history);
    const prefixContents = isInitiate
      ? [...baseHistory]
      : [...baseHistory, { role: "user", parts: [{ text: userMessage }] } as GeminiContent];
    const routeDb = db;
    const routeUserId = userId;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(sse("orchestrator_decision", turnDecisionEvent(turnDecision.mode, turnDecision.modelTier))));

          const standardModel = getModelByHint("standard");
          const premiumModel = getModelByHint("premium");
          const requestedModel = turnDecision.modelTier === "premium" ? premiumModel : standardModel;
          const initialInstruction: GeminiContent = { role: "user", parts: [{ text: turnDecision.instruction }] };
          const initialContents = [...prefixContents, initialInstruction];

          let fullText = "";
          let modelIdUsed = requestedModel;
          let modelTierUsed: "premium" | "standard" = turnDecision.modelTier;
          let responseMode: ResponseMode = turnDecision.mode;
          let readyMarkerTriggered = false;
          let validation: ValidationResult | null = null;

          if (turnDecision.modelTier === "premium") {
            for await (const chunk of streamGeminiText({
              systemInstruction: systemPromptData.systemInstruction,
              contents: initialContents,
              model: requestedModel,
              temperature: 0.85,
              maxOutputTokens: 2500,
            })) {
              modelIdUsed = chunk.modelUsed;
              fullText += chunk.text;
              controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
            }
            console.log("[DIALOG_V3_DIAG] premium stream done, fullText.length=", fullText.length);
          } else {
            console.log("[DIALOG_V3_DIAG] standard path: generating with model", requestedModel);
            const standardResponse = await generateGeminiText({
              systemInstruction: systemPromptData.systemInstruction,
              contents: initialContents,
              model: requestedModel,
              temperature: 0.85,
              maxOutputTokens: 1500,
            });
            modelIdUsed = standardResponse.modelUsed;
            console.log("[DIALOG_V3_DIAG] standard response:", JSON.stringify({
              modelUsed: standardResponse.modelUsed,
              textLength: standardResponse.text.length,
              first200: standardResponse.text.slice(0, 200),
              hasReadyMarker: containsReadyMarker(standardResponse.text),
            }));
            if (!containsReadyMarker(standardResponse.text)) {
              fullText = standardResponse.text;
            } else {
              readyMarkerTriggered = true;
              validation = validateHistoryHasDurationAndType([...history, { role: "user", content: userMessage }]);
              const finalInstructionText = validation.confident
                ? ORCHESTRATOR_INSTRUCTIONS.final_recommendation
                : ORCHESTRATOR_INSTRUCTIONS.final_recommendation_with_validation_warning;
              responseMode = validation.confident ? "final_recommendation" : "final_recommendation_with_validation_warning";
              modelTierUsed = "premium";
              const finalInstruction: GeminiContent = { role: "user", parts: [{ text: finalInstructionText }] };
              for await (const chunk of streamGeminiText({
                systemInstruction: systemPromptData.systemInstruction,
                contents: [...prefixContents, finalInstruction],
                model: premiumModel,
                temperature: 0.85,
                maxOutputTokens: 2500,
              })) {
                modelIdUsed = chunk.modelUsed;
                fullText += chunk.text;
                controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
              }
            }
          }

          console.log("[DIALOG_V3_DIAG] before sanitize:", JSON.stringify({
            fullTextLength: fullText.length,
            fullTextFirst200: fullText.slice(0, 200),
            fullTextLast200: fullText.slice(-200),
            hasPracticeMarker: /\[PRACTICE_PICK:/i.test(fullText),
            readyMarkerTriggered,
            modelTierUsed,
          }));
          let markers = parseResponseMarkers(fullText);

          const isFinalMode = responseMode === "final_recommendation"
            || responseMode === "final_recommendation_with_validation_warning"
            || responseMode === "forced_final";
          if (!markers.practicePick && isFinalMode) {
            console.warn("[DIALOG_V3_DIAG] marker missing after premium — retry call");
            const retryInstruction: GeminiContent = { role: "user", parts: [{ text:
              `Ты только что написал финальную рекомендацию, но забыл маркер. Выведи ТОЛЬКО одну строку — технический маркер [PRACTICE_PICK: id="..." reason="..."] на основе рекомендации выше. Ничего больше не пиши.`
            }] };
            const retryContents = [...prefixContents, { role: "model", parts: [{ text: fullText }] } as GeminiContent, retryInstruction];
            const retryResponse = await generateGeminiText({
              systemInstruction: systemPromptData.systemInstruction,
              contents: retryContents,
              model: premiumModel,
              temperature: 0.3,
              maxOutputTokens: 200,
            });
            const retryMarkers = parseResponseMarkers(retryResponse.text);
            if (retryMarkers.practicePick) {
              markers = { ...markers, practicePick: retryMarkers.practicePick };
              console.log("[DIALOG_V3_DIAG] marker recovered via retry:", retryMarkers.practicePick.id);
            } else {
              console.warn("[DIALOG_V3_DIAG] retry also failed to produce marker");
            }
          }

          const cleanText = sanitizeAssistantText(fullText, context.user.locale);
          console.log("[DIALOG_V3_DIAG] after sanitize: cleanText.length=", cleanText.length);

          if (!cleanText) {
            console.warn("[PREMIUM_EMPTY_RESPONSE]", JSON.stringify({
              iteration,
              turn_mode: responseMode,
              model_tier: modelTierUsed,
              model_id: modelIdUsed,
              raw_length: fullText.length,
              raw_first_200: fullText.slice(0, 200),
              had_practice_marker: Boolean(markers.practicePick),
            }));
            throw new Error("Premium model returned empty text after sanitization");
          }

          const finalPracticePublic = await resolvePracticePublic(
            routeDb,
            routeUserId,
            markers.practicePick,
            context,
            userMessage,
            history,
          );

          if (!readyMarkerTriggered && turnDecision.modelTier === "standard" && cleanText) {
            controller.enqueue(encoder.encode(sse("chunk", { text: cleanText, modelUsed: modelIdUsed })));
          }

          await maybeApplyRecommendationCorrection(
            routeDb,
            typeof context.forecast?.id === "string" ? context.forecast.id : undefined,
            context.forecast,
            markers.recommendationCorrection,
          );

          const shouldClose = responseMode === "forced_final";
          const assistantMeta = {
            turn_mode: responseMode,
            model_used: modelTierUsed,
            model_id: modelIdUsed,
            iteration,
            ready_marker_triggered: readyMarkerTriggered,
            validation,
            practicePicked: finalPracticePublic,
            practice_picked: finalPracticePublic,
            recommendationCorrected: markers.recommendationCorrection,
            insight_metrics: insightMetrics,
          };
          const messageId = await persistAssistantMessage({
            db: routeDb,
            userId: routeUserId,
            conversationId: conversation.id,
            useCase,
            scenarioId,
            text: cleanText,
            meta: assistantMeta,
          });

          if (shouldClose) {
            await routeDb.from("conversations").update({ ended_at: new Date().toISOString() }).eq("id", conversation.id);
          }

          controller.enqueue(
            encoder.encode(
              sse("complete", {
                conversationId: conversation.id,
                messageId,
                fullText: cleanText,
                shouldClose,
                modelUsed: modelIdUsed,
                modelTier: modelTierUsed,
                turnMode: responseMode,
                iteration,
                readyMarkerTriggered,
                validation,
                insightMetrics,
                practicePicked: finalPracticePublic ?? undefined,
                recommendationCorrected: markers.recommendationCorrection
                  ? { newShortText: markers.recommendationCorrection.short_text, ...markers.recommendationCorrection }
                  : undefined,
              }),
            ),
          );
          controller.close();
        } catch (error) {
          console.error("[DIALOG_V3_DIAG] STREAM ERROR:", error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : "");
          await reportRouteError(error, {
            db: routeDb,
            userId: routeUserId,
            endpoint: "communicator/v2/dialog",
            stage: "responder_stream",
            payload: {
              conversation_id: conversation.id,
              iteration,
              turn_mode: turnDecision.mode,
            },
          });
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/dialog",
      stage: endpointStage,
    });
    return errorResponse(error);
  }
}
