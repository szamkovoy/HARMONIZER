import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import chakraStatesBaseline from "@/data/chakra_states_baseline.json";
import planetChakraMap from "@/data/planet_chakra_map.json";
import { decideTurnMode, ORCHESTRATOR_INSTRUCTIONS } from "@legacy/app/api/_utils/dialogArcOrchestrator";
import { effectiveDialogMax, chooseDialogBranches, type DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import { tonalRegisterForPlanet } from "@legacy/app/api/_utils/dialogTonalRegisters";
import { formatLifeSpheresBaselineForPrompt } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { normalizeCells } from "@legacy/app/api/_utils/lifeMatrix";
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
import { parseEventTime } from "@legacy/app/api/_utils/timeParser";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { getActivePrompt, renderPrompt } from "@legacy/app/api/_utils/prompts";
import { getScenario } from "@legacy/app/api/_utils/scenarios";
import { hoursToMs } from "@legacy/app/api/_utils/testMode";
import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
import { attachThumbnailToPracticeRecommendation } from "@legacy/app/api/_utils/vimeo";
import {
  isConversationExpired,
  loadHistory,
  summarizeConversationIfNeeded,
  type ConversationRecord,
  type MessageRecord,
} from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import {
  buildPracticeCardSummary,
  normalizeModelPracticeCardBlurb,
} from "@legacy/app/api/communicator/v2/dialog/practiceCardSummary";
import { loadDialogDailyContext } from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import {
  mergeUserProfileMemory,
  upsertConversationSummary,
  upsertDailyMatrixForDate,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import { choosePractice, publicPracticePickedPayload } from "@legacy/app/api/communicator/v2/dialog/practiceSelection";
import {
  clipDurationMinutesToSelectableMinutes,
  PRACTICE_CARD_DURATION_MISMATCH_THRESHOLD_MIN,
  selectableDurationMinutesForPracticeCard,
} from "@shared/assistantSelectableDurations";

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
  | "fast_track_final"
  | "post_recommendation"
  | "final_recommendation"
  | "final_recommendation_with_validation_warning";

const CHAKRA_LABEL_ACCUSATIVE_RU: Record<string, string> = {
  "Муладхара": "Муладхару",
  "Свадхистхана": "Свадхистхану",
  "Манипура": "Манипуру",
  "Анахата": "Анахату",
  "Вишуддха": "Вишудху",
  "Вишудха": "Вишудху",
  "Аджна": "Аджну",
  "Сахасрара": "Сахасрару",
};

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

function chakraLabelAccusative(label: string): string {
  return CHAKRA_LABEL_ACCUSATIVE_RU[label] ?? "";
}

function shouldEmitDialogV3DebugPrompt(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.DEBUG_DIALOG_PROMPT === "1") return true;
  const h = req.headers.get("x-debug-prompt");
  if (h === "1") return true;
  try {
    return new URL(req.url).searchParams.get("debug") === "prompt";
  } catch {
    return false;
  }
}

function expandOrchestratorInstruction(
  instruction: string,
  data: {
    chakraLabel: string;
    chakraLabelAccusative: string;
    harmoniousnessValue: number;
    harmoniousnessLabel: string;
    practiceRefusalCheck: string;
  },
) {
  return renderPrompt(instruction, {
    chakra_label: data.chakraLabel,
    chakra_label_accusative: data.chakraLabelAccusative,
    harmoniousness_value: data.harmoniousnessValue,
    harmoniousness_label: data.harmoniousnessLabel,
    practice_refusal_check: data.practiceRefusalCheck,
  });
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
    fast_track_final: "suggest_practice",
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

async function loadContext(db: SupabaseClient, userId: string, timezoneHint?: string) {
  return loadDialogDailyContext(db, userId, timezoneHint);
}

function buildDialogSystemInstruction(
  promptTemplate: string,
  context: LoadedContext,
  branches: DialogBranch[],
): {
  systemInstruction: string;
  planet: Planet;
  chakraLabel: string;
  chakraLabelAccusative: string;
  harmoniousnessValue: number;
  harmoniousnessLabel: "гармоничная" | "дисгармоничная" | "смешанная";
} {
  const forecast = context.forecast;
  if (!forecast) {
    throw new Response(JSON.stringify({ error: "Daily forecast not found" }), { status: 404 });
  }

  const locale = context.user.locale?.startsWith("en") ? "en" : "ru";
  const now = context.nowLocal;
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
        phase_time: context.phaseTime,
        branches: branches.join(",") || "none",
        due_events: formatDueEvents(context.dueEvents),
        matrix_ready: context.matrixReady ? "true" : "false",
        target_chakra: String(context.targetChakra.chakraNumber),
        target_explain: context.targetChakra.explain,
        top3_planets: formatTop3Planets(context.top3Planets),
        life_spheres_baseline: formatLifeSpheresBaselineForPrompt(context.user.locale),
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
        tonal_register: tonalRegisterForPlanet(planet),
        historical_context: "",
        user_self_description: "",
      },
    ),
    planet,
    chakraLabel: chakraMeta.chakra_name_ru,
    chakraLabelAccusative: chakraLabelAccusative(chakraMeta.chakra_name_ru),
    harmoniousnessValue,
    harmoniousnessLabel: harmoniousnessLabelValue,
  };
}

function formatDueEvents(events: LoadedContext["dueEvents"]): string {
  if (!events.length) return "none";
  return events
    .slice(0, 5)
    .map((event, index) => `${index + 1}. ${event.description} @ ${event.expected_at}`)
    .join("\n");
}

function formatTop3Planets(top3: LoadedContext["top3Planets"]): string {
  if (!top3.length) return "none";
  return top3
    .map((petal, index) => `${index + 1}. ${petal.planet} -> chakra ${petal.chakra_number}; H=${petal.harmoniousness}; S=${petal.strength}`)
    .join("\n");
}

function hoursSince(iso: string | null, nowLocal: DateTime): number | null {
  if (!iso) return null;
  const then = DateTime.fromISO(iso, { zone: nowLocal.zoneName ?? "UTC" });
  if (!then.isValid) return null;
  return nowLocal.diff(then, "hours").hours;
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
  conversationId: string,
) {
  if (!marker) return null;

  const validation = validateHistoryHasDurationAndType([
    ...history.filter((m) => m.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);

  const choose = await choosePractice(db, userId, marker, context, userMessage, history);
  if (!choose.picked) return null;

  const {
    picked,
    markerIdResolved,
    chakraId,
    preferredDurationMin,
    markerCatalogPracticeKind,
    historyKindConflictResolved,
  } = choose;

  const historyDurationMin =
    validation.confident && validation.durationSec != null ? Math.round(validation.durationSec / 60) : null;
  const markerDurationMin = marker.durationMin ?? null;

  let rawMinutes: number | null = null;
  if (validation.confident && validation.durationSec != null) {
    rawMinutes = Math.round(validation.durationSec / 60);
  } else {
    rawMinutes = markerDurationMin ?? preferredDurationMin;
  }

  const durationMismatchExceededThreshold =
    validation.confident &&
    markerDurationMin != null &&
    historyDurationMin != null &&
    Math.abs(markerDurationMin - historyDurationMin) > PRACTICE_CARD_DURATION_MISMATCH_THRESHOLD_MIN;

  const isYoga = picked.kind === "yoga";
  const selectable = !isYoga ? selectableDurationMinutesForPracticeCard(picked.kind) : [];

  let preClip = rawMinutes;
  if (preClip == null && !isYoga && selectable.length) {
    preClip = picked.durationSec
      ? Math.max(1, Math.round(picked.durationSec / 60))
      : picked.kind === "breath"
        ? 10
        : 3;
  }

  let finalDurationMin: number | null = preClip;
  let durationClipped = false;
  if (!isYoga && selectable.length && preClip != null) {
    const clip = clipDurationMinutesToSelectableMinutes(preClip, selectable);
    finalDurationMin = clip.value;
    durationClipped = clip.clipped;
  }

  const historyKindConflict = Boolean(historyKindConflictResolved);

  if (durationClipped || durationMismatchExceededThreshold || historyKindConflict) {
    console.log(
      `[PRACTICE_CARD_MISMATCH] ${JSON.stringify({
        markerDuration: markerDurationMin,
        historyDuration: historyDurationMin,
        markerKind: markerCatalogPracticeKind ?? null,
        historyKind: validation.practiceKind ?? null,
        finalDuration: finalDurationMin,
        finalKind: picked.kind,
        conversationId,
        durationClipped,
        durationMismatchExceededThreshold,
        historyKindConflictResolved: historyKindConflict,
      })}`,
    );
  }

  const canUseMarkerCardBlurb =
    Boolean(marker.cardBlurb)
    && !historyKindConflictResolved
    && (marker.id === "default" || markerIdResolved === true);
  const cardBlurb = canUseMarkerCardBlurb ? normalizeModelPracticeCardBlurb(marker.cardBlurb) : null;
  const cardReason = buildPracticeCardSummary({
    kind: picked.kind,
    slug: picked.slug,
    chakraIds: picked.chakraIds ?? [],
    locale: context.user.locale,
    userMessage,
    modelCardBlurb: cardBlurb,
  });
  const publicPayload = await attachThumbnailToPracticeRecommendation(
    publicPracticePickedPayload({ ...picked, reason: cardReason, card_blurb: cardBlurb }, cardReason),
    295,
  );
  // Йога/асаны: длительность и чакра задаются каталогом; не подмешиваем диалоговые preferred/marker.
  const overrides: { durationMin?: number | null; chakraIndex?: number } | undefined = isYoga
    ? undefined
    : {
        durationMin: finalDurationMin,
        chakraIndex: marker.chakra ?? chakraId,
      };
  return {
    ...publicPayload,
    ...(overrides ? { overrides } : {}),
    ...(markerIdResolved === false ? { markerIdResolved: false } : {}),
  };
}

function branchLabel(branches: DialogBranch[]): "planning" | "summarizing" | "both" | "free" | "none" {
  const hasSummarizing = branches.includes("summarizing");
  const hasPlanning = branches.includes("planning");
  if (hasSummarizing && hasPlanning) return "both";
  if (hasSummarizing) return "summarizing";
  if (hasPlanning) return "planning";
  return "free";
}

function resolveSummarizedEvent(ref: string, dueEvents: PlannedEventRow[]): PlannedEventRow | null {
  const normalizedRef = ref.trim().toLowerCase();
  if (!normalizedRef) return null;
  const direct = dueEvents.find((event) => event.id === ref.trim());
  if (direct) return direct;

  const index = Number.parseInt(normalizedRef, 10);
  if (Number.isInteger(index) && index >= 1 && index <= dueEvents.length) {
    return dueEvents[index - 1] ?? null;
  }

  return dueEvents.find((event) => event.description.toLowerCase().includes(normalizedRef)) ?? null;
}

async function persistDialogArtifacts(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  context: LoadedContext;
  branches: DialogBranch[];
  markers: ReturnType<typeof parseResponseMarkers>;
  assistantText: string;
  finalPracticePublic: Awaited<ReturnType<typeof resolvePracticePublic>> | null;
}) {
  const nowIso = params.context.nowLocal.toUTC().toISO() ?? new Date().toISOString();
  const timezone = params.context.user.tz ?? "UTC";
  const locale = params.context.user.locale ?? "ru";
  const effectiveBranches = [...new Set([...params.branches, ...(params.markers.planTomorrow ? ["planning" as const] : [])])];
  const relatedEventIds: string[] = [];
  const affectedDates = new Set<string>();
  const inferredCells = normalizeCells([
    ...params.markers.matrixCells,
    ...params.markers.plannedEvents.flatMap((event) => event.cells),
    ...params.markers.summarizeEvents.flatMap((event) => event.outcomeCells),
  ]);

  for (const event of params.markers.plannedEvents) {
    const parsedTime = parseEventTime({
      phrase: event.timeNorm ?? event.time ?? event.desc,
      nowLocal: params.context.nowLocal,
      tz: timezone,
      locale,
    });

    const insertPayload = {
      user_id: params.userId,
      conversation_id: params.conversationId,
      planned_at: nowIso,
      planned_local_date: parsedTime.expectedLocal.toFormat("yyyy-MM-dd"),
      expected_at: parsedTime.expectedUtc,
      time_phrase_raw: event.time ?? event.timeNorm,
      time_resolution: parsedTime.resolution,
      description: event.desc,
      context_snippets: event.snippets,
      cells: event.cells,
      status: "planned",
    };
    const { data, error } = await params.db.from("planned_events").insert(insertPayload).select("id,planned_local_date").single();
    if (error) throw error;
    if (data?.id) relatedEventIds.push(data.id as string);
    if (data?.planned_local_date) affectedDates.add(String(data.planned_local_date));
  }

  for (const summary of params.markers.summarizeEvents) {
    const resolved = resolveSummarizedEvent(summary.ref, params.context.dueEvents);
    if (!resolved) continue;
    const { error } = await params.db
      .from("planned_events")
      .update({
        status: "summarized",
        summarized_at: nowIso,
        outcome_cells: summary.outcomeCells,
        outcome_text: summary.outcome,
      })
      .eq("id", resolved.id);
    if (error) throw error;
    relatedEventIds.push(resolved.id);
    affectedDates.add(resolved.planned_local_date);
  }

  for (const localDate of affectedDates) {
    await upsertDailyMatrixForDate(params.db, params.userId, localDate, nowIso);
  }

  await upsertConversationSummary(params.db, {
    userId: params.userId,
    conversationId: params.conversationId,
    summaryText: params.assistantText,
    branch: branchLabel(effectiveBranches),
    phaseTime: params.context.phaseTime,
    relatedEventIds,
    matrixCells: inferredCells,
  });

  await mergeUserProfileMemory(params.db, params.userId, {
    currentGoals: params.markers.plannedEvents.map((event) => event.desc),
    lastPracticeFocusChakras: inferredCells.map((cell) => cell.chakra),
    recentPractices: params.finalPracticePublic?.id
      ? [{ id: params.finalPracticePublic.id, kind: params.finalPracticePublic.kind ?? null, created_at: nowIso }]
      : [],
  });

  return { effectiveBranches, relatedEventIds, inferredCells };
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

    const cutoffMs = Date.now() - hoursToMs(2);
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
      loadContext(db, userId, body.userTimezone),
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
    const branches = chooseDialogBranches({
      phaseTime: context.phaseTime,
      dueEventsCount: context.dueEvents.length,
      userMessage,
      hoursSinceLastPlanning: hoursSince(context.lastPlanningAt, context.nowLocal),
      planTomorrowMarker: false,
    });
    const systemPromptData = buildDialogSystemInstruction(systemPromptRecord.template, context, branches);
    const iteration = countAssistantTurns(history) + 1;
    const maxDialogLength = effectiveDialogMax(branches);
    const emitDebugPromptLog = shouldEmitDialogV3DebugPrompt(req);
    const turnDecision = decideTurnMode(
      history,
      iteration,
      maxDialogLength,
      isInitiate ? null : userMessage,
      emitDebugPromptLog,
    );
    const orchestratorPlaceholders = {
      chakraLabel: systemPromptData.chakraLabel,
      chakraLabelAccusative: systemPromptData.chakraLabelAccusative,
      harmoniousnessValue: systemPromptData.harmoniousnessValue,
      harmoniousnessLabel: systemPromptData.harmoniousnessLabel,
      practiceRefusalCheck: turnDecision.instructionVariables?.practice_refusal_check ?? "",
    };
    const expandedTurnInstruction = expandOrchestratorInstruction(turnDecision.instruction, orchestratorPlaceholders);
    const insightMetrics = buildInsightMetrics(history, userMessage, context.user.locale);

    console.log("[DIALOG_V3_DIAG]", JSON.stringify({
      conversationId: conversation.id,
      isInitiate,
      branches,
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
          const initialInstruction: GeminiContent = { role: "user", parts: [{ text: expandedTurnInstruction }] };
          const initialContents = [...prefixContents, initialInstruction];

          if (emitDebugPromptLog) {
            console.log("[DIALOG_V3_DEBUG_PROMPT]", JSON.stringify({
              systemInstruction: systemPromptData.systemInstruction,
              contents: initialContents,
            }));
          }

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
              const finalInstructionText = expandOrchestratorInstruction(
                validation.confident
                  ? ORCHESTRATOR_INSTRUCTIONS.final_recommendation
                  : ORCHESTRATOR_INSTRUCTIONS.final_recommendation_with_validation_warning,
                orchestratorPlaceholders,
              );
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
            readyMarkerTriggered,
            modelTierUsed,
          }));
          let markers = parseResponseMarkers(fullText);

          const isFinalMode = responseMode === "final_recommendation"
            || responseMode === "final_recommendation_with_validation_warning"
            || responseMode === "forced_final"
            || responseMode === "fast_track_final";
          if (!markers.practicePick && isFinalMode) {
            console.warn("[DIALOG_V3_DIAG] marker missing after premium — retry call");
            const retryInstruction: GeminiContent = { role: "user", parts: [{ text:
              `Ты только что написал финальную рекомендацию, но забыл маркер. Выведи ТОЛЬКО одну строку — технический маркер [PRACTICE_PICK: id="..." reason="..." card_blurb="..."] на основе рекомендации выше. В card_blurb дай связный текст карточки практики; не используй двойные кавычки внутри значения. Ничего больше не пиши.`
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
            conversation.id,
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

          const artifactResult = await persistDialogArtifacts({
            db: routeDb,
            userId: routeUserId,
            conversationId: conversation.id,
            context,
            branches,
            markers,
            assistantText: cleanText,
            finalPracticePublic,
          });

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
            dialog_branches: artifactResult.effectiveBranches,
            target_chakra: context.targetChakra,
            phase_time: context.phaseTime,
            related_event_ids: artifactResult.relatedEventIds,
            matrix_cells: artifactResult.inferredCells,
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
                branches: artifactResult.effectiveBranches,
                targetChakra: context.targetChakra,
                phaseTime: context.phaseTime,
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
