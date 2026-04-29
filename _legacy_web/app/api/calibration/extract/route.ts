import type { SupabaseClient } from "@supabase/supabase-js";
import type { NatalProfile } from "../../../../../modules/astro-core";
import baselineStatesJson from "../../../../data/chakra_states_baseline.json";
import { loadActiveNatalProfile, nextVersionFor } from "../../_utils/astro-db";
import {
  AVERAGING_WEIGHTS,
  averageCalibration,
  buildLexicon,
  buildStatesMap,
  type BaselineStates,
  type CalibrationExtraction,
  type CalibrationRow,
  type CalibrationSource,
  type UserLexicon,
  type StatesMap,
} from "../../_utils/calibration";
import { generateGeminiJson } from "../../_utils/gemini";
import { getActivePrompt, renderPrompt } from "../../_utils/prompts";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";

type ExtractBody = {
  source?: CalibrationSource;
  feedbackText?: string;
  conversationDigest?: unknown;
  language?: string;
  debugExtraction?: CalibrationExtraction;
};

type PreviousCalibration = {
  id: string;
  version: number;
  states_map?: StatesMap;
  user_lexicon?: UserLexicon;
  portrait?: string | null;
  portrait_chunks?: Record<string, string> | null;
};

function assertSource(source: unknown): CalibrationSource {
  if (source === "initial" || source === "manual_resync" || source === "auto_aggregated") return source;
  throw new Response(JSON.stringify({ error: "Invalid source. Must be initial, manual_resync, or auto_aggregated" }), { status: 400 });
}

async function loadActiveCalibration(db: SupabaseClient, userId: string): Promise<PreviousCalibration | null> {
  const { data, error } = await db
    .from("user_calibrations")
    .select("id,version,states_map,user_lexicon,portrait,portrait_chunks")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  return (data as PreviousCalibration | null) ?? null;
}

async function extractWithGemini(
  db: SupabaseClient,
  natalProfile: NatalProfile,
  previousCalibration: PreviousCalibration | null,
  body: ExtractBody,
): Promise<{ extraction: CalibrationExtraction; rawText: string; modelUsed: string }> {
  if (process.env.NODE_ENV !== "production" && body.debugExtraction) {
    return { extraction: body.debugExtraction, rawText: JSON.stringify(body.debugExtraction), modelUsed: "debugExtraction" };
  }

  const prompt = await getActivePrompt(db, "calibration_extraction");
  const rendered = renderPrompt(prompt.template, {
    natal_profile_json: natalProfile,
    baseline_states_json: baselineStatesJson,
    user_feedback_text: body.feedbackText ?? JSON.stringify(body.conversationDigest ?? {}),
    previous_calibration_json: previousCalibration ?? null,
    language: body.language ?? "ru",
  });

  const result = await generateGeminiJson<CalibrationExtraction>({
    prompt: rendered,
    model: prompt.model_hint,
    temperature: prompt.temperature,
    maxOutputTokens: prompt.max_output_tokens,
  });

  return { extraction: result.json, rawText: result.rawText, modelUsed: result.modelUsed };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function enableUltraMode(
  db: SupabaseClient,
  userId: string,
  calibration: { id: string; version: number; source: CalibrationSource },
): Promise<{ enabledUntil: string; source: string }> {
  const enabledUntil = addDays(new Date(), 3).toISOString();
  const { data: settings, error: readError } = await db
    .from("user_settings")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;

  const preferences =
    settings?.preferences && typeof settings.preferences === "object" && !Array.isArray(settings.preferences)
      ? settings.preferences
      : {};
  const nextPreferences = {
    ...preferences,
    ultraModeUntil: enabledUntil,
    ultraModeSource: "calibration",
    ultraModeCalibrationId: calibration.id,
    ultraModeCalibrationVersion: calibration.version,
    ultraModeCalibrationSource: calibration.source,
  };

  const { error: writeError } = await db
    .from("user_settings")
    .upsert({ user_id: userId, preferences: nextPreferences }, { onConflict: "user_id" });
  if (writeError) throw writeError;

  return { enabledUntil, source: "calibration" };
}

function toApiShape(row: CalibrationRow & { id: string; based_on_version: number | null; last_calibration_date: string; created_at: string }) {
  return {
    id: row.id,
    version: row.version,
    source: row.source,
    basedOnVersion: row.based_on_version ?? undefined,
    S_calibrated: row.s_calibrated,
    H_calibrated: row.h_calibrated,
    deltaFromInitial: row.delta_from_initial,
    states_map: row.states_map,
    user_lexicon: row.user_lexicon,
    portrait: row.portrait,
    portraitChunks: row.portrait_chunks,
    lastCalibrationDate: row.last_calibration_date,
    createdAt: row.created_at,
  };
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as ExtractBody;
    const source = assertSource(body.source);

    if (source !== "auto_aggregated" && !body.feedbackText?.trim() && !body.debugExtraction) {
      return json({ error: "feedbackText is required" }, { status: 400 });
    }
    if (source === "auto_aggregated" && !body.conversationDigest && !body.feedbackText?.trim() && !body.debugExtraction) {
      return json({ error: "conversationDigest or feedbackText is required" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const [{ profile: natalProfile }, previousCalibration] = await Promise.all([
      loadActiveNatalProfile(db, userId),
      loadActiveCalibration(db, userId),
    ]);

    const { extraction, rawText, modelUsed } = await extractWithGemini(db, natalProfile, previousCalibration, body);
    const averaged = averageCalibration(natalProfile, extraction, source);
    const statesMap = buildStatesMap(extraction, baselineStatesJson as BaselineStates, previousCalibration);
    const userLexicon = buildLexicon(extraction, previousCalibration, source);
    const version = await nextVersionFor(db, "user_calibrations", userId);
    const basedOnVersion = previousCalibration?.version ?? null;
    const now = new Date().toISOString();

    const { error: deactivateError } = await db
      .from("user_calibrations")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;

    const { data, error } = await db
      .from("user_calibrations")
      .insert({
        user_id: userId,
        version,
        source,
        based_on_version: basedOnVersion,
        is_active: true,
        s_calibrated: averaged.S_calibrated,
        h_calibrated: averaged.H_calibrated,
        delta_from_initial: averaged.deltaFromInitial,
        states_map: statesMap,
        user_lexicon: userLexicon,
        raw_feedback: {
          source,
          feedbackText: body.feedbackText ?? null,
          conversationDigest: body.conversationDigest ?? null,
          language: body.language ?? "ru",
          extraction,
          llmRawResponse: rawText,
          modelUsed,
        },
        portrait: previousCalibration?.portrait ?? null,
        portrait_chunks: previousCalibration?.portrait_chunks ?? null,
        last_calibration_date: now,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { error: cacheError } = await db
      .from("user_daily_forecasts")
      .delete()
      .eq("user_id", userId)
      .gte("forecast_date", todayIsoDate());
    if (cacheError) throw cacheError;

    const ultraMode = await enableUltraMode(db, userId, {
      id: data.id,
      version: data.version,
      source,
    });

    return json({
      calibration: toApiShape(data as CalibrationRow & { id: string; based_on_version: number | null; last_calibration_date: string; created_at: string }),
      ultraMode,
      debug:
        process.env.NODE_ENV === "production"
          ? undefined
          : {
              llmRawResponse: extraction,
              averagingProportion: AVERAGING_WEIGHTS[source],
              beforeAfterComparison: averaged.debug,
              newPhrasesAdded: userLexicon.phrases.filter((phrase) => phrase.source === `calibration_${source}`).length,
              statesAdded: Object.values(statesMap).reduce(
                (sum, item) =>
                  sum +
                  item.positive_states.filter((state) => state.source === "user_added").length +
                  item.negative_states.filter((state) => state.source === "user_added").length,
                0,
              ),
              statesRejected: Object.values(statesMap).reduce((sum, item) => sum + item.rejected_states.length, 0),
            },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
