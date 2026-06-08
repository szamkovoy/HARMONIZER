import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import chakraStatesBaseline from "@/data/chakra_states_baseline.json";
import planetChakraMap from "@/data/planet_chakra_map.json";
import { decideTurnMode, ORCHESTRATOR_INSTRUCTIONS, shouldServerEscalateToFinalRecommendation } from "@legacy/app/api/_utils/dialogArcOrchestrator";
import { effectiveDialogMax, chooseDialogBranches, type DialogBranch } from "@legacy/app/api/_utils/dialogBranching";
import { openingDayQuestionForContext } from "@legacy/app/api/_utils/dialogOpeningHints";
import { tonalRegisterForPlanet } from "@legacy/app/api/_utils/dialogTonalRegisters";
import { formatLifeSpheresBaselineForPrompt } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { normalizeCells } from "@legacy/app/api/_utils/lifeMatrix";
import {
  ensureDialogCache,
  generateGeminiText,
  getModelByHint,
  supportsExplicitLlmCache,
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
import { effectiveDialogNowLocal, isDebugDialogExportEnabled, promptLocalHour, sessionResumeTtlMs } from "@legacy/app/api/_utils/testMode";
import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
import { attachThumbnailToPracticeRecommendation } from "@legacy/app/api/_utils/vimeo";
import { buildDialogStateAfter, buildTurnDebugExport, capturePlanningSnapshotIfNeeded, type PlanningPersistenceTurn } from "@legacy/app/api/communicator/v2/dialog/dialogDebugExport";
import {
  closeConversation,
  isConversationExpired,
  loadHistory,
  normalizeTurnHistory,
  resolveTurnHistory,
  summarizeConversationIfNeeded,
  type ConversationRecord,
  type MessageRecord,
  type TurnHistoryItem,
} from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";
import {
  buildPracticeCardSummary,
  normalizeModelPracticeCardBlurb,
} from "@legacy/app/api/communicator/v2/dialog/practiceCardSummary";
import { likelyAnsweredDueEventIds, shouldRetryForMissingSummaryMarker } from "@legacy/app/api/communicator/v2/dialog/summaryRepair";
import { loadDialogDailyContext } from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import {
  asMatrixCells,
  deletePlannedEventsByIds,
  loadOpenPlannedEventsForUserHorizon,
  upsertConversationSummary,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import {
  DUE_SUMMARY_STATE_KEY,
  readDueSummaryState,
  resolveDueSummaryTurn,
  selectDueEventsForTurn,
  type DueSummaryState,
} from "@legacy/app/api/communicator/v2/dialog/dueSummaryState";
import {
  filterNewPlannedEvents,
  inferPlannedEventsFromUserHistory,
  mergePlannedEventMarkers,
} from "@legacy/app/api/_utils/plannedEventInference";
import { choosePractice, publicPracticePickedPayload } from "@legacy/app/api/communicator/v2/dialog/practiceSelection";
import {
  enqueueSummaryCandidates,
  enqueuePlanningCandidates,
  pendingSummaryEventIds,
  reconcilePendingPlanningCandidates,
} from "@legacy/app/api/communicator/v2/dialog/planningReconciliation";
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
  turnHistory?: TurnHistoryItem[];
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
  | "final_without_practice"
  | "post_recommendation"
  | "practice_repick"
  | "final_recommendation"
  | "final_recommendation_with_validation_warning";
type ResponseMarkers = ReturnType<typeof parseResponseMarkers>;

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
    catalogReconciliation: string;
    openingDayQuestion: string;
  },
) {
  return renderPrompt(instruction, {
    chakra_label: data.chakraLabel,
    chakra_label_accusative: data.chakraLabelAccusative,
    harmoniousness_value: data.harmoniousnessValue,
    harmoniousness_label: data.harmoniousnessLabel,
    practice_refusal_check: data.practiceRefusalCheck,
    catalog_reconciliation: data.catalogReconciliation,
    opening_day_question: data.openingDayQuestion,
  });
}

type OrchestratorInstructionPlaceholders = Parameters<typeof expandOrchestratorInstruction>[1];

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
    final_without_practice: "confirm_and_close",
    practice_repick: "suggest_practice",
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
    await closeConversation(db, userId, conversation.id);
    return createConversation(db, userId, body, useCase, scenarioId, {
      reset_reason: "session_expired",
      previous_conversation_id: conversation.id,
      previous_conversation_summary: summary,
    });
  }

  return createConversation(db, userId, body, useCase, scenarioId);
}

async function loadContext(
  db: SupabaseClient,
  userId: string,
  timezoneHint?: string,
  triggerMeta?: Record<string, unknown>,
) {
  const summaryDate = triggerMeta?.daySummaryRequested === true && typeof triggerMeta.workingLocalDate === "string"
    ? triggerMeta.workingLocalDate
    : null;
  return loadDialogDailyContext(db, userId, timezoneHint, { summarizeWholeLocalDate: summaryDate });
}

function buildDialogSystemInstruction(
  promptTemplate: string,
  context: LoadedContext,
  branches: DialogBranch[],
  openPlannedEventsForUserHorizon: PlannedEventRow[],
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
  const promptHour = promptLocalHour(now.hour);
  const formatted = formatLocalDate(now, locale);
  const planet = normalizePlanet(forecast.planet_of_the_day);
  const chakraData = chakraStatesBaseline[planet] as ChakraBaseline;
  const chakraMeta = planetMeta(planet);
  const harmoniousnessValue = forecastHarmoniousness(forecast);
  const harmoniousnessLabelValue = harmoniousnessLabel(harmoniousnessValue);
  const branchGuardrails: string[] = [
    "ДОПОЛНИТЕЛЬНЫЕ SERVER-SIDE GUARDRAILS:",
  ];
  if (branches.includes("planning")) {
    branchGuardrails.push(
      "- planning не должен превращаться в сбор всего расписания: держи фокус на 1-3 самых важных событиях;",
      "- собирай один конкретный эпизод за раз; если пользователь уже назвал 2-3 важных события, не добирай новые ради полноты;",
      "- существующие open plans используй как память для dedupe/update, а не как повод продолжать длинный опрос обо всём дне;",
      "- в planning спрашивай только о действиях/событиях; не спрашивай, какие состояния человек хочет проявить, что цепляет сильнее или какой психологический подтекст у события;",
      "- не уточняй расплывчатое время вроде «первая/вторая половина дня», «после обеда», «вечером»: для новой вкладки «День» это больше не требуется;",
      "- ответы пользователя на вопрос о практике («движение телом», «дыхание», «медитация», «асаны», длительность практики) никогда не превращай в [PLANNED_EVENT];",
      "- для каждого [PLANNED_EVENT] добавляй recommendation=\"...\" — короткую, живую рекомендацию по этому конкретному действию в фокусе целевой чакры дня; именно этот текст будет показан во вкладке «День»;",
      "- для каждого [PLANNED_EVENT] добавляй display_order=\"1\", \"2\", \"3\" по порядку упоминания пользователем; не сортируй события по времени;",
      "- desc в [PLANNED_EVENT] — это короткое название действия для списка во вкладке «День», не длинное пересказывание; держи примерно 30-40 символов, а детали переноси в recommendation;",
      "- time/time_norm заполняй только при явно названном времени вроде «в 15:30» или «в 9 утра»; расплывчатые слова «вечером», «потом», «после обеда», «перед сном» не превращай во время для вкладки «День»;",
    );
  }
  if (branches.includes("summarizing")) {
    branchGuardrails.push(
      "- в summarizing спрашивай не только факт результата, но и как человек проживал событие, в каком состоянии действовал, получилось ли пройти его в рекомендованной волне или всё пошло привычно;",
      "- если описание слишком поверхностное, мягко уточни состояние/способ проживания, а уже потом переходи дальше;",
      "- если triggerMeta содержит dayPractices, учитывай практики йоги как поддержку дня: мягко отметь выполненные практики или, если их не было, объясни без давления, что йога помогает держать осознанность и энергию для нешаблонных действий, расширения матрицы состояний и толщины жизни;",
      "- финальное сообщение summarizing после сбора всех событий должно быть самостоятельной ценностью: сначала психологическая обратная связь по тому, насколько пользователь смог прожить день в рекомендованной чакре/состояниях, с чем справился и где остался привычный шаблон; затем 1-2 коротких наблюдения о йоге/здоровье только по переданным данным;",
      "- если Health-контекст говорит, что Apple/Google Health недоступен, не выдумывай шаги, сон, калории, тренировки и не упоминай конкретные цифры; используй только практики йоги из приложения и фразу без технических подробностей;",
    );
    if (context.dueEvents.length > 1) {
      branchGuardrails.push(
        "- если в due_events сейчас 2-3 события, не теряй оставшиеся: после первого подытоживания вернись к следующему due-событию перед переходом к чистой planning/practice части;",
      );
    }
  }
  branchGuardrails.push(
    "- если в разговоре есть 2-3 конкретных важных события, в финальном ответе можно дать по каждому короткий отдельный абзац с рекомендацией, в каком состоянии его лучше прожить;",
    "- если событие одно, сохраняй естественную цельную форму ответа без искусственной разбивки.",
    "- если событие одно, формулируй рекомендацию прямо как совет к действию, а не как предсказание: «когда будете делать X, держитесь Y и избегайте Z», без оборотов «день несёт» или «событие ложится на состояние»;",
    "- если событий несколько, сначала коротко назови общий фокус дня через целевую чакру, затем дай по каждому событию ровно один абзац; не разбивай одно событие на две туманные части;",
    "- для mixed / disharmonious дня не добавляй абстрактный риск вроде случайной «тени» сам по себе: называй только тот риск, который прямо связан с сегодняшней ситуацией пользователя и читается из baseline чакры;",
    "- если физиологический или эндокринный смысл уже объяснён в мостике к практике, не дублируй его отдельным абзацем ради симметрии.",
  );

  return {
    systemInstruction: `${renderPrompt(
      promptTemplate,
      {
        day_of_week: formatted.dayOfWeek,
        date: formatted.date,
        time_of_day: timeOfDayForHour(promptHour),
        local_hour: promptHour,
        phase_time: context.phaseTime,
        branches: branches.join(",") || "none",
        due_events: formatDueEvents(context.dueEvents, context.nowLocal, context.user.locale),
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
        historical_context: formatOpenPlansHistoricalContext({
          dueEvents: context.dueEvents,
          openPlans: openPlannedEventsForUserHorizon,
          nowLocal: context.nowLocal,
          locale: context.user.locale,
        }),
        user_self_description: "",
      },
    )}\n\n${branchGuardrails.join("\n")}`,
    planet,
    chakraLabel: chakraMeta.chakra_name_ru,
    chakraLabelAccusative: chakraLabelAccusative(chakraMeta.chakra_name_ru),
    harmoniousnessValue,
    harmoniousnessLabel: harmoniousnessLabelValue,
  };
}

function dueEventWhenLabel(
  event: Pick<PlannedEventRow, "expected_at" | "time_phrase_raw" | "time_resolution">,
  nowLocal: DateTime,
  locale?: string | null,
): string {
  const zone = nowLocal.zoneName ?? "UTC";
  const eventLocal = DateTime.fromISO(event.expected_at, { zone }).setZone(zone);
  if (!eventLocal.isValid) return event.expected_at;
  const localeSafe = locale?.startsWith("en") ? "en" : "ru";
  const dayDiff = Math.round(eventLocal.startOf("day").diff(nowLocal.startOf("day"), "days").days);
  const timeText = eventLocal.setLocale(localeSafe).toFormat("HH:mm");
  const approximateTime =
    event.time_resolution !== "explicit" && event.time_phrase_raw
      ? event.time_phrase_raw.trim()
      : null;

  if (localeSafe === "ru") {
    if (approximateTime) {
      return `${approximateTime} (время не уточнялось пользователем, ${timeText} служебное)`;
    }
    if (dayDiff === 0) return `сегодня около ${timeText}`;
    if (dayDiff === -1) return `вчера около ${timeText}`;
    return `${eventLocal.toFormat("dd.MM")} около ${timeText}`;
  }

  if (approximateTime) {
    return `${approximateTime} (user did not specify the exact time, ${timeText} is synthetic)`;
  }
  if (dayDiff === 0) return `today around ${timeText}`;
  if (dayDiff === -1) return `yesterday around ${timeText}`;
  return `${eventLocal.toFormat("dd.MM")} around ${timeText}`;
}

function formatDueEvents(events: LoadedContext["dueEvents"], nowLocal: DateTime, locale?: string | null): string {
  if (!events.length) return "none";
  return events
    .slice(0, 3)
    .map((event, index) => `${index + 1}. ${event.description} @ ${dueEventWhenLabel(event, nowLocal, locale)}`)
    .join("\n");
}

function formatOpenPlansHistoricalContext(params: {
  dueEvents: LoadedContext["dueEvents"];
  openPlans: PlannedEventRow[];
  nowLocal: DateTime;
  locale?: string | null;
}): string {
  const localeSafe = params.locale?.startsWith("en") ? "en" : "ru";
  const dueIds = new Set(params.dueEvents.map((event) => event.id));
  const today = params.nowLocal.toFormat("yyyy-MM-dd");
  const tomorrow = params.nowLocal.plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const formatPlan = (event: PlannedEventRow, index: number) => {
    const eventLocal = DateTime.fromISO(event.expected_at, { zone: params.nowLocal.zoneName ?? "UTC" })
      .setZone(params.nowLocal.zoneName ?? "UTC");
    const timeText = eventLocal.isValid ? eventLocal.toFormat("HH:mm") : "??:??";
    const approximateTime =
      event.time_resolution !== "explicit" && event.time_phrase_raw
        ? event.time_phrase_raw.trim()
        : null;
    const label = approximateTime
      ? (localeSafe === "ru"
          ? `${approximateTime} (время не уточнялось пользователем, ${timeText} служебное)`
          : `${approximateTime} (user did not specify the exact time, ${timeText} is synthetic)`)
      : timeText;
    return `${index + 1}. ${event.description} @ ${label}`;
  };
  const laterToday = params.openPlans
    .filter((event) => !dueIds.has(event.id) && event.planned_local_date === today)
    .slice(0, 3);
  const tomorrowPlans = params.openPlans
    .filter((event) => !dueIds.has(event.id) && event.planned_local_date === tomorrow)
    .slice(0, 3);
  const sections: string[] = [];

  if (params.dueEvents.length) {
    sections.push(
      localeSafe === "ru"
        ? `Уже наступили / готовы к подытоживанию:\n${formatDueEvents(params.dueEvents, params.nowLocal, params.locale)}`
        : `Due now / ready to summarize:\n${formatDueEvents(params.dueEvents, params.nowLocal, params.locale)}`,
    );
  }
  if (laterToday.length) {
    sections.push(
      localeSafe === "ru"
        ? `Открытые планы позже сегодня:\n${laterToday.map(formatPlan).join("\n")}`
        : `Open plans later today:\n${laterToday.map(formatPlan).join("\n")}`,
    );
  }
  if (tomorrowPlans.length) {
    sections.push(
      localeSafe === "ru"
        ? `Открытые планы на завтра:\n${tomorrowPlans.map(formatPlan).join("\n")}`
        : `Open plans for tomorrow:\n${tomorrowPlans.map(formatPlan).join("\n")}`,
    );
  }

  if (!sections.length) return "none";

  const guidance = localeSafe === "ru"
    ? "Используй этот сохранённый planning-context как реальную часть картины дня. Если здесь уже видно несколько конкретных планов, не вытягивай из пользователя ещё одну расплывчатую структуру дня, если он сам не ввёл новое явное событие."
    : "Use this stored planning context as a real part of the day picture. If it already shows several concrete plans, do not keep fishing for more vague schedule structure unless the user clearly introduces a new event.";

  return `${guidance}\n\n${sections.join("\n\n")}`;
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
  const validation = validateHistoryHasDurationAndType([
    ...history.filter((m) => m.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);

  if (!marker && !validation.confident) return null;

  const choose = await choosePractice(db, userId, marker, context, userMessage, history);
  if (!choose.picked) {
    console.warn(
      "[DIALOG_V3_DIAG] choosePractice returned null",
      JSON.stringify({
        conversationId,
        confident: validation.confident,
        practiceKind: validation.practiceKind,
        durationSec: validation.durationSec,
        hasMarker: Boolean(marker),
        markerId: marker?.id ?? null,
      }),
    );
    return null;
  }

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
  const markerDurationMin = marker?.durationMin ?? null;

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
    Boolean(marker?.cardBlurb)
    && !historyKindConflictResolved
    && (marker?.id === "default" || markerIdResolved === true);
  const cardBlurb = canUseMarkerCardBlurb ? normalizeModelPracticeCardBlurb(marker!.cardBlurb) : null;
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
        chakraIndex: marker?.chakra ?? chakraId,
      };
  return {
    ...publicPayload,
    ...(overrides ? { overrides } : {}),
    ...(markerIdResolved === false ? { markerIdResolved: false } : {}),
  };
}

function exactPracticeDurationInstruction(params: {
  validation: ValidationResult | null;
  locale: string | null | undefined;
}): string {
  const validation = params.validation;
  if (!validation?.confident || validation.durationSec == null || !validation.practiceKind) return "";
  const durationMin = Math.round(validation.durationSec / 60);
  const isEnglish = (params.locale ?? "ru").toLowerCase().startsWith("en");
  const kindLabel = isEnglish
    ? ({
        meditation: "meditation",
        breath: "breathing practice",
        yoga: "asana practice",
      } as const)[validation.practiceKind]
    : ({
        meditation: "медитация",
        breath: "дыхательная практика",
        yoga: "практика асан",
      } as const)[validation.practiceKind];
  return isEnglish
    ? `IMPORTANT FOR THIS TURN: the server already validated the requested practice as ${kindLabel} for exactly ${durationMin} min. In the visible text, especially in the bridge-to-practice block, mention only this type and this duration. Do not write a different duration.`
    : `ВАЖНО ДЛЯ ЭТОГО ХОДА: сервер уже подтвердил запрос пользователя на практику: ${kindLabel}, ровно ${durationMin} мин. В видимом тексте, особенно в мостике к практике, называй только этот тип и эту длительность. Не пиши другую длительность.`;
}

function buildFinalInstructionText(params: {
  baseInstruction: string;
  placeholders: OrchestratorInstructionPlaceholders;
  validation: ValidationResult | null;
  locale: string | null | undefined;
}): string {
  const base = expandOrchestratorInstruction(params.baseInstruction, params.placeholders);
  const durationLock = exactPracticeDurationInstruction({
    validation: params.validation,
    locale: params.locale,
  });
  return durationLock ? `${base}\n\n${durationLock}` : base;
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

function hasRequiredBranchArtifacts(
  branches: DialogBranch[],
  markers: ReturnType<typeof parseResponseMarkers>,
  planningArtifactCount = 0,
): boolean {
  if (branches.includes("planning") && markers.plannedEvents.length === 0 && planningArtifactCount === 0) return false;
  if (branches.includes("summarizing") && markers.summarizeEvents.length === 0) return false;
  return true;
}

function branchRepairInstruction(branches: DialogBranch[]): string {
  const parts: string[] = [];
  if (branches.includes("summarizing")) {
    parts.push("сначала коротко подведи итог по уже наступившему событию: что произошло и в каком состоянии человек это проживал, затем выведи invisible marker [SUMMARIZE_EVENT: ...]");
  }
  if (branches.includes("planning")) {
    parts.push("сначала выдели один ближайший планируемый эпизод на сегодня или завтра и выведи invisible marker [PLANNED_EVENT: ...] с временем или примерным временем");
  }
  return `Продолжи этот же диалог, но не переходи к рекомендации практики прямо сейчас. ${parts.join("; ")}. Не выводи [READY_FOR_RECOMMENDATION], пока эти маркеры не добавлены.`;
}

async function updateConversationTriggerMeta(
  db: SupabaseClient,
  userId: string,
  conversationId: string,
  triggerMeta: Record<string, unknown> | null | undefined,
  nextDueSummaryState: DueSummaryState | null,
): Promise<Record<string, unknown>> {
  const nextMeta = { ...(triggerMeta ?? {}) };
  if (nextDueSummaryState) {
    nextMeta[DUE_SUMMARY_STATE_KEY] = nextDueSummaryState;
  } else {
    delete nextMeta[DUE_SUMMARY_STATE_KEY];
  }
  const { error } = await db
    .from("conversations")
    .update({ trigger_meta: nextMeta })
    .eq("id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return nextMeta;
}

function formatDayTabTurnContext(triggerMeta: Record<string, unknown> | null | undefined): string {
  if (triggerMeta?.daySummaryRequested !== true) return "";
  const rawActions = Array.isArray(triggerMeta.dayActions) ? triggerMeta.dayActions : [];
  const rawPractices = Array.isArray(triggerMeta.dayPractices) ? triggerMeta.dayPractices : [];
  const dayHealthContext = formatDayHealthContext(triggerMeta.dayHealthContext);
  const actions = rawActions
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof (item as { title?: unknown }).title === "string"
        ? (item as { title: string }).title.trim()
        : "";
      const status = typeof (item as { status?: unknown }).status === "string"
        ? (item as { status: string }).status.trim()
        : "";
      return title ? `${index + 1}. ${title}${status ? ` (${status})` : ""}` : null;
    })
    .filter((value): value is string => Boolean(value));
  const practices = rawPractices
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof (item as { title?: unknown }).title === "string"
        ? (item as { title: string }).title.trim()
        : "";
      const durationSec = Number((item as { durationSec?: unknown }).durationSec);
      const minutes = Number.isFinite(durationSec) && durationSec > 0 ? `${Math.round(durationSec / 60)} мин` : "";
      return title ? `${title}${minutes ? ` (${minutes})` : ""}` : null;
    })
    .filter((value): value is string => Boolean(value));
  return [
    "[Контекст вкладки «День»: пользователь нажал «Подытожить этот день». Проведи подытоживание всех неподытоженных действий дня по очереди, не планируй завтра до закрытия прошлого дня.]",
    actions.length ? `Действия дня:\n${actions.join("\n")}` : "Действий в списке нет.",
    practices.length ? `Выполненные практики йоги:\n${practices.join("\n")}` : "Практики йоги в этот день пока не выполнялись.",
    dayHealthContext,
  ].join("\n\n");
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function comparisonLabel(value: unknown): string {
  if (value === "higher") return "выше обычного";
  if (value === "lower") return "ниже обычного";
  if (value === "similar") return "примерно как обычно";
  return "нет сравнения";
}

function formatMetric(label: string, metric: unknown, unit: string): string | null {
  if (!metric || typeof metric !== "object") return null;
  const item = metric as { value?: unknown; average?: unknown; comparison?: unknown };
  const value = numberOrNull(item.value);
  if (value == null) return null;
  const average = numberOrNull(item.average);
  const averageText = average == null ? "" : `, обычно около ${Math.round(average)} ${unit}`;
  return `${label}: ${Math.round(value)} ${unit}${averageText}, ${comparisonLabel(item.comparison)}`;
}

function formatDayHealthContext(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "Health-контекст: не передан. Не упоминай Apple Health / Google Health и не выдумывай шаги, сон, калории или тренировки.";
  }
  const context = value as {
    provider?: unknown;
    providerStatus?: unknown;
    yoga?: { totalMinutes?: unknown; practiceCount?: unknown; kinds?: unknown; averageDailyMinutes?: unknown; comparison?: unknown };
    activity?: { steps?: unknown; activeCalories?: unknown; workoutMinutes?: unknown };
    sleep?: { durationMinutes?: unknown; quality?: unknown };
  };
  const yoga = context.yoga && typeof context.yoga === "object" ? context.yoga : null;
  const yogaMinutes = numberOrNull(yoga?.totalMinutes) ?? 0;
  const yogaCount = numberOrNull(yoga?.practiceCount) ?? 0;
  const yogaAverage = numberOrNull(yoga?.averageDailyMinutes);
  const yogaKinds = Array.isArray(yoga?.kinds)
    ? yoga.kinds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const providerStatus =
    context.providerStatus === "available" ? "available" :
    context.providerStatus === "permission_denied" ? "permission_denied" :
    "unavailable";
  const lines = [
    "[Health-контекст для финального подытоживания дня: это временные данные только для текущего ответа, не сохраняй их и не превращай в отдельные действия.]",
    `Йога за день: ${yogaMinutes} мин, практик: ${yogaCount}${yogaKinds.length ? `, типы: ${yogaKinds.join(", ")}` : ""}${yogaAverage == null ? "" : `, обычно около ${yogaAverage} мин/день, ${comparisonLabel(yoga?.comparison)}`}.`,
  ];
  const metrics = [
    formatMetric("Шаги", context.activity?.steps, "шагов"),
    formatMetric("Активные калории", context.activity?.activeCalories, "ккал"),
    formatMetric("Тренировки/активность", context.activity?.workoutMinutes, "мин"),
    formatMetric("Сон", context.sleep?.durationMinutes, "мин"),
  ].filter((item): item is string => Boolean(item));
  if (metrics.length) {
    lines.push(`Apple/Google Health:\n${metrics.join("\n")}`);
  } else if (providerStatus === "permission_denied") {
    lines.push("Apple/Google Health доступен на устройстве, но пользователь не дал права: не называй шаги, сон, калории и тренировки; можно сказать только про практики йоги из приложения.");
  } else if (providerStatus === "unavailable") {
    lines.push("Apple/Google Health сейчас недоступен или не подключён: не называй шаги, сон, калории и тренировки; можно сказать только про практики йоги из приложения.");
  }
  return lines.join("\n");
}

function missingSummaryRepairInstruction(turnMode: ResponseMode, branches: DialogBranch[]): string {
  if (turnMode === "final_without_practice") {
    return "Пользователь уже описал итог наступившего события и одновременно отказался от практики. Сохрани короткий закрывающий ответ без практики, но обязательно добавь invisible marker [SUMMARIZE_EVENT: ...] по этому событию. Не выводи [PRACTICE_PICK] и [READY_FOR_RECOMMENDATION].";
  }
  return branchRepairInstruction(branches);
}

function turnModeCarriesPracticeCard(turnMode: ResponseMode): boolean {
  return turnMode === "final_recommendation"
    || turnMode === "final_recommendation_with_validation_warning"
    || turnMode === "forced_final"
    || turnMode === "fast_track_final"
    || turnMode === "practice_repick";
}

function isTerminalFinalTurnMode(turnMode: ResponseMode): boolean {
  return turnMode === "forced_final" || turnMode === "final_without_practice";
}

function messagePracticePickedMeta(message: Pick<MessageRecord, "meta">): Record<string, unknown> | null {
  const raw = (message.meta as { practicePicked?: unknown; practice_picked?: unknown } | null)?.practicePicked
    ?? (message.meta as { practice_picked?: unknown } | null)?.practice_picked;
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
}

function practiceDurationMinutesFromMeta(practicePicked: Record<string, unknown> | null): number | null {
  if (!practicePicked) return null;
  const overrides = practicePicked.overrides;
  if (overrides && typeof overrides === "object") {
    const durationMin = Number((overrides as { durationMin?: unknown }).durationMin);
    if (Number.isFinite(durationMin) && durationMin > 0) return durationMin;
  }
  const durationSec = Number(practicePicked.durationSec);
  if (Number.isFinite(durationSec) && durationSec > 0) return durationSec / 60;
  return null;
}

function userExplicitlyFinishedPractice(text: string): boolean {
  return /\b(?:выполнил(?:а|и)?|закончил(?:а|и)?|сделал(?:а|и)?|прош[её]л(?:а|и)?|completed|finished|done)\b/i.test(text);
}

function buildPostRecommendationTimingGuard(
  dbHistory: MessageRecord[],
  pendingUserMessage: string,
  now: Date = new Date(),
): string | null {
  if (!pendingUserMessage.trim() || userExplicitlyFinishedPractice(pendingUserMessage)) return null;
  const lastAssistantWithPractice = [...dbHistory]
    .reverse()
    .find((message) => message.role === "assistant" && messagePracticePickedMeta(message) && message.created_at);
  if (!lastAssistantWithPractice?.created_at) return null;
  const createdMs = Date.parse(lastAssistantWithPractice.created_at);
  if (!Number.isFinite(createdMs)) return null;
  const practiceDurationMin = practiceDurationMinutesFromMeta(messagePracticePickedMeta(lastAssistantWithPractice));
  if (!practiceDurationMin) return null;
  const elapsedMs = now.getTime() - createdMs;
  if (elapsedMs >= practiceDurationMin * 60_000) return null;
  return `ВАЖНО ДЛЯ ЭТОГО ХОДА: после показа карточки практики прошло меньше ${practiceDurationMin} мин., а пользователь ещё не сообщил, что уже завершил её. Не спрашивай, как прошла практика, не подводи её итог и не открывай новый опрос. Просто коротко ответь на текущую реплику и оставь фокус на самом выполнении практики.`;
}

function mergeResponseMarkersForPersistence(base: ResponseMarkers, carried: ResponseMarkers | null): ResponseMarkers {
  if (!carried) return base;

  const summarizeSeen = new Set<string>();
  const summarizeEvents = [...carried.summarizeEvents, ...base.summarizeEvents].filter((event) => {
    const key = `${event.ref}|${event.outcome ?? ""}|${JSON.stringify(event.outcomeCells)}`;
    if (summarizeSeen.has(key)) return false;
    summarizeSeen.add(key);
    return true;
  });

  const stateSeen = new Set<string>();
  const stateProposals = [...carried.stateProposals, ...base.stateProposals].filter((event) => {
    const key = `${event.proposed_planet}|${event.proposed_label}|${event.proposed_polarity}|${event.trigger_phrase ?? ""}`;
    if (stateSeen.has(key)) return false;
    stateSeen.add(key);
    return true;
  });

  return {
    stateProposals,
    practicePick: base.practicePick ?? carried.practicePick,
    recommendationCorrection: base.recommendationCorrection ?? carried.recommendationCorrection,
    plannedEvents: base.plannedEvents.length > 0 ? base.plannedEvents : carried.plannedEvents,
    summarizeEvents,
    planTomorrow: base.planTomorrow || carried.planTomorrow,
    matrixCells: normalizeCells([...carried.matrixCells, ...base.matrixCells]),
  };
}

function canPersistPlanningMarkers(turnMode: ResponseMode): boolean {
  return turnMode === "final_recommendation"
    || turnMode === "final_recommendation_with_validation_warning"
    || turnMode === "forced_final"
    || turnMode === "final_without_practice";
}

async function persistDialogArtifacts(params: {
  db: SupabaseClient;
  userId: string;
  conversationId: string;
  conversationTriggerMeta: Record<string, unknown> | null | undefined;
  context: LoadedContext;
  openPlannedEventsForUserHorizon: PlannedEventRow[];
  branches: DialogBranch[];
  markers: ReturnType<typeof parseResponseMarkers>;
  assistantText: string;
}) {
  const nowIso = params.context.nowLocal.toUTC().toISO() ?? new Date().toISOString();
  const effectiveBranches = [...new Set([...params.branches, ...(params.markers.planTomorrow ? ["planning" as const] : [])])];
  const relatedEventIds: string[] = [];
  const skippedPlannedEvents: PlanningPersistenceTurn["skipped"] = [];
  const queuedPlannedEvents: PlanningPersistenceTurn["queued"] = [];
  const queuedSummaries: PlanningPersistenceTurn["queued_summaries"] = [];
  const insertedPlannedEvents: PlanningPersistenceTurn["inserted"] = [];
  const updatedPlannedEvents: PlanningPersistenceTurn["updated"] = [];
  const summarizedPlannedEvents: PlanningPersistenceTurn["summarized"] = [];
  const inferredCells = normalizeCells([
    ...params.markers.matrixCells,
    ...params.markers.plannedEvents.flatMap((event) => event.cells),
    ...params.markers.summarizeEvents.flatMap((event) => event.outcomeCells),
  ]);
  let pendingTriggerMeta = params.conversationTriggerMeta;
  if (params.markers.plannedEvents.length > 0) {
    const pendingPlanning = await enqueuePlanningCandidates({
      db: params.db,
      userId: params.userId,
      conversationId: params.conversationId,
      triggerMeta: pendingTriggerMeta,
      candidates: params.markers.plannedEvents,
      nowIso,
    });
    if (pendingPlanning) {
      pendingTriggerMeta = {
        ...(pendingTriggerMeta ?? {}),
        pending_planning_reconciliation: pendingPlanning,
      };
      queuedPlannedEvents.push(
        ...pendingPlanning.planning_candidates.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          desc: candidate.desc,
          time: candidate.time,
          timeNorm: candidate.timeNorm,
          recommendation: candidate.recommendation,
          displayOrder: candidate.displayOrder,
          snippets: candidate.snippets,
          cells: candidate.cells,
          queued_at: candidate.queued_at,
        })),
      );
    }
  }

  const summaryQueuePayload: Array<{
    event: PlannedEventRow;
    outcome: string | null;
    proposedOutcomeCells: ReturnType<typeof asMatrixCells>;
  }> = [];
  for (const summary of params.markers.summarizeEvents) {
    const resolved = resolveSummarizedEvent(summary.ref, params.context.dueEvents);
    if (!resolved) continue;
    summaryQueuePayload.push({
      event: resolved,
      outcome: summary.outcome,
      proposedOutcomeCells: asMatrixCells(summary.outcomeCells),
    });
  }
  if (summaryQueuePayload.length > 0) {
    const pendingArtifacts = await enqueueSummaryCandidates({
      db: params.db,
      userId: params.userId,
      conversationId: params.conversationId,
      triggerMeta: pendingTriggerMeta,
      candidates: summaryQueuePayload,
      nowIso,
    });
    if (pendingArtifacts) {
      pendingTriggerMeta = {
        ...(pendingTriggerMeta ?? {}),
        pending_planning_reconciliation: pendingArtifacts,
      };
      queuedSummaries.push(
        ...pendingArtifacts.summary_candidates.map((candidate) => ({
          candidate_id: candidate.candidate_id,
          event_id: candidate.event_id,
          description: candidate.description,
          outcome: candidate.outcome,
          proposed_outcome_cells: candidate.proposed_outcome_cells,
          queued_at: candidate.queued_at,
        })),
      );
    }
  }

  const branch = branchLabel(effectiveBranches);
  if (branch !== "free" && branch !== "none") {
    await upsertConversationSummary(params.db, {
      userId: params.userId,
      conversationId: params.conversationId,
      summaryText: params.assistantText,
      branch,
      phaseTime: params.context.phaseTime,
      relatedEventIds,
      matrixCells: inferredCells,
    });
  }

  return {
    effectiveBranches,
    relatedEventIds,
    inferredCells,
    skippedPlannedEvents,
    nextTriggerMeta: pendingTriggerMeta ?? {},
    planningPersistence: {
      queued: queuedPlannedEvents,
      queued_summaries: queuedSummaries,
      inserted: insertedPlannedEvents,
      updated: updatedPlannedEvents,
      summarized: summarizedPlannedEvents,
      skipped: skippedPlannedEvents,
    } satisfies PlanningPersistenceTurn,
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
      content: null,
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
    const requestedConversationId = url.searchParams.get("conversationId")?.trim() || null;
    const debugExportEnabled = isDebugDialogExportEnabled();
    const debugExport = debugExportEnabled && url.searchParams.get("debugExport") === "1";

    const context = await loadContext(db, userId);
    const userTimezone = context.user.tz ?? "UTC";
    const resumeTtlMs = sessionResumeTtlMs();
    let conversation: ConversationRecord | undefined;
    if (requestedConversationId) {
      const { data, error } = await db
        .from("conversations")
        .select("id,scenario_id,trigger_meta,entry_source,started_at,ended_at,last_message_at")
        .eq("user_id", userId)
        .eq("id", requestedConversationId)
        .maybeSingle();
      if (error) throw error;
      const candidate = (data as ConversationRecord | null) ?? null;
      if (candidate) {
        const metaUseCase = typeof candidate.trigger_meta?.use_case === "string" ? candidate.trigger_meta.use_case : null;
        const scenarioMatches = !scenarioId || candidate.scenario_id === scenarioId || (!candidate.scenario_id && metaUseCase === useCase);
        const resumeAllowed =
          debugExport
          || (
            !candidate.ended_at
            && !isConversationExpired(candidate, userTimezone, new Date(), resumeTtlMs)
          );
        if (scenarioMatches && (!metaUseCase || metaUseCase === useCase) && resumeAllowed) {
          conversation = candidate;
        }
      }
    } else {
      const { data, error } = await db
        .from("conversations")
        .select("id,scenario_id,trigger_meta,entry_source,started_at,ended_at,last_message_at")
        .eq("user_id", userId)
        .eq("entry_source", entrySource)
        .is("ended_at", null)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(10);
      if (error) throw error;

      conversation = ((data ?? []) as ConversationRecord[]).find((item) => {
        const metaUseCase = typeof item.trigger_meta?.use_case === "string" ? item.trigger_meta.use_case : null;
        const scenarioMatches = !scenarioId || item.scenario_id === scenarioId || (!item.scenario_id && metaUseCase === useCase);
        return (
          scenarioMatches
          && (!metaUseCase || metaUseCase === useCase)
          && !isConversationExpired(item, userTimezone, new Date(), resumeTtlMs)
        );
      });
    }
    if (!conversation) return json({ conversationId: null, messages: [], reset: true });

    const planningHorizonLocalDates = [
      context.nowLocal.toFormat("yyyy-MM-dd"),
      context.nowLocal.plus({ days: 1 }).toFormat("yyyy-MM-dd"),
    ];
    if (!debugExport) {
      const reconciledPending = await reconcilePendingPlanningCandidates({
        db,
        userId,
        conversation,
        nowLocal: context.nowLocal,
        eventParseNowLocal: effectiveDialogNowLocal(context.nowLocal),
        eventParseRelativeNowLocal: context.nowLocal,
        timezone: userTimezone,
        locale: context.user.locale ?? "ru",
        dueEvents: context.dueEvents,
        planningHorizonLocalDates,
      });
      if (reconciledPending.triggerMeta) {
        conversation = {
          ...conversation,
          trigger_meta: reconciledPending.triggerMeta,
        };
      }
    }

    const rawHistory = await loadHistory(db, userId, conversation.id);
    const history = debugExport
      ? rawHistory
      : (() => {
        const cutoffMs = Date.now() - resumeTtlMs;
        return rawHistory.filter((message) => {
          const createdMs = Date.parse(message.created_at ?? "");
          return Number.isFinite(createdMs) && createdMs >= cutoffMs;
        });
      })();
    const dialogStateAfter =
      debugExport
        ? await buildDialogStateAfter(db, userId, conversation.id, context)
        : undefined;
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
      ...(debugExportEnabled ? { debugExportEnabled: true } : {}),
      ...(dialogStateAfter ? { dialogStateAfter } : {}),
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
    const [loadedContext, systemPromptRecord] = await Promise.all([
      loadContext(db, userId, body.userTimezone, body.triggerMeta),
      getActivePrompt(db, "dialog_system_v3"),
    ]);
    let context = loadedContext;
    const dialogNowLocal = effectiveDialogNowLocal(context.nowLocal);
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
    const dbHistory = await loadHistory(db, userId, conversation.id);
    const history = resolveTurnHistory(
      normalizeTurnHistory(body.turnHistory),
      dbHistory,
    );
    if (history.length === 0) {
      await capturePlanningSnapshotIfNeeded(
        db,
        userId,
        conversation.id,
        context,
        conversation.trigger_meta,
      );
    }
    const queuedSummaryIds = pendingSummaryEventIds(conversation.trigger_meta);
    if (queuedSummaryIds.size > 0) {
      context = {
        ...context,
        dueEvents: context.dueEvents.filter((event) => !queuedSummaryIds.has(event.id)),
      };
    }
    const dueSummaryState = readDueSummaryState(conversation.trigger_meta, context.dueEvents);
    context = {
      ...context,
      dueEvents: selectDueEventsForTurn(context.dueEvents, dueSummaryState),
    };
    const iteration = countAssistantTurns(history) + 1;
    const branches = conversation.trigger_meta?.daySummaryRequested === true && context.dueEvents.length > 0
      ? ["summarizing" as const]
      : chooseDialogBranches({
        phaseTime: context.phaseTime,
        dueEventsCount: context.dueEvents.length,
        userMessage,
        hoursSinceLastPlanning: hoursSince(context.lastPlanningAt, context.nowLocal),
        planTomorrowMarker: false,
        forcePlanningOnOpening: iteration === 1,
      });
    const maxDialogLength = effectiveDialogMax(branches);
    const planningHorizonLocalDates = [
      context.nowLocal.toFormat("yyyy-MM-dd"),
      context.nowLocal.plus({ days: 1 }).toFormat("yyyy-MM-dd"),
    ];
    const openPlannedEventsForUserHorizon = branches.includes("planning")
      ? (await loadOpenPlannedEventsForUserHorizon(db, userId, planningHorizonLocalDates))
        .filter((event) => !queuedSummaryIds.has(event.id))
      : [];
    const systemPromptData = buildDialogSystemInstruction(
      systemPromptRecord.template,
      context,
      branches,
      openPlannedEventsForUserHorizon,
    );
    const buildInferredPlannedEvents = () =>
      branches.includes("planning")
        ? inferPlannedEventsFromUserHistory({
            history: [
              ...history,
              ...(isInitiate ? [] : [{ role: "user" as const, content: userMessage }]),
            ],
            nowLocal: dialogNowLocal,
            relativeNowLocal: context.nowLocal,
            tz: userTimezone,
            locale: context.user.locale ?? "ru",
          })
        : [];
    const inferredPlanningArtifactsFromHistory = branches.includes("planning")
      ? filterNewPlannedEvents(buildInferredPlannedEvents(), openPlannedEventsForUserHorizon, {
          nowLocal: dialogNowLocal,
          relativeNowLocal: context.nowLocal,
          tz: userTimezone,
          locale: context.user.locale ?? "ru",
        })
      : [];
    const augmentPlannedMarkers = (markers: ReturnType<typeof parseResponseMarkers>) => ({
      ...markers,
      plannedEvents: filterNewPlannedEvents(
        markers.plannedEvents,
        openPlannedEventsForUserHorizon,
        {
          nowLocal: dialogNowLocal,
          relativeNowLocal: context.nowLocal,
          tz: userTimezone,
          locale: context.user.locale ?? "ru",
        },
      ),
    });
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
      catalogReconciliation: turnDecision.instructionVariables?.catalog_reconciliation ?? "",
      openingDayQuestion: openingDayQuestionForContext(context.phaseTime, branches),
    };
    const expandedTurnInstructionBase = expandOrchestratorInstruction(turnDecision.instruction, orchestratorPlaceholders);
    const postRecommendationTimingGuard = turnDecision.mode === "post_recommendation" && !isInitiate
      ? buildPostRecommendationTimingGuard(dbHistory, userMessage)
      : null;
    const dayTabTurnContext = formatDayTabTurnContext(conversation.trigger_meta);
    const expandedTurnInstruction = [
      expandedTurnInstructionBase,
      postRecommendationTimingGuard,
      dayTabTurnContext,
    ].filter((value): value is string => Boolean(value)).join("\n\n");
    const insightMetrics = buildInsightMetrics(history, userMessage, context.user.locale);
    const pendingTurnValidation = validateHistoryHasDurationAndType([
      ...history.filter((message) => message.role === "user"),
      ...(isInitiate ? [] : [{ role: "user" as const, content: userMessage }]),
    ]);
    const historyBranchArtifactsSatisfied =
      (!branches.includes("planning")
        || inferredPlanningArtifactsFromHistory.length > 0)
      && !branches.includes("summarizing");

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
        content: null,
        content_type: "text",
        meta: { use_case: useCase, scenario_id: scenarioId },
      });
    }

    const baseHistory = mapHistoryToGemini(history);
    const currentTurnPrefix = isInitiate
      ? []
      : [{ role: "user", parts: [{ text: userMessage }] } as GeminiContent];
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
          const initialContents = [...currentTurnPrefix, initialInstruction];
          const cachedContentByModel = new Map<string, Promise<string | null>>();
          const getCachedContentForModel = (modelId: string) => {
            if (!supportsExplicitLlmCache(modelId) || baseHistory.length === 0) return Promise.resolve<string | null>(null);
            const existing = cachedContentByModel.get(modelId);
            if (existing) return existing;
            const created = ensureDialogCache(
              conversation.id,
              systemPromptData.systemInstruction,
              baseHistory,
              modelId,
            );
            cachedContentByModel.set(modelId, created);
            return created;
          };
          const buildStructuredRequest = async (
            modelId: string,
            contents: GeminiContent[],
            temperature: number,
            maxOutputTokens: number,
          ) => {
            const cachedContent = await getCachedContentForModel(modelId);
            return cachedContent
              ? {
                  systemInstruction: systemPromptData.systemInstruction,
                  contents,
                  model: modelId,
                  temperature,
                  maxOutputTokens,
                  cachedContent,
                }
              : {
                  systemInstruction: systemPromptData.systemInstruction,
                  contents: [...baseHistory, ...contents],
                  model: modelId,
                  temperature,
                  maxOutputTokens,
                };
          };

          if (emitDebugPromptLog) {
            console.log("[DIALOG_V3_DEBUG_PROMPT]", JSON.stringify({
              systemInstruction: systemPromptData.systemInstruction,
              contents: [...baseHistory, ...initialContents],
            }));
          }

          let fullText = "";
          let modelIdUsed = requestedModel;
          let modelTierUsed: "premium" | "standard" = turnDecision.modelTier;
          let responseMode: ResponseMode = turnDecision.mode;
          let readyMarkerTriggered = false;
          let validation: ValidationResult | null = null;
          let carriedMarkers: ResponseMarkers | null = null;

          if (turnDecision.modelTier === "premium") {
            for await (const chunk of streamGeminiText(await buildStructuredRequest(
              requestedModel,
              initialContents,
              0.85,
              2500,
            ))) {
              modelIdUsed = chunk.modelUsed;
              fullText += chunk.text;
              controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
            }
            console.log("[DIALOG_V3_DIAG] premium stream done, fullText.length=", fullText.length);
          } else {
            const canBypassInquiryToFinalBeforeStandard = shouldServerEscalateToFinalRecommendation({
              turnMode: turnDecision.mode,
              validation: pendingTurnValidation,
              hasReadyMarker: false,
              hasRequiredBranchArtifacts: historyBranchArtifactsSatisfied,
            });
            if (canBypassInquiryToFinalBeforeStandard) {
              console.log("[DIALOG_V3_DIAG] bypassing standard inquiry and escalating directly from history");
              readyMarkerTriggered = true;
              validation = pendingTurnValidation;
              const finalInstructionText = buildFinalInstructionText({
                baseInstruction: ORCHESTRATOR_INSTRUCTIONS.final_recommendation,
                placeholders: orchestratorPlaceholders,
                validation,
                locale: context.user.locale,
              });
              responseMode = "final_recommendation";
              modelTierUsed = "premium";
              const finalInstruction: GeminiContent = { role: "user", parts: [{ text: finalInstructionText }] };
              for await (const chunk of streamGeminiText(await buildStructuredRequest(
                premiumModel,
                [...currentTurnPrefix, finalInstruction],
                0.85,
                2500,
              ))) {
                modelIdUsed = chunk.modelUsed;
                fullText += chunk.text;
                controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
              }
            } else {
            console.log("[DIALOG_V3_DIAG] standard path: generating with model", requestedModel);
            const standardResponse = await generateGeminiText(await buildStructuredRequest(
              requestedModel,
              initialContents,
              0.85,
              1500,
            ));
            modelIdUsed = standardResponse.modelUsed;
            console.log("[DIALOG_V3_DIAG] standard response:", JSON.stringify({
              modelUsed: standardResponse.modelUsed,
              textLength: standardResponse.text.length,
              first200: standardResponse.text.slice(0, 200),
              hasReadyMarker: containsReadyMarker(standardResponse.text),
            }));
            const turnValidation = pendingTurnValidation;
            const standardMarkers = augmentPlannedMarkers(parseResponseMarkers(standardResponse.text));
            const branchArtifactsSatisfied = hasRequiredBranchArtifacts(
              branches,
              standardMarkers,
              inferredPlanningArtifactsFromHistory.length,
            );
            if (!containsReadyMarker(standardResponse.text)) {
              if (shouldServerEscalateToFinalRecommendation({
                turnMode: turnDecision.mode,
                validation: turnValidation,
                hasReadyMarker: false,
                hasRequiredBranchArtifacts: branchArtifactsSatisfied,
              })) {
                console.log("[DIALOG_V3_DIAG] server-side ready escalation (confident inquiry without READY marker)");
                readyMarkerTriggered = true;
                validation = turnValidation;
                carriedMarkers = standardMarkers;
                const finalInstructionText = buildFinalInstructionText({
                  baseInstruction: ORCHESTRATOR_INSTRUCTIONS.final_recommendation,
                  placeholders: orchestratorPlaceholders,
                  validation,
                  locale: context.user.locale,
                });
                responseMode = "final_recommendation";
                modelTierUsed = "premium";
                const finalInstruction: GeminiContent = { role: "user", parts: [{ text: finalInstructionText }] };
                for await (const chunk of streamGeminiText(await buildStructuredRequest(
                  premiumModel,
                  [...currentTurnPrefix, finalInstruction],
                  0.85,
                  2500,
                ))) {
                  modelIdUsed = chunk.modelUsed;
                  fullText += chunk.text;
                  controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
                }
              } else {
                if (turnValidation.confident && !branchArtifactsSatisfied && turnDecision.mode === "inquiry") {
                  console.log("[DIALOG_V3_DIAG] blocking ready escalation until planning/summarizing markers appear");
                }
                const shouldRetryForMissingSummary = shouldRetryForMissingSummaryMarker({
                  branches,
                  summarizeEventsCount: standardMarkers.summarizeEvents.length,
                  userMessage,
                  dueEvents: context.dueEvents,
                });
                if (shouldRetryForMissingSummary) {
                  console.log("[DIALOG_V3_DIAG] retrying standard response to recover missing summary marker");
                  const repairedResponse = await generateGeminiText(await buildStructuredRequest(
                    requestedModel,
                    [...currentTurnPrefix, { role: "user", parts: [{ text: missingSummaryRepairInstruction(turnDecision.mode, branches) }] }],
                    0.7,
                    1500,
                  ));
                  modelIdUsed = repairedResponse.modelUsed;
                  fullText = repairedResponse.text;
                  carriedMarkers = augmentPlannedMarkers(parseResponseMarkers(repairedResponse.text));
                } else {
                  fullText = standardResponse.text;
                  carriedMarkers = standardMarkers;
                }
              }
            } else {
              if (!branchArtifactsSatisfied) {
                console.log("[DIALOG_V3_DIAG] ignoring premature READY marker until planning/summarizing markers appear");
                const repairedResponse = await generateGeminiText(await buildStructuredRequest(
                  requestedModel,
                  [...currentTurnPrefix, { role: "user", parts: [{ text: branchRepairInstruction(branches) }] }],
                  0.7,
                  1500,
                ));
                modelIdUsed = repairedResponse.modelUsed;
                fullText = repairedResponse.text;
                carriedMarkers = augmentPlannedMarkers(parseResponseMarkers(repairedResponse.text));
              } else {
              readyMarkerTriggered = true;
              validation = turnValidation;
              carriedMarkers = standardMarkers;
              const finalInstructionText = buildFinalInstructionText({
                baseInstruction: validation.confident
                  ? ORCHESTRATOR_INSTRUCTIONS.final_recommendation
                  : ORCHESTRATOR_INSTRUCTIONS.final_recommendation_with_validation_warning,
                placeholders: orchestratorPlaceholders,
                validation,
                locale: context.user.locale,
              });
              responseMode = validation.confident ? "final_recommendation" : "final_recommendation_with_validation_warning";
              modelTierUsed = "premium";
              const finalInstruction: GeminiContent = { role: "user", parts: [{ text: finalInstructionText }] };
              for await (const chunk of streamGeminiText(await buildStructuredRequest(
                premiumModel,
                [...currentTurnPrefix, finalInstruction],
                0.85,
                2500,
              ))) {
                modelIdUsed = chunk.modelUsed;
                fullText += chunk.text;
                controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed: modelIdUsed })));
              }
              }
            }
            }
          }

          console.log("[DIALOG_V3_DIAG] before sanitize:", JSON.stringify({
            fullTextLength: fullText.length,
            fullTextFirst200: fullText.slice(0, 200),
            readyMarkerTriggered,
            modelTierUsed,
          }));
          let markers = mergeResponseMarkersForPersistence(
            augmentPlannedMarkers(parseResponseMarkers(fullText)),
            carriedMarkers,
          );
          const markersForArtifacts = canPersistPlanningMarkers(responseMode)
            ? markers
            : { ...markers, plannedEvents: [] };

          const carriesPracticeCard = turnModeCarriesPracticeCard(responseMode);
          if (!markers.practicePick && carriesPracticeCard) {
            console.warn("[DIALOG_V3_DIAG] marker missing after premium — retry call");
            const retryInstruction: GeminiContent = { role: "user", parts: [{ text:
              `Ты только что написал финальную рекомендацию, но забыл маркер. Выведи ТОЛЬКО одну строку — технический маркер [PRACTICE_PICK: id="..." reason="..." card_blurb="..."] на основе рекомендации выше. В card_blurb дай связный текст карточки практики; не используй двойные кавычки внутри значения. Ничего больше не пиши.`
            }] };
            const retryContents = [...currentTurnPrefix, { role: "model", parts: [{ text: fullText }] } as GeminiContent, retryInstruction];
            const retryResponse = await generateGeminiText(await buildStructuredRequest(
              premiumModel,
              retryContents,
              0.3,
              320,
            ));
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

          const finalPracticePublic = carriesPracticeCard
            ? await resolvePracticePublic(
                routeDb,
                routeUserId,
                markers.practicePick,
                context,
                userMessage,
                history,
                conversation.id,
              )
            : null;

          if (
            carriesPracticeCard
            && !finalPracticePublic
          ) {
            const pickValidation = validateHistoryHasDurationAndType([
              ...history.filter((m) => m.role === "user"),
              { role: "user" as const, content: userMessage },
            ]);
            console.warn(
              "[DIALOG_V3_DIAG] finalPracticePublic null in final mode",
              JSON.stringify({
                responseMode,
                confident: pickValidation.confident,
                practiceKind: pickValidation.practiceKind,
                durationSec: pickValidation.durationSec,
                hasPracticeMarker: Boolean(markers.practicePick),
              }),
            );
          }

          if (!readyMarkerTriggered && turnDecision.modelTier === "standard" && cleanText) {
            controller.enqueue(encoder.encode(sse("chunk", { text: cleanText, modelUsed: modelIdUsed })));
          }

          const shouldClose = isTerminalFinalTurnMode(responseMode);
          const effectiveBranches = [...new Set([...branches, ...(markersForArtifacts.planTomorrow ? ["planning" as const] : [])])];
          const debugExport =
            isDebugDialogExportEnabled()
              ? buildTurnDebugExport({
                  rawAssistantText: fullText,
                  context,
                  branches,
                  practicePublic: carriesPracticeCard ? finalPracticePublic : null,
                })
              : undefined;

          const completePayload = {
            conversationId: conversation.id,
            fullText: cleanText,
            shouldClose,
            modelUsed: modelIdUsed,
            modelTier: modelTierUsed,
            turnMode: responseMode,
            iteration,
            readyMarkerTriggered,
            branches: effectiveBranches,
            targetChakra: context.targetChakra,
            phaseTime: context.phaseTime,
            validation,
            insightMetrics,
            practicePicked: carriesPracticeCard ? (finalPracticePublic ?? undefined) : undefined,
            recommendationCorrected: markers.recommendationCorrection
              ? { newShortText: markers.recommendationCorrection.short_text, ...markers.recommendationCorrection }
              : undefined,
            debugExport,
          };

          // Ship UI-critical fields before DB persistence so native XHR still receives
          // practicePicked even if the connection closes during slower artifact writes.
          controller.enqueue(encoder.encode(sse("complete", completePayload)));

          await maybeApplyRecommendationCorrection(
            routeDb,
            typeof context.forecast?.id === "string" ? context.forecast.id : undefined,
            context.forecast,
            markersForArtifacts.recommendationCorrection,
          );

          const artifactResult = await persistDialogArtifacts({
            db: routeDb,
            userId: routeUserId,
            conversationId: conversation.id,
            conversationTriggerMeta: conversation.trigger_meta,
            context,
            openPlannedEventsForUserHorizon,
            branches,
            markers: markersForArtifacts,
            assistantText: cleanText,
          });

          const answeredDueEventIds = [
            ...markers.summarizeEvents
            .map((summary) => resolveSummarizedEvent(summary.ref, context.dueEvents)?.id ?? null)
            .filter((eventId): eventId is string => Boolean(eventId)),
            ...likelyAnsweredDueEventIds(userMessage, context.dueEvents),
          ];
          const dueSummaryTurn = resolveDueSummaryTurn({
            existingState: dueSummaryState,
            selectedDueEvents: context.dueEvents,
            answeredEventIds: answeredDueEventIds,
            isInitiate,
            summarizingActive: branches.includes("summarizing"),
            nowIso: context.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
          });
          if (dueSummaryTurn.deleteEventIds.length > 0) {
            await deletePlannedEventsByIds(
              routeDb,
              routeUserId,
              dueSummaryTurn.deleteEventIds,
              context.nowLocal.toUTC().toISO() ?? new Date().toISOString(),
            );
          }
          await updateConversationTriggerMeta(
            routeDb,
            routeUserId,
            conversation.id,
            artifactResult.nextTriggerMeta,
            dueSummaryTurn.nextState,
          );

          const assistantMeta = {
            turn_mode: responseMode,
            model_used: modelTierUsed,
            model_id: modelIdUsed,
            iteration,
            ready_marker_triggered: readyMarkerTriggered,
            validation,
            practicePicked: carriesPracticeCard ? finalPracticePublic : null,
            practice_picked: carriesPracticeCard ? finalPracticePublic : null,
            recommendationCorrected: markers.recommendationCorrection,
            dialog_branches: artifactResult.effectiveBranches,
            target_chakra: context.targetChakra,
            phase_time: context.phaseTime,
            related_event_ids: artifactResult.relatedEventIds,
            matrix_cells: artifactResult.inferredCells,
            skipped_planned_events: artifactResult.skippedPlannedEvents,
            planning_persistence: artifactResult.planningPersistence,
            insight_metrics: insightMetrics,
            ...(debugExport ? { debug: debugExport } : {}),
          };
          const assistantMessageId = await persistAssistantMessage({
            db: routeDb,
            userId: routeUserId,
            conversationId: conversation.id,
            useCase,
            scenarioId,
            text: cleanText,
            meta: assistantMeta,
          });

          controller.enqueue(
            encoder.encode(
              sse("turn_artifacts", {
                messageId: assistantMessageId,
                planningPersistence: artifactResult.planningPersistence,
                relatedEventIds: artifactResult.relatedEventIds,
                skippedPlannedEvents: artifactResult.skippedPlannedEvents,
                matrixCells: artifactResult.inferredCells,
              }),
            ),
          );

          if (shouldClose) {
            await closeConversation(routeDb, routeUserId, conversation.id);
          }
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
