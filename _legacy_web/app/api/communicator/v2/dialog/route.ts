import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { chakraLabelAccusativeRu, chakraLabelGenitiveRu, chakraLabelRu } from "@/modules/chakra/labels";
import chakraStatesBaseline from "@/data/chakra_states_baseline.json";
import { tonalRegisterForPlanet } from "@legacy/app/api/_utils/dialogTonalRegisters";
import { formatLifeSpheresBaselineForPrompt } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import {
  getModelByHint,
  streamGeminiText,
  type GeminiContent,
} from "@legacy/app/api/_utils/gemini";
import {
  buildCatalogReconciliationInstruction,
  catalogDurationRangeForKind,
  catalogKindForDurationMin,
  parseResponseMarkers,
  sanitizeAssistantText,
  validateHistoryHasDurationAndType,
} from "@legacy/app/api/_utils/markers";
import { reportRouteError, toUserFacingStreamErrorMessage } from "@legacy/app/api/_utils/monitoring";
import { getScenario } from "@legacy/app/api/_utils/scenarios";
import { dialogTimeOfDayForHour } from "@legacy/app/api/_utils/dialogTimeOfDay";
import { promptLocalHour, sessionResumeTtlMs } from "@legacy/app/api/_utils/testMode";
import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
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
  loadDialogDailyContext,
  resolveSummarizingPromptContext,
  type DialogDailyContext,
} from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import {
  loadDuePlannedEvents,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import {
  advanceBranch,
  initFsmState,
  isLastBranch,
  readFsmState,
  summaryAskedCount,
  bumpSummaryAsked,
  writeFsmState,
  type DialogFsmState,
  type DialogTabMode,
} from "@legacy/app/api/communicator/v2/dialog/dialogFsm";
import {
  buildPlanningPrompt,
  buildPracticePrompt,
  buildSummarizingPrompt,
  buildPlanningAddFinalVisibleText,
  buildPlanningDeclinedReply,
  buildPlanningFinalVisibleText,
  buildPracticeClarificationFallback,
  extractDayFocusFromVisibleFinalize,
  injectPlanningActionsVisibleList,
  injectPlanningDayFocus,
  ensureSentencePunctuation,
  prependChakraAttention,
  replaceSpontaneousEnglishRu,
  polishPlanningMarker,
  containsPracticeDeclined,
  stripBrainSentinels,
  type BrainPromptContext,
} from "@legacy/app/api/communicator/v2/dialog/dialogBranchPrompts";
import {
  assistantFinalizeWithoutMarkers,
  buildPostDialogReply,
  coerceFsmBeforeTurn,
  extractPlanningMarkersFromVisibleFinalize,
  filterPracticeLikePlannedEvents,
  historyHasPracticePicked,
  isPostDialogTurn,
  practiceValidationForTurn,
  assistantAskedSummaryClarifyingQuestion,
  buildSummaryClarifyingQuestion,
  buildSummaryEventDidNotHappenBridge,
  userAnswerIsThinForSummary,
  userSaysEventDidNotHappen,
  userSignalsPlanningDone,
} from "@legacy/app/api/communicator/v2/dialog/dialogTurnGuards";
import {
  dismissPlannedEvents,
  persistDayFocus,
  persistPlanningFinalize,
  persistSummarizedEvent,
  type PersistedSummarizedEvent,
} from "@legacy/app/api/communicator/v2/dialog/dialogBrainPersistence";
import type { MatrixCell } from "@legacy/app/api/_utils/lifeMatrix";
import { resolveResponseLocale, resolveDialogScaffoldLocale, localeToLanguageName } from "@legacy/app/api/_utils/dialogLocale";
import { resolvePracticeCard } from "@legacy/app/api/communicator/v2/dialog/dialogPracticeCard";

export const runtime = "nodejs";

type DialogueUseCase = "calibration" | "daily_dialog";
type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding" | "day";

type Body = {
  scenario_id?: string;
  conversationId?: string | null;
  useCase?: DialogueUseCase;
  entrySource?: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  userMessage?: string;
  userTimezone?: string;
  /** Language the assistant should answer in (in-app selector); see dialogLocale.ts. */
  responseLocale?: string;
  initiateDialog?: boolean;
  turnHistory?: TurnHistoryItem[];
};

type LoadedContext = DialogDailyContext;
type TurnMode =
  | "opening"
  | "inquiry"
  | "final_recommendation"
  | "final_without_practice";

type SummarySessionItem = {
  id: string;
  description: string;
  planned_local_date: string;
  display_order: number | null;
  summarized_at: string;
  applied_to_matrix: boolean;
  outcome_cells: unknown;
  outcome_text: string | null;
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
    return { useCase, scenarioId: useCase };
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

// --- chakra-state lookup (target chakra -> planet baseline) ---------------------------------
const CHAKRA_TO_PLANET: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (const [planet, data] of Object.entries(chakraStatesBaseline as Record<string, { chakra_number?: number }>)) {
    const n = Number(data?.chakra_number);
    if (Number.isInteger(n)) map[n] = planet;
  }
  return map;
})();

function chakraStates(chakraNumber: number): { harmonic: string[]; dissonant: string[] } {
  const planet = CHAKRA_TO_PLANET[chakraNumber] ?? "Sun";
  const data = (chakraStatesBaseline as Record<string, { harmonicStates?: string[]; dissonantStates?: string[] }>)[planet];
  return {
    harmonic: Array.isArray(data?.harmonicStates) ? data!.harmonicStates! : [],
    dissonant: Array.isArray(data?.dissonantStates) ? data!.dissonantStates! : [],
  };
}

function buildBrainPromptContext(context: LoadedContext, promptLocalDate?: string | null): BrainPromptContext {
  const locale = resolveDialogScaffoldLocale(context.user.locale);
  const now = context.nowLocal;
  const promptHour = promptLocalHour(now.hour);
  const targetChakra = context.targetChakra.chakraNumber;
  const states = chakraStates(targetChakra);
  const planetOfDay = typeof context.forecast?.planet_of_the_day === "string" ? context.forecast.planet_of_the_day : "Sun";
  const promptDate = promptLocalDate && /^\d{4}-\d{2}-\d{2}$/.test(promptLocalDate)
    ? DateTime.fromISO(promptLocalDate, { zone: context.nowLocal.zoneName ?? "UTC" })
    : now;
  return {
    locale,
    languageName: localeToLanguageName(locale),
    addressForm: context.user.address_form === "informal" ? "ты" : "вы",
    dayOfWeek: promptDate.setLocale(locale).toFormat("cccc"),
    dateLabel: promptDate.setLocale(locale).toFormat("d LLLL"),
    timeOfDay: dialogTimeOfDayForHour(promptHour),
    localHour: promptHour,
    phaseTime: context.phaseTime,
    targetChakraNumber: targetChakra,
    targetChakraLabel: chakraLabelRu(targetChakra),
    targetChakraAccusative: chakraLabelAccusativeRu(targetChakra),
    targetChakraGenitive: chakraLabelGenitiveRu(targetChakra),
    targetChakraExplain: context.targetChakra.explain,
    harmonicStates: states.harmonic,
    dissonantStates: states.dissonant,
    planetOfDay,
    tonalRegister: tonalRegisterForPlanet(planetOfDay),
    lifeSpheresBaseline: formatLifeSpheresBaselineForPrompt(locale),
    planningSphereLens: context.planningSphereLens,
    existingDayFocus: null,
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatMetricForPrompt(label: string, value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const metric = value as { value?: unknown; average?: unknown; comparison?: unknown };
  const current = numberOrNull(metric.value);
  if (current == null) return null;
  const average = numberOrNull(metric.average);
  const comparison = typeof metric.comparison === "string" ? metric.comparison : "unknown";
  const averagePart = average != null ? `, average: ${Math.round(average)}` : "";
  const comparisonPart = comparison !== "unknown" ? `, comparison: ${comparison}` : "";
  return `${label}: ${Math.round(current)}${averagePart}${comparisonPart}`;
}

function sleepQualityLabelForPrompt(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    short: "сон был короче обычного",
    long: "сон был длиннее обычного",
    normal: "сон был обычной длительности",
    average: "сон был обычной длительности",
    good: "качество сна выглядело хорошим",
    fair: "качество сна выглядело средним",
    poor: "качество сна выглядело низким",
    restless: "сон был беспокойным",
    interrupted: "сон прерывался",
    unknown: "",
  };
  const label = labels[normalized] ?? normalized.replace(/[_-]+/g, " ");
  return label.trim() || null;
}

function formatHealthForPrompt(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const ctx = value as {
    providerStatus?: unknown;
    provider?: unknown;
    yoga?: { totalMinutes?: unknown; practiceCount?: unknown; averageDailyMinutes?: unknown; comparison?: unknown; kinds?: unknown };
    activity?: { steps?: unknown; activeCalories?: unknown; workoutMinutes?: unknown };
    sleep?: { durationMinutes?: unknown; quality?: unknown };
  };
  const lines: string[] = [];
  const provider = typeof ctx.provider === "string" ? ctx.provider : "unknown";
  const yogaMinutes = numberOrNull(ctx.yoga?.totalMinutes);
  const yogaPracticeCount = numberOrNull(ctx.yoga?.practiceCount);
  const yogaAverage = numberOrNull(ctx.yoga?.averageDailyMinutes);
  const yogaComparison = typeof ctx.yoga?.comparison === "string" ? ctx.yoga.comparison : "unknown";
  const yogaKinds = Array.isArray(ctx.yoga?.kinds)
    ? ctx.yoga.kinds.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];

  if (yogaPracticeCount != null && yogaPracticeCount > 0) {
    const minutesPart = yogaMinutes != null && yogaMinutes > 0 ? `${Math.round(yogaMinutes)}` : "0";
    const averagePart = yogaAverage != null ? `, average daily minutes: ${Math.round(yogaAverage)}` : "";
    const comparisonPart = yogaComparison !== "unknown" ? `, comparison: ${yogaComparison}` : "";
    const kindsPart = yogaKinds.length ? `, kinds: ${yogaKinds.join("/")}` : "";
    lines.push(
      `yoga minutes: ${minutesPart}, practices: ${Math.round(yogaPracticeCount)}${averagePart}${comparisonPart}${kindsPart}`,
    );
  } else if (yogaMinutes != null && yogaMinutes > 0) {
    const averagePart = yogaAverage != null ? `, average daily minutes: ${Math.round(yogaAverage)}` : "";
    const comparisonPart = yogaComparison !== "unknown" ? `, comparison: ${yogaComparison}` : "";
    const kindsPart = yogaKinds.length ? `, kinds: ${yogaKinds.join("/")}` : "";
    lines.push(`yoga minutes: ${Math.round(yogaMinutes)}${averagePart}${comparisonPart}${kindsPart}`);
  }

  const stepsLine = formatMetricForPrompt("steps", ctx.activity?.steps);
  const caloriesLine = formatMetricForPrompt("active calories", ctx.activity?.activeCalories);
  const workoutLine = formatMetricForPrompt("workout minutes", ctx.activity?.workoutMinutes);
  const sleepLine = formatMetricForPrompt("sleep minutes", ctx.sleep?.durationMinutes);
  if (stepsLine) lines.push(stepsLine);
  if (caloriesLine) lines.push(caloriesLine);
  if (workoutLine) lines.push(workoutLine);
  if (sleepLine) lines.push(sleepLine);
  if (typeof ctx.sleep?.quality === "string" && ctx.sleep.quality !== "unknown") {
    const sleepQuality = sleepQualityLabelForPrompt(ctx.sleep.quality);
    if (sleepQuality) {
      lines.push(`sleep quality note: ${sleepQuality}; do not quote raw provider codes.`);
    }
  }
  if (!lines.length) {
    return ctx.providerStatus === "available"
      ? `provider: ${provider}; no specific Apple/Google Health numbers were shared; do not invent any.`
      : "Apple/Google Health is unavailable; do not mention steps, sleep, calories or workouts.";
  }
  return [`provider: ${provider}`, ...lines].join(", ");
}

function formatPracticesForPrompt(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const items = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
      const durationSec = numberOrNull((item as { durationSec?: unknown }).durationSec);
      const minutes = durationSec && durationSec > 0 ? ` (${Math.round(durationSec / 60)} min)` : "";
      return title ? `- ${title}${minutes}` : null;
    })
    .filter((line): line is string => Boolean(line));
  return items.join("\n");
}

/**
 * User declines the practice offer. JS word boundaries (\b) never match around
 * Cyrillic, so the previous \b-wrapped pattern silently failed for Russian and
 * the dialog stayed open after e.g. "Нет, ничего не надо сохранять". This uses
 * whitespace/fragment patterns instead, plus a bare-negation reply — but only
 * when the message does not itself request a practice (type/duration), so
 * "Нет, лучше дыхание 5 минут" is still routed to validation, not decline.
 */
function userDeclinesPractice(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /(не\s*надо|не\s*хочу|не\s*предлаг\w*|без\s*практик|не\s*буду|ничего\s+не\s+(?:надо|нужно)|пропуст|потом|позже|не\s*сейчас|обойд[её]мся|обойтись|skip|no\s*practice|not\s*now|maybe\s*later|without\s*(?:a\s*)?practice|don'?t\s*(?:offer|suggest))/i.test(
      normalized,
    )
  ) {
    return true;
  }
  const mentionsPractice =
    /(медитац|дыхан|пранаям|асан|йог|минут|practice|meditation|breath|yoga|asana|\bmin\b)/i.test(normalized);
  if (!mentionsPractice && /^(?:нет|нету|неа|no|nope)[.!?,…\s]/i.test(`${normalized} `)) {
    return true;
  }
  return false;
}

/**
 * User declines to plan the day right now (not the same as "I'm done adding").
 * Avoids JS word boundaries around Cyrillic (which never match) by using
 * whitespace and word-fragment patterns. Used only inside the planning branch
 * when no action was extracted, so false positives are unlikely.
 */
function userDeclinesPlanning(text: string): boolean {
  const normalized = text.toLowerCase();
  return /(некогда|нет\s+времени|не\s+до\s+планов|не\s+до\s+этого\s+сейчас|не\s+хоч\w*\s+планир|не\s+буду\s+планир|не\s+могу\s+планир|без\s+планир|план\w*\s+потом|потом\s+планир|не\s+сейчас[^.?!]{0,20}планир|не\s+готов\w*\s+планир|skip\s+planning|don'?t\s+want\s+to\s+plan|no\s+time\s+to\s+plan|not\s+now[^.?!]{0,20}plan)/iu.test(normalized);
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
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text }] } satisfies GeminiContent;
    })
    .filter((item): item is GeminiContent => Boolean(item));
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
      trigger_meta: { ...(body.triggerMeta ?? {}), use_case: useCase, ...extraMeta },
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ConversationRecord;
}

async function closeSiblingOpenConversations(
  db: SupabaseClient,
  userId: string,
  entrySource: string,
  useCase: DialogueUseCase,
) {
  const { data, error } = await db
    .from("conversations")
    .select("id,trigger_meta,ended_at")
    .eq("user_id", userId)
    .eq("entry_source", entrySource)
    .is("ended_at", null)
    .limit(20);
  if (error) throw error;
  const siblings = ((data ?? []) as ConversationRecord[]).filter((conversation) => {
    const metaUseCase = typeof conversation.trigger_meta?.use_case === "string" ? conversation.trigger_meta.use_case : null;
    return !metaUseCase || metaUseCase === useCase;
  });
  for (const conversation of siblings) {
    await closeConversation(db, userId, conversation.id);
  }
}

async function loadConversation(
  db: SupabaseClient,
  userId: string,
  body: Required<Pick<Body, "entrySource" | "triggerMeta">> & Body,
  useCase: DialogueUseCase,
  scenarioId: string | null,
  timezone: string,
): Promise<ConversationRecord> {
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
    if (!conversation.ended_at && !isConversationExpired(conversation, timezone)) return conversation;

    const summary = await summarizeConversationIfNeeded(db, userId, conversation.id);
    if (!conversation.ended_at) await closeConversation(db, userId, conversation.id);
    return createConversation(db, userId, body, useCase, scenarioId, {
      reset_reason: "session_expired",
      previous_conversation_id: conversation.id,
      previous_conversation_summary: summary,
    });
  }
  await closeSiblingOpenConversations(db, userId, body.entrySource, useCase);
  return createConversation(db, userId, body, useCase, scenarioId);
}

/**
 * The whole daily dialog runs on the STANDARD model tier (`AI_MODEL_STANDARD`,
 * i.e. DeepSeek v4 flash), on EVERY turn and for the greeting, regardless of the
 * user's membership. Uniformity is intentional: mixing premium/standard across
 * turns breaks DeepSeek's prefix cache (system + history must stay identical to
 * stay "warm"). Home-page astrology interpretation / day-recommendation / the
 * "Подробнее" long text are separate endpoints and keep their own tier.
 */
const DIALOG_MODEL_TIER = "standard" as const;

function turnDecisionEvent(mode: TurnMode) {
  const phaseMap: Record<TurnMode, string> = {
    opening: "contextual_greeting",
    inquiry: "deepen_inquiry",
    final_recommendation: "suggest_practice",
    final_without_practice: "confirm_and_close",
  };
  return { mode, modelTier: DIALOG_MODEL_TIER, next_phase: phaseMap[mode] };
}

/** Planned events that are still open for the working day, in deterministic order. */
function openDueEvents(context: LoadedContext): PlannedEventRow[] {
  return context.dueEvents.filter((event) => event.status === "planned");
}

function immediateDialogStream(params: {
  conversationId: string;
  fullText: string;
  turnMode: TurnMode;
  phaseTime: LoadedContext["phaseTime"];
  targetChakra: LoadedContext["targetChakra"];
  shouldClose: boolean;
  branches?: string[];
  iteration?: number;
  messageId?: string | null;
}) {
  const encoder = new TextEncoder();
  const completePayload = {
    conversationId: params.conversationId,
    fullText: params.fullText,
    shouldClose: params.shouldClose,
    modelUsed: DIALOG_MODEL_TIER,
    latencyMs: 0,
    modelTier: DIALOG_MODEL_TIER,
    turnMode: params.turnMode,
    iteration: params.iteration ?? 1,
    readyMarkerTriggered: false,
    branches: params.branches ?? ["summarizing"],
    targetChakra: params.targetChakra,
    phaseTime: params.phaseTime,
    validation: null,
    messageId: params.messageId ?? null,
  };
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sse("complete", completePayload)));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function readSummarySessionItems(meta: Record<string, unknown> | null | undefined): SummarySessionItem[] {
  const raw = (meta as { summary_session?: { closed_events?: unknown } } | null | undefined)?.summary_session?.closed_events;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : null;
      const description = typeof (item as { description?: unknown }).description === "string"
        ? (item as { description: string }).description
        : null;
      const plannedLocalDate = typeof (item as { planned_local_date?: unknown }).planned_local_date === "string"
        ? (item as { planned_local_date: string }).planned_local_date
        : null;
      const summarizedAt = typeof (item as { summarized_at?: unknown }).summarized_at === "string"
        ? (item as { summarized_at: string }).summarized_at
        : null;
      if (!id || !description || !plannedLocalDate || !summarizedAt) return null;
      const displayOrder = Number((item as { display_order?: unknown }).display_order);
      const outcomeCells = (item as { outcome_cells?: unknown }).outcome_cells ?? null;
      const outcomeText = typeof (item as { outcome_text?: unknown }).outcome_text === "string"
        ? (item as { outcome_text: string }).outcome_text
        : null;
      const parsed: SummarySessionItem = {
        id,
        description,
        planned_local_date: plannedLocalDate,
        display_order: Number.isFinite(displayOrder) ? displayOrder : null,
        summarized_at: summarizedAt,
        applied_to_matrix: (item as { applied_to_matrix?: unknown }).applied_to_matrix === true,
        outcome_cells: outcomeCells,
        outcome_text: outcomeText,
      };
      return parsed;
    })
    .filter((item): item is SummarySessionItem => Boolean(item));
}

function readSummarySessionItemsFromHistory(history: MessageRecord[]): SummarySessionItem[] {
  const items: SummarySessionItem[] = [];
  for (const message of history) {
    if (message.role !== "assistant" || !message.meta || typeof message.meta !== "object") continue;
    const persistence = (message.meta as {
      planning_persistence?: { summarized?: unknown };
      planningPersistence?: { summarized?: unknown };
    }).planning_persistence ?? (message.meta as {
      planningPersistence?: { summarized?: unknown };
    }).planningPersistence;
    const summarized = persistence && typeof persistence === "object" && Array.isArray(persistence.summarized)
      ? persistence.summarized
      : [];
    for (const raw of summarized) {
      if (!raw || typeof raw !== "object") continue;
      const id = typeof (raw as { id?: unknown }).id === "string" ? (raw as { id: string }).id : null;
      const description = typeof (raw as { description?: unknown }).description === "string"
        ? (raw as { description: string }).description
        : null;
      const summarizedAt = typeof (raw as { summarized_at?: unknown; summarizedAt?: unknown }).summarized_at === "string"
        ? (raw as { summarized_at: string }).summarized_at
        : typeof (raw as { summarizedAt?: unknown }).summarizedAt === "string"
          ? (raw as { summarizedAt: string }).summarizedAt
          : null;
      if (!id || !description || !summarizedAt) continue;
      items.push({
        id,
        description,
        planned_local_date: "",
        display_order: null,
        summarized_at: summarizedAt,
        applied_to_matrix: (raw as { applied_to_matrix?: unknown; appliedToMatrix?: unknown }).applied_to_matrix === true
          || (raw as { appliedToMatrix?: unknown }).appliedToMatrix === true,
        outcome_cells: (raw as { outcome_cells?: unknown; outcomeCells?: unknown }).outcome_cells
          ?? (raw as { outcomeCells?: unknown }).outcomeCells
          ?? null,
        outcome_text: typeof (raw as { outcome_text?: unknown; outcomeText?: unknown }).outcome_text === "string"
          ? (raw as { outcome_text: string }).outcome_text
          : typeof (raw as { outcomeText?: unknown }).outcomeText === "string"
            ? (raw as { outcomeText: string }).outcomeText
            : null,
      });
    }
  }
  return items;
}

function mergeSummarySessionItems(...groups: SummarySessionItem[][]): SummarySessionItem[] {
  const byId = new Map<string, SummarySessionItem>();
  for (const group of groups) {
    for (const item of group) {
      const previous = byId.get(item.id);
      byId.set(item.id, {
        ...previous,
        ...item,
        planned_local_date: item.planned_local_date || previous?.planned_local_date || "",
        display_order: item.display_order ?? previous?.display_order ?? null,
        outcome_text: item.outcome_text ?? previous?.outcome_text ?? null,
        outcome_cells: item.outcome_cells ?? previous?.outcome_cells ?? null,
      });
    }
  }
  return [...byId.values()].sort((left, right) => {
    if (left.planned_local_date && right.planned_local_date && left.planned_local_date !== right.planned_local_date) {
      return left.planned_local_date.localeCompare(right.planned_local_date);
    }
    const leftOrder = left.display_order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.display_order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.summarized_at.localeCompare(right.summarized_at);
  });
}

type SummaryPersistenceRow = {
  id: string;
  description: string;
  outcome_text: string | null;
  outcome_cells: MatrixCell[];
  applied_to_matrix: boolean;
  summarized_at: string;
};

function toSummaryPersistenceRow(
  item: PersistedSummarizedEvent,
  outcomeText: string | null,
): SummaryPersistenceRow {
  return {
    id: item.id,
    description: item.title,
    outcome_text: outcomeText,
    outcome_cells: item.outcomeCells,
    applied_to_matrix: item.appliedToMatrix,
    summarized_at: item.summarizedAt,
  };
}

/**
 * Remove a model-produced per-event recap section ("По событиям:" / "By events:")
 * from the summarizing final message — the user-facing summary should read as a
 * cohesive psychological reflection, not a labeled list of outcomes.
 */
function stripSummaryEventsBlock(value: string): string {
  const start = value.search(/(?:^|\n)\s*(?:По\s+событиям|By\s+events)\s*:/iu);
  if (start < 0) return value;
  const before = value.slice(0, start).trimEnd();
  const rest = value.slice(start);
  // Keep anything after the list that is clearly a new section (health note or
  // the planning bridge question); drop only the bulleted event recap itself.
  const resume = rest.search(/\n\s*\n(?!\s*[—–\-•*])/u);
  const after = resume >= 0 ? rest.slice(resume).trim() : "";
  return [before, after].filter(Boolean).join("\n\n");
}

// NOTE: JavaScript's \b only treats [A-Za-z0-9_] as word characters, so it never
// matches a boundary next to Cyrillic letters. Day-word stripping must use explicit
// Unicode letter look-arounds instead, or the Russian variants silently pass through.
const RU_DAY_WORDS = /(?<![\p{L}])(?:сегодняшн(?:ий|его|ему|им|ем|яя|юю|ей)|сегодня|вчерашн(?:ий|его|ему|им|ем|яя|юю|ей)|вчера|позавчерашн(?:ий|его|ему|им|ем|яя|юю|ей)|позавчера|завтрашн(?:ий|его|ему|им|ем|яя|юю|ей)|завтра)(?![\p{L}])/giu;

/**
 * Capitalize the first letter of the whole message and of each paragraph.
 * Day-word stripping above can turn "Сегодняшний день сложился…" into
 * "день сложился…", leaving the message starting with a lowercase letter; this
 * restores a normal sentence opening without touching mid-sentence casing.
 */
function capitalizeParagraphStarts(value: string): string {
  return value.replace(/(^|\n\n)(\s*)(\p{Ll})/gu, (_match, sep: string, space: string, char: string) =>
    `${sep}${space}${char.toUpperCase()}`,
  );
}

function sanitizeSummaryFinalVisibleText(value: string): string {
  const cleaned = stripSummaryEventsBlock(value)
    .replace(/^\s*[—–-]{2,}\s*/u, "")
    .replace(/(?<![\p{L}])сегодняшн(?:ий|его|ему|им|ем)\s+день(?![\p{L}])/giu, "день")
    .replace(/(?<![\p{L}])сегодня\s+вы(?![\p{L}])/giu, "Вы")
    .replace(/\btoday'?s\s+day\b/giu, "the day")
    .replace(/\btoday\s+you\b/giu, "You")
    .replace(RU_DAY_WORDS, "")
    .replace(/\b(?:today'?s|today|yesterday'?s|yesterday|the day before yesterday)\b/giu, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return capitalizeParagraphStarts(cleaned);
}

function ensureSummaryToPlanningBridge(visibleText: string, locale: "ru" | "en"): string {
  // Drop any trailing question the model wrote itself (its own planning invite).
  // It often re-introduces day words ("Что у вас на сегодня?") which the sanitizer
  // then mangles, and it duplicates the deterministic bridge we append below.
  const paragraphs = visibleText.trim().split(/\n{2,}/);
  while (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1]?.trim() ?? "";
    if (/[?？]\s*$/.test(last)) {
      paragraphs.pop();
    } else {
      break;
    }
  }
  const body = paragraphs.join("\n\n").trim();
  const bridge = locale === "ru"
    ? "Что важного вы хотите запланировать на текущий день?"
    : "What feels important to plan for today?";
  return body ? `${body}\n\n${bridge}` : bridge;
}

function visibleTextMentionsEvent(text: string, description: string): boolean {
  const needle = description.trim().toLowerCase();
  if (needle.length < 4) return false;
  return text.toLowerCase().includes(needle);
}

function findSummaryMarkerForEvent(
  markers: ReturnType<typeof parseResponseMarkers>,
  event: PlannedEventRow,
) {
  return markers.summarizeEvents.find(
    (marker) => marker.ref.trim() === event.id,
  );
}

function appendSummarySessionItem(meta: Record<string, unknown>, item: SummarySessionItem): Record<string, unknown> {
  const current = readSummarySessionItems(meta).filter((entry) => entry.id !== item.id);
  const closedEvents = [...current, item]
    .sort((left, right) => {
      if (left.planned_local_date !== right.planned_local_date) return left.planned_local_date.localeCompare(right.planned_local_date);
      const leftOrder = left.display_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.display_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.summarized_at.localeCompare(right.summarized_at);
    })
    .slice(-20);
  return {
    ...meta,
    summary_session: {
      closed_events: closedEvents,
    },
  };
}

const DEBUG_PLANNED_EVENT_SELECT =
  "id,conversation_id,description,planned_local_date,status,planned_at,expected_at,display_order,recommendation_text,cells,outcome_text,outcome_cells,summarized_at,explicit_time_text";

async function loadDebugDialogStateAfter(
  db: SupabaseClient,
  userId: string,
  conversation: ConversationRecord,
  context: LoadedContext,
  fsm: DialogFsmState | null,
): Promise<Record<string, unknown>> {
  const summarizedCutoffIso = DateTime.utc().minus({ hours: 48 }).toISO() ?? new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [createdRes, openRes, closedRows] = await Promise.all([
    db
      .from("planned_events")
      .select(DEBUG_PLANNED_EVENT_SELECT)
      .eq("user_id", userId)
      .eq("conversation_id", conversation.id)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("planned_at", { ascending: true }),
    db
      .from("planned_events")
      .select(DEBUG_PLANNED_EVENT_SELECT)
      .eq("user_id", userId)
      .eq("status", "planned")
      .order("planned_local_date", { ascending: false })
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("planned_at", { ascending: true })
      .limit(30),
    db
      .from("planned_events")
      .select(DEBUG_PLANNED_EVENT_SELECT)
      .eq("user_id", userId)
      .eq("status", "summarized")
      .gte("summarized_at", summarizedCutoffIso)
      .order("summarized_at", { ascending: false })
      .limit(30),
  ]);
  if (createdRes.error) throw createdRes.error;
  if (openRes.error) throw openRes.error;
  if (closedRows.error) throw closedRows.error;

  const summaryOnlyFlow = fsm?.flow.length === 1 && fsm.flow[0] === "summarizing";
  const forecastScopeDate = summaryOnlyFlow && fsm?.workingLocalDate
    ? fsm.workingLocalDate
    : context.localDate;
  const relevantLocalDates = [...new Set([
    context.localDate,
    forecastScopeDate,
    ...((createdRes.data ?? []) as Array<{ planned_local_date?: string | null }>).map((row) => row.planned_local_date).filter((value): value is string => typeof value === "string" && value.length > 0),
    ...((closedRows.data ?? []) as Array<{ planned_local_date?: string | null }>).map((row) => row.planned_local_date).filter((value): value is string => typeof value === "string" && value.length > 0),
  ])];
  const [forecastRes, todayForecastRes, matricesRes] = await Promise.all([
    db
      .from("user_daily_forecasts")
      .select("id,forecast_date,recommendation_short_text,recommendation_long_text,is_corrected_via_dialog,day_target_chakra,day_target_reason,planet_of_the_day,today_planet_state")
      .eq("user_id", userId)
      .eq("forecast_date", forecastScopeDate)
      .maybeSingle(),
    summaryOnlyFlow
      ? db
          .from("user_daily_forecasts")
          .select("id,forecast_date,recommendation_short_text,recommendation_long_text,is_corrected_via_dialog")
          .eq("user_id", userId)
          .eq("forecast_date", context.localDate)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    relevantLocalDates.length
      ? db
          .from("daily_matrices")
          .select("local_date,matrix,range_metric,updated_at")
          .eq("user_id", userId)
          .in("local_date", relevantLocalDates)
          .order("local_date", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (forecastRes.error) throw forecastRes.error;
  if (todayForecastRes.error) throw todayForecastRes.error;
  if (matricesRes.error) throw matricesRes.error;

  const planningRecommendationInThisConversation = (createdRes.data ?? []).length > 0;
  const forecastRow = (forecastRes.data as Record<string, unknown> | null) ?? null;
  const todayForecastRow = (todayForecastRes.data as Record<string, unknown> | null) ?? null;
  const summarySessionClosed = readSummarySessionItems(conversation.trigger_meta ?? {});
  const scopedOpenRows = summaryOnlyFlow && fsm?.workingLocalDate
    ? (openRes.data ?? []).filter(
        (row) => (row as { planned_local_date?: string }).planned_local_date === fsm.workingLocalDate,
      )
    : (openRes.data ?? []);
  const closedWithMatrixFlag = (closedRows.data ?? []).map((row) => {
    const outcomeCells = (row as { outcome_cells?: unknown }).outcome_cells;
    const applied = Array.isArray(outcomeCells) && outcomeCells.length > 0;
    return { ...row, applied_to_matrix: applied };
  });

  return {
    context_local_date: context.localDate,
    conversation_id: conversation.id,
    conversation_started_at: conversation.started_at ?? null,
    conversation_ended_at: conversation.ended_at ?? null,
    dialog_fsm: fsm
      ? {
          flow: fsm.flow,
          branch: fsm.branch,
          working_local_date: fsm.workingLocalDate,
          summary_only: summaryOnlyFlow,
        }
      : null,
    forecast_for_local_date: forecastRow,
    forecast_context_note: summaryOnlyFlow
      ? "Forecast row for summary working_local_date (ambient DB context). Planning header text for today, if any, is listed separately and was NOT produced by this summarizing conversation unless recommendation_corrected appears in message meta."
      : "Forecast row for context_local_date (ambient DB context). Shown only when is_corrected_via_dialog=true in Day tab header.",
    today_forecast_when_summary_only: summaryOnlyFlow ? todayForecastRow : null,
    planning_recommendation_written_in_this_conversation: planningRecommendationInThisConversation,
    planning_snapshot_at_start: [],
    planning_created_in_this_conversation: createdRes.data ?? [],
    planning_open_now: scopedOpenRows,
    planning_open_now_note: summaryOnlyFlow
      ? "Filtered to summary working_local_date; global overdue rows are not mixed into this snapshot."
      : null,
    summary_session_closed_events: summarySessionClosed,
    planning_closed_recent_48h: closedWithMatrixFlag,
    daily_matrices_for_relevant_dates: matricesRes.data ?? [],
  };
}

export async function GET(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  try {
    userId = await requireUserId(req);
    const url = new URL(req.url);
    db = createServiceSupabase();
    const { useCase, scenarioId } = await resolveDialogueScenario(db, {
      scenario_id: url.searchParams.get("scenario_id") ?? undefined,
      useCase: assertUseCase(url.searchParams.get("useCase") ?? undefined),
    });
    const entrySource = (url.searchParams.get("entrySource") as DialogueEntrySource | null) ?? "home";
    const requestedConversationId = url.searchParams.get("conversationId")?.trim() || null;
    const debugExportRequested = url.searchParams.get("debugExport") === "1";

    const context = await loadDialogDailyContext(db, userId, undefined, {
      skipPurgeSummarized: debugExportRequested,
    });
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
      if (candidate && (debugExportRequested || (!candidate.ended_at && !isConversationExpired(candidate, userTimezone, new Date(), resumeTtlMs)))) {
        conversation = candidate;
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
        return scenarioMatches && (!metaUseCase || metaUseCase === useCase)
          && !isConversationExpired(item, userTimezone, new Date(), resumeTtlMs);
      });
    }
    if (!conversation) return json({ conversationId: null, messages: [], reset: true });

    const rawHistory = await loadHistory(db, userId, conversation.id);
    const cutoffMs = Date.now() - resumeTtlMs;
    const history = rawHistory.filter((message) => {
      const createdMs = Date.parse(message.created_at ?? "");
      return Number.isFinite(createdMs) && createdMs >= cutoffMs;
    });
    const dialogStateAfter = debugExportRequested
      ? await loadDebugDialogStateAfter(db, userId, conversation, context, readFsmState(conversation.trigger_meta))
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
      reset: debugExportRequested ? false : history.length === 0,
      ...(debugExportRequested ? { debugExportEnabled: true, dialogStateAfter } : {}),
    });
  } catch (error) {
    await reportRouteError(error, { db, userId, endpoint: "communicator/v2/dialog", stage: "session_sync" });
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  const requestStartedMs = Date.now();
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const isInitiate = Boolean(body.initiateDialog);
    const userMessage = isInitiate ? "" : String(body.userMessage ?? "").trim();
    if (!isInitiate && !userMessage) return json({ error: "userMessage is required" }, { status: 400 });

    db = createServiceSupabase();
    const { useCase, scenarioId } = await resolveDialogueScenario(db, body);
    if (useCase !== "daily_dialog") {
      return json({ error: "dialog is implemented only for daily_dialog" }, { status: 400 });
    }

    endpointStage = "load_context";
    const triggerMeta = body.triggerMeta ?? {};
    const tabMode = (typeof triggerMeta.dayTabMode === "string" ? triggerMeta.dayTabMode : null) as DialogTabMode;
    const daySummaryRequested = triggerMeta.daySummaryRequested === true;
    const clientWorkingLocalDate =
      typeof triggerMeta.workingLocalDate === "string" ? triggerMeta.workingLocalDate : null;
    const summaryDate = daySummaryRequested ? clientWorkingLocalDate : null;

    let context = await loadDialogDailyContext(db, userId, body.userTimezone, {
      ...(daySummaryRequested && summaryDate ? { summarizeUpToLocalDate: summaryDate } : {}),
    });
    // Collapse the response-locale decision once (env override > body responseLocale
    // > stored users.locale > ru) and store it back on the context so every
    // downstream resolveResponseLocale(context.user.locale) call agrees.
    context.user.locale = resolveResponseLocale(context.user.locale, body.responseLocale);
    if (
      daySummaryRequested
      && summaryDate
      && summaryDate >= context.localDate
      && openDueEvents(context).length === 0
    ) {
      const overdueRows = await loadDuePlannedEvents(db, userId, context.localDate);
      if (overdueRows.length > 0) {
        context = { ...context, dueEvents: overdueRows };
      }
    }
    const userTimezone = context.user.tz ?? body.userTimezone ?? "UTC";
    const conversation = await loadConversation(
      db,
      userId,
      { ...body, entrySource: body.entrySource ?? "home", triggerMeta },
      useCase,
      scenarioId,
      userTimezone,
    );

    const dbHistory = await loadHistory(db, userId, conversation.id);
    const history = resolveTurnHistory(normalizeTurnHistory(body.turnHistory), dbHistory);
    const iteration = countAssistantTurns(history) + 1;
    const isOpening = isInitiate || countAssistantTurns(history) === 0;

    // ----- FSM state: read, or initialize and persist -----
    let fsm: DialogFsmState | null = readFsmState(conversation.trigger_meta);
    let conversationMeta: Record<string, unknown> = conversation.trigger_meta ?? {};
    let workingLocalDate = summaryDate ?? clientWorkingLocalDate ?? context.localDate;
    const dueForWorkingDate = openDueEvents(context);
    if (dueForWorkingDate.length > 0) {
      const anchorDate = dueForWorkingDate[0]?.planned_local_date;
      if (anchorDate && anchorDate < workingLocalDate) {
        workingLocalDate = anchorDate;
      }
    }
    if (!fsm || (fsm.branch === "done" && isInitiate)) {
      fsm = initFsmState({
        tabMode,
        daySummaryRequested,
        hasDueEvents: openDueEvents(context).length > 0,
        targetChakra: context.targetChakra.chakraNumber,
        workingLocalDate,
      });
      conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, fsm);
    }

    if (!isInitiate && fsm.branch === "planning" && !fsm.planningFinalized && assistantFinalizeWithoutMarkers(history)) {
      fsm = { ...fsm, planningFinalized: true };
      conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, fsm);
    }

    const coercedFsm = coerceFsmBeforeTurn({ fsm, history, userMessage, isInitiate });
    if (coercedFsm !== fsm) {
      fsm = coercedFsm;
      conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, fsm);
    }

    const promptContext = fsm.branch === "summarizing"
      ? await resolveSummarizingPromptContext(db, userId, context, workingLocalDate)
      : context;
    const brainCtx = buildBrainPromptContext(
      promptContext,
      fsm.branch === "summarizing" ? workingLocalDate : null,
    );
    const due = openDueEvents(context);
    const currentEvent = due[0] ?? null;
    const nextEvent = due[1] ?? null;

    if (fsm.branch === "summarizing" && due.length === 0) {
      if (!daySummaryRequested) {
        const nextFsm = advanceBranch(fsm);
        conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, nextFsm);
        fsm = nextFsm;
      } else {
        await closeConversation(db, userId, conversation.id);
        return immediateDialogStream({
          conversationId: conversation.id,
          fullText: "Все неподытоженные действия уже подытожены.",
          turnMode: "final_without_practice",
          phaseTime: context.phaseTime,
          targetChakra: context.targetChakra,
          shouldClose: true,
        });
      }
    }

    // ----- Build the single per-turn prompt for the current branch -----
    const practiceValidationAtTurn =
      fsm.branch === "practice" ? practiceValidationForTurn(history, userMessage) : null;
    let prompt: { systemInstruction: string; userInstruction: string };
    if (fsm.branch === "summarizing") {
      const completedEarlierEvents = mergeSummarySessionItems(
        readSummarySessionItems(conversationMeta),
        readSummarySessionItemsFromHistory(history),
      )
        .filter((item) => !currentEvent || item.id !== currentEvent.id)
        .map((item) => ({ description: item.description }));
      prompt = buildSummarizingPrompt(brainCtx, {
        isOpening,
        currentEvent: currentEvent ? { ref: currentEvent.id, description: currentEvent.description } : null,
        nextEvent: nextEvent ? { description: nextEvent.description } : null,
        completedEarlierEvents,
        isLastEvent: due.length <= 1,
        clarifyingAlreadyAsked: summaryAskedCount(fsm, currentEvent?.id) >= 1,
        healthContext: formatHealthForPrompt(triggerMeta.dayHealthContext),
        practicesContext: formatPracticesForPrompt(triggerMeta.dayPractices),
        summaryWorkingLocalDate: workingLocalDate,
        currentEventPlannedLocalDate: currentEvent?.planned_local_date ?? null,
        continuesToPlanning: !isLastBranch(fsm),
      });
    } else if (fsm.branch === "practice") {
      const lastAssistantBranch = [...history]
        .reverse()
        .find((message) => message.role === "assistant")
        ?.meta?.dialog_branches;
      const isPracticeOpening = !Array.isArray(lastAssistantBranch) || !lastAssistantBranch.includes("practice");
      prompt = buildPracticePrompt(brainCtx, {
        isOpening: isPracticeOpening,
        pickImmediately: practiceValidationAtTurn?.confident === true,
        catalogReconciliation: buildCatalogReconciliationInstruction(practiceValidationAtTurn!),
        postPracticeReply: historyHasPracticePicked(history),
      });
    } else {
      prompt = buildPlanningPrompt(brainCtx, {
        isOpening,
        noPractice: fsm.noPractice,
        noGreeting: fsm.noGreeting,
        userSignaledDone: userSignalsPlanningDone(userMessage),
        planningLocked: fsm.planningFinalized,
        existingActionCount: due.length,
      });
    }

    // Record the user turn (placeholder row; text lives in client turnHistory).
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

    const postDialogReplyNeeded =
      isPostDialogTurn(fsm, isInitiate)
      || (fsm.branch === "practice" && historyHasPracticePicked(history) && !isInitiate);
    if (postDialogReplyNeeded) {
      const locale = resolveDialogScaffoldLocale(context.user.locale);
      const replyText = buildPostDialogReply({
        locale,
        userMessage,
        hadPractice: historyHasPracticePicked(history),
      });
      const doneFsm: DialogFsmState = {
        ...fsm,
        branch: "done",
        branchIndex: fsm.flow.length,
        practiceDecided: true,
      };
      conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, doneFsm);
      const { data: insertedAssistant, error: postDialogInsertError } = await db
        .from("messages")
        .insert({
          user_id: userId,
          conversation_id: conversation.id,
          role: "assistant",
          content: null,
          content_type: "text",
          meta: {
            use_case: useCase,
            scenario_id: scenarioId,
            turn_mode: "final_without_practice",
            model_used: DIALOG_MODEL_TIER,
            latency_ms: Date.now() - requestStartedMs,
            iteration,
            ready_marker_triggered: false,
            dialog_branches: ["practice"],
            target_chakra: promptContext.targetChakra,
            phase_time: context.phaseTime,
          },
        })
        .select("id")
        .single();
      if (postDialogInsertError) throw postDialogInsertError;
      await closeConversation(db, userId, conversation.id);
      return immediateDialogStream({
        conversationId: conversation.id,
        fullText: replyText,
        turnMode: "final_without_practice",
        phaseTime: context.phaseTime,
        targetChakra: context.targetChakra,
        shouldClose: true,
        branches: ["practice"],
        iteration,
        messageId: insertedAssistant?.id ?? null,
      });
    }

    const baseHistory = mapHistoryToGemini(history);
    const currentTurnPrefix: GeminiContent[] = isInitiate ? [] : [{ role: "user", parts: [{ text: userMessage }] }];
    const directiveTurn: GeminiContent = { role: "user", parts: [{ text: prompt.userInstruction }] };
    const model = getModelByHint(DIALOG_MODEL_TIER);
    const routeDb = db;
    const routeUserId = userId;
    const fsmAtTurnStart = fsm;
    const branchForTurn = fsm.branch;
    const encoder = new TextEncoder();
    const summarizingFinalTurn =
      branchForTurn === "summarizing"
      && !isOpening
      && due.length <= 1
      && currentEvent != null;
    const bufferSummaryUntilGuards =
      branchForTurn === "summarizing"
      && !isOpening
      && currentEvent != null
      && (summaryAskedCount(fsm, currentEvent.id) < 1 || due.length <= 1);
    const bufferPlanningUntilGuards =
      branchForTurn === "planning"
      && !isOpening
      && !fsmAtTurnStart.planningFinalized;
    const bufferPracticeUntilGuards =
      branchForTurn === "practice"
      && !isOpening
      && (practiceValidationAtTurn?.confident === true || userDeclinesPractice(userMessage));
    const bufferUntilGuards = bufferSummaryUntilGuards || bufferPlanningUntilGuards || bufferPracticeUntilGuards;
    const maxOutputTokens =
      summarizingFinalTurn ? 4500
      : branchForTurn === "summarizing" ? 900
      : 2200;

    const stream = new ReadableStream({
      async start(controller) {
        let fullText = "";
        try {
          let modelUsed = model;
          for await (const chunk of streamGeminiText({
            systemInstruction: prompt.systemInstruction,
            contents: [...baseHistory, ...currentTurnPrefix, directiveTurn],
            model,
            temperature: 0.85,
            maxOutputTokens,
          })) {
            modelUsed = chunk.modelUsed;
            fullText += chunk.text;
            if (!bufferUntilGuards) {
              controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed })));
            }
          }

          const markers = parseResponseMarkers(fullText);
          const sanitizedVisibleText = stripBrainSentinels(sanitizeAssistantText(fullText, resolveResponseLocale(context.user.locale)));

          // ----- Deterministic FSM transition + persistence per branch -----
          let nextFsm: DialogFsmState = fsmAtTurnStart;
          let turnMode: TurnMode = isOpening ? "opening" : "inquiry";
          let shouldClose = false;
          let summaryClarifyingDeferred = false;
          let practicePicked: Record<string, unknown> | null = null;
          let recommendationCorrected: Record<string, unknown> | null = null;
          // True only on the turn planning actually finalizes. With incremental
          // persistence, PLANNED_EVENT markers also appear on gathering turns, so the
          // finalize-only visible assembly below must NOT key off "markers present".
          let planningFinalizedThisTurn = false;
          let turnMatrixCells: MatrixCell[] | undefined;
          let turnRelatedEventIds: string[] | undefined;
          let forcedVisibleText: string | null = null;
          const planningPersistence: {
            inserted: unknown[];
            updated: unknown[];
            summarized: SummaryPersistenceRow[];
            cancelled: { id: string; title: string }[];
          } = {
            inserted: [],
            updated: [],
            summarized: [],
            cancelled: [],
          };
          const nowIso = context.nowLocal.toUTC().toISO() ?? new Date().toISOString();

          if (branchForTurn === "planning") {
            const locale = resolveDialogScaffoldLocale(context.user.locale);
            // Lightweight cancellation: if the user asked to drop a still-open
            // planned action, fuzzy-match it against today's open events and mark
            // it `dismissed` so it disappears from the Day tab. Summarized events
            // are never touched. Undocumented in the UI — a pleasant surprise.
            if (markers.cancelEvents.length > 0) {
              try {
                const dismissed = await dismissPlannedEvents({
                  db: routeDb,
                  userId: routeUserId,
                  workingLocalDate: context.localDate,
                  refs: markers.cancelEvents.map((c) => c.ref),
                });
                if (dismissed.length > 0) {
                  planningPersistence.cancelled.push(...dismissed);
                  turnRelatedEventIds = [
                    ...(turnRelatedEventIds ?? []),
                    ...dismissed.map((d) => d.id),
                  ];
                  console.warn(
                    "[DIALOG_FSM] Dismissed planned events via dialog",
                    JSON.stringify({ conversationId: conversation.id, count: dismissed.length }),
                  );
                }
              } catch (cancelError) {
                console.error("[DIALOG_FSM] Failed to dismiss planned events", cancelError);
              }
            }
            let plannedMarkers = filterPracticeLikePlannedEvents(markers.plannedEvents);
            // A visible numbered "N. {action}\nРекомендация: …" wrap-up means the
            // model finalized this turn even if it forgot the invisible markers or
            // the deterministic done-detector missed the user's phrasing.
            const salvagedFromVisible = filterPracticeLikePlannedEvents(
              extractPlanningMarkersFromVisibleFinalize(
                stripBrainSentinels(sanitizeAssistantText(fullText, resolveResponseLocale(context.user.locale))),
                locale,
              ),
            );
            const finalizeIntent =
              !fsmAtTurnStart.planningFinalized
              && (
                userSignalsPlanningDone(userMessage)
                || salvagedFromVisible.length > 0
                || Boolean(markers.recommendationCorrection?.short_text)
                // Add flow (from the Day tab) is a one-shot add: finalize as soon as
                // an action is named, since there is no gather/finalize back-and-forth.
                || (tabMode === "add" && plannedMarkers.length > 0)
              );
            if (plannedMarkers.length === 0 && finalizeIntent && salvagedFromVisible.length > 0) {
              plannedMarkers = salvagedFromVisible;
              console.warn(
                "[DIALOG_FSM] Salvaged planning markers from visible finalize",
                JSON.stringify({ conversationId: conversation.id, count: salvagedFromVisible.length }),
              );
            }
            plannedMarkers = plannedMarkers.map((marker) => polishPlanningMarker(marker, locale));
            if (
              plannedMarkers.length === 0
              && !finalizeIntent
              && !isOpening
              && !fsmAtTurnStart.planningFinalized
              && userDeclinesPlanning(userMessage)
            ) {
              // User declines to plan now → close the dialogue gracefully and
              // skip the practice branch (it only follows real planning).
              forcedVisibleText = buildPlanningDeclinedReply(locale);
              nextFsm = {
                ...fsmAtTurnStart,
                planningFinalized: true,
                practiceDecided: true,
                branch: "done",
                branchIndex: fsmAtTurnStart.flow.length,
              };
              turnMode = "final_without_practice";
              shouldClose = true;
            } else {
              // INCREMENTAL PERSISTENCE: save planned actions on EVERY turn they are
              // named, not only at the finalize. persistPlanningFinalize is idempotent
              // (it updates existing `planned` rows by description identity), so a
              // re-emit at the finalize just attaches the recommendation. This makes
              // the plan survive an interrupted dialog the same way summarizing does.
              // Planning ALWAYS targets the current local day (context.localDate), never
              // the summary working date: in the overdue "Подытожить" → plan chain the
              // turn-level workingLocalDate is still the past summarized day.
              if (plannedMarkers.length > 0 && !fsmAtTurnStart.planningFinalized) {
                const persisted = await persistPlanningFinalize({
                  db: routeDb,
                  userId: routeUserId,
                  conversationId: conversation.id,
                  workingLocalDate: context.localDate,
                  timezone: userTimezone,
                  nowIso,
                  markers: plannedMarkers,
                  // While still gathering (no finalize intent), append new actions
                  // after the ones already saved this conversation; the finalize
                  // re-emit then re-numbers them cleanly by mention order.
                  appendToExisting: tabMode === "add" || !finalizeIntent,
                });
                planningPersistence.inserted.push(...persisted.filter((p) => p.action === "inserted"));
                planningPersistence.updated.push(...persisted.filter((p) => p.action === "updated"));
              }
              if (finalizeIntent) {
                planningFinalizedThisTurn = true;
                // The overall day recommendation comes from the [CORRECT_RECOMMENDATION]
                // marker. Flash often forgets it, so when it is missing salvage the
                // recommendation paragraph from the visible finalize (the substantial
                // paragraph before the numbered action list). The add flow has no day
                // focus step, so only do this in the full greeted planning flow.
                let dayFocusSource = markers.recommendationCorrection?.short_text?.trim() ?? "";
                if (!dayFocusSource && !fsmAtTurnStart.noGreeting) {
                  const salvagedDayFocus = extractDayFocusFromVisibleFinalize(
                    stripBrainSentinels(sanitizeAssistantText(fullText, resolveResponseLocale(context.user.locale))),
                    plannedMarkers.length,
                  );
                  if (salvagedDayFocus.length >= 80) {
                    dayFocusSource = salvagedDayFocus;
                    console.warn(
                      "[DIALOG_FSM] Salvaged day focus from visible finalize",
                      JSON.stringify({ conversationId: conversation.id, length: salvagedDayFocus.length }),
                    );
                  }
                }
                if (!fsmAtTurnStart.noGreeting && dayFocusSource) {
                  const shortText = prependChakraAttention(
                    ensureSentencePunctuation(dayFocusSource),
                    brainCtx.targetChakraNumber,
                    locale,
                  );
                  await persistDayFocus({
                    db: routeDb,
                    userId: routeUserId,
                    forecastId: typeof context.forecast?.id === "string" ? context.forecast.id : null,
                    shortText,
                  });
                  recommendationCorrected = {
                    ...(markers.recommendationCorrection ?? {}),
                    short_text: shortText,
                    newShortText: shortText,
                  };
                }
                nextFsm = advanceBranch({ ...fsmAtTurnStart, planningFinalized: true });
                if (nextFsm.branch === "done") {
                  turnMode = "final_without_practice";
                  shouldClose = true;
                } else {
                  turnMode = "inquiry";
                }
              } else if (fsmAtTurnStart.planningFinalized) {
                turnMode = "inquiry";
                nextFsm = { ...fsmAtTurnStart, planningFinalized: true };
              } else {
                turnMode = isOpening ? "opening" : "inquiry";
              }
            }
          } else if (branchForTurn === "practice") {
            const declined = (containsPracticeDeclined(fullText) || userDeclinesPractice(userMessage)) && !markers.practicePick;
            const validation = practiceValidationForTurn(history, userMessage);
            if (historyHasPracticePicked(history)) {
              nextFsm = { ...fsmAtTurnStart, practiceDecided: true, branch: "done", branchIndex: fsmAtTurnStart.flow.length };
              turnMode = "final_without_practice";
              shouldClose = true;
            } else if (declined) {
              nextFsm = advanceBranch({ ...fsmAtTurnStart, practiceDecided: true });
              turnMode = "final_without_practice";
              shouldClose = true;
            } else if (markers.practicePick || validation.confident) {
              const card = await resolvePracticeCard({
                db: routeDb,
                userId: routeUserId,
                marker: markers.practicePick,
                context,
                userMessage,
                history,
                conversationId: conversation.id,
              });
              if (card) {
                practicePicked = card;
                nextFsm = advanceBranch({ ...fsmAtTurnStart, practiceDecided: true });
                turnMode = "final_recommendation";
                shouldClose = true;
              } else {
                turnMode = "inquiry";
              }
            } else {
              turnMode = "inquiry";
            }
          } else if (branchForTurn === "summarizing") {
            if (markers.recommendationCorrection?.short_text) {
              console.warn("[DIALOG_FSM] Ignoring CORRECT_RECOMMENDATION marker in summarizing branch");
            }
            const summaryMarker = currentEvent
              ? findSummaryMarkerForEvent(markers, currentEvent)
              : undefined;
            const markerWithVisibleClarifier =
              !isOpening
              && summaryMarker
              && currentEvent
              && summaryAskedCount(fsmAtTurnStart, currentEvent.id) < 1
              && assistantAskedSummaryClarifyingQuestion(sanitizedVisibleText, nextEvent?.description);
            const remainingAfterCurrent = currentEvent
              ? due.filter((event) => event.id !== currentEvent.id).length
              : due.length;
            if (
              !isOpening
              && currentEvent
              && userSaysEventDidNotHappen(userMessage)
            ) {
              const summarizedItem = await persistSummarizedEvent({
                db: routeDb,
                userId: routeUserId,
                event: currentEvent,
                outcomeText: userMessage.trim() || null,
                outcomeCells: [],
                nowIso,
                deleteAfterPersist: currentEvent.planned_local_date < context.localDate,
              });
              conversationMeta = appendSummarySessionItem(conversationMeta, {
                id: summarizedItem.id,
                description: summarizedItem.title,
                planned_local_date: currentEvent.planned_local_date,
                display_order: summarizedItem.displayOrder,
                summarized_at: summarizedItem.summarizedAt,
                applied_to_matrix: summarizedItem.appliedToMatrix,
                outcome_cells: summarizedItem.outcomeCells,
                outcome_text: userMessage.trim() || null,
              });
              const persistenceRow = toSummaryPersistenceRow(summarizedItem, userMessage.trim() || null);
              planningPersistence.summarized = [persistenceRow];
              turnRelatedEventIds = [summarizedItem.id];
              turnMode = remainingAfterCurrent <= 0 && isLastBranch(fsmAtTurnStart) ? "final_without_practice" : "inquiry";
              nextFsm = remainingAfterCurrent <= 0 ? advanceBranch(fsmAtTurnStart) : fsmAtTurnStart;
              shouldClose = remainingAfterCurrent <= 0 && nextFsm.branch === "done";
              if (nextEvent && remainingAfterCurrent > 0) {
                const locale = resolveDialogScaffoldLocale(context.user.locale);
                forcedVisibleText = buildSummaryEventDidNotHappenBridge(currentEvent.description, nextEvent.description, locale);
              }
            } else if (markerWithVisibleClarifier && currentEvent) {
              console.warn(
                "[DIALOG_FSM] Summary marker deferred because visible reply asked a clarifying question",
                JSON.stringify({ conversationId: conversation.id, eventId: currentEvent.id }),
              );
              summaryClarifyingDeferred = true;
              nextFsm = bumpSummaryAsked(fsmAtTurnStart, currentEvent.id);
              turnMode = "inquiry";
            } else if (
              !isOpening
              && summaryMarker
              && currentEvent
              && userAnswerIsThinForSummary(userMessage)
              && summaryAskedCount(fsmAtTurnStart, currentEvent.id) < 1
            ) {
              console.warn(
                "[DIALOG_FSM] Thin summary answer without lived state — deferring marker for clarifying question",
                JSON.stringify({ conversationId: conversation.id, eventId: currentEvent.id }),
              );
              summaryClarifyingDeferred = true;
              nextFsm = bumpSummaryAsked(fsmAtTurnStart, currentEvent.id);
              turnMode = "inquiry";
            } else if (
              !isOpening
              && summaryMarker
              && currentEvent
              && userAnswerIsThinForSummary(userMessage)
              && summaryAskedCount(fsmAtTurnStart, currentEvent.id) >= 1
            ) {
              console.warn(
                "[DIALOG_FSM] Clarifying exhausted but answer still thin — closing without matrix cells",
                JSON.stringify({ conversationId: conversation.id, eventId: currentEvent.id }),
              );
              const summarizedItem = await persistSummarizedEvent({
                db: routeDb,
                userId: routeUserId,
                event: currentEvent,
                outcomeText: summaryMarker.outcome,
                outcomeCells: [],
                nowIso,
                deleteAfterPersist: currentEvent.planned_local_date < context.localDate,
              });
              conversationMeta = appendSummarySessionItem(conversationMeta, {
                id: summarizedItem.id,
                description: summarizedItem.title,
                planned_local_date: currentEvent.planned_local_date,
                display_order: summarizedItem.displayOrder,
                summarized_at: summarizedItem.summarizedAt,
                applied_to_matrix: summarizedItem.appliedToMatrix,
                outcome_cells: summarizedItem.outcomeCells,
                outcome_text: summaryMarker.outcome,
              });
              const persistenceRow = toSummaryPersistenceRow(summarizedItem, summaryMarker.outcome);
              planningPersistence.summarized = [persistenceRow];
              turnRelatedEventIds = [summarizedItem.id];
              if (remainingAfterCurrent <= 0) {
                nextFsm = advanceBranch(fsmAtTurnStart);
                if (nextFsm.branch === "done") {
                  turnMode = "final_without_practice";
                  shouldClose = true;
                } else {
                  turnMode = "inquiry";
                }
              } else {
                turnMode = "inquiry";
              }
            } else if (!isOpening && summaryMarker && currentEvent) {
              const summarizedItem = await persistSummarizedEvent({
                db: routeDb,
                userId: routeUserId,
                event: currentEvent,
                outcomeText: summaryMarker.outcome,
                outcomeCells: summaryMarker.outcomeCells,
                nowIso,
                deleteAfterPersist: currentEvent.planned_local_date < context.localDate,
              });
              conversationMeta = appendSummarySessionItem(conversationMeta, {
                id: summarizedItem.id,
                description: summarizedItem.title,
                planned_local_date: currentEvent.planned_local_date,
                display_order: summarizedItem.displayOrder,
                summarized_at: summarizedItem.summarizedAt,
                applied_to_matrix: summarizedItem.appliedToMatrix,
                outcome_cells: summarizedItem.outcomeCells,
                outcome_text: summaryMarker.outcome,
              });
              const persistenceRow = toSummaryPersistenceRow(summarizedItem, summaryMarker.outcome);
              planningPersistence.summarized = [persistenceRow];
              turnMatrixCells = summarizedItem.outcomeCells;
              turnRelatedEventIds = [summarizedItem.id];
              if (remainingAfterCurrent <= 0) {
                nextFsm = advanceBranch(fsmAtTurnStart);
                if (nextFsm.branch === "done") {
                  turnMode = "final_without_practice";
                  shouldClose = true;
                } else {
                  turnMode = "inquiry";
                }
              } else {
                turnMode = "inquiry";
              }
            } else if (!isOpening && currentEvent && summaryAskedCount(fsmAtTurnStart, currentEvent.id) >= 1) {
              const summarizedItem = await persistSummarizedEvent({
                db: routeDb,
                userId: routeUserId,
                event: currentEvent,
                outcomeText: userMessage.trim() || null,
                outcomeCells: [],
                nowIso,
                deleteAfterPersist: currentEvent.planned_local_date < context.localDate,
              });
              conversationMeta = appendSummarySessionItem(conversationMeta, {
                id: summarizedItem.id,
                description: summarizedItem.title,
                planned_local_date: currentEvent.planned_local_date,
                display_order: summarizedItem.displayOrder,
                summarized_at: summarizedItem.summarizedAt,
                applied_to_matrix: summarizedItem.appliedToMatrix,
                outcome_cells: summarizedItem.outcomeCells,
                outcome_text: userMessage.trim() || null,
              });
              const persistenceRow = toSummaryPersistenceRow(summarizedItem, userMessage.trim() || null);
              planningPersistence.summarized = [persistenceRow];
              turnRelatedEventIds = [summarizedItem.id];
              if (remainingAfterCurrent <= 0) {
                nextFsm = advanceBranch(fsmAtTurnStart);
                if (nextFsm.branch === "done") {
                  turnMode = "final_without_practice";
                  shouldClose = true;
                } else {
                  turnMode = "inquiry";
                }
              } else {
                turnMode = "inquiry";
              }
            } else if (
              !isOpening
              && currentEvent
              && !summaryMarker
              && nextEvent
              && visibleTextMentionsEvent(
                sanitizedVisibleText,
                nextEvent.description,
              )
            ) {
              console.warn("[DIALOG_FSM] Model mentioned the next event before closing the current one — keeping current event open");
              const locale = resolveDialogScaffoldLocale(context.user.locale);
              forcedVisibleText = buildSummaryClarifyingQuestion(currentEvent.description, locale);
              nextFsm = bumpSummaryAsked(fsmAtTurnStart, currentEvent.id);
              turnMode = "inquiry";
            } else if (!isOpening && currentEvent) {
              // No marker this turn: count it as the single clarifying question.
              nextFsm = bumpSummaryAsked(fsmAtTurnStart, currentEvent.id);
              turnMode = "inquiry";
            } else {
              turnMode = isOpening ? "opening" : "inquiry";
            }
          }

          let cleanText = forcedVisibleText ?? sanitizedVisibleText;
          if (branchForTurn === "planning" && planningFinalizedThisTurn) {
            const locale = resolveDialogScaffoldLocale(context.user.locale);
            const planningMarkersForVisible = filterPracticeLikePlannedEvents(markers.plannedEvents)
              .map((marker) => polishPlanningMarker(marker, locale));
            const persistedDayFocus =
              recommendationCorrected && typeof recommendationCorrected.short_text === "string"
                ? recommendationCorrected.short_text
                : undefined;
            const dayFocus = ensureSentencePunctuation(
              persistedDayFocus ?? markers.recommendationCorrection?.short_text,
            );
            if (planningMarkersForVisible.length > 0 && fsmAtTurnStart.noGreeting) {
              cleanText = buildPlanningAddFinalVisibleText({
                events: planningMarkersForVisible,
                locale,
              });
            } else if (planningMarkersForVisible.length > 0) {
              cleanText = buildPlanningFinalVisibleText({
                visibleText: cleanText,
                events: planningMarkersForVisible,
                dayFocus,
                locale,
                includePracticeQuestion: !fsmAtTurnStart.noPractice,
                targetChakraNumber: brainCtx.targetChakraNumber,
              });
            } else if (dayFocus) {
              cleanText = injectPlanningDayFocus(cleanText, dayFocus);
            } else if (planningMarkersForVisible.length > 0) {
              cleanText = injectPlanningActionsVisibleList(cleanText, planningMarkersForVisible, locale);
            }
          }
          if (branchForTurn === "practice" && practicePicked) {
            const cardReason =
              typeof practicePicked.reason === "string" && practicePicked.reason.trim().length > 0
                ? practicePicked.reason.trim()
                : typeof practicePicked.card_blurb === "string" && practicePicked.card_blurb.trim().length > 0
                  ? practicePicked.card_blurb.trim()
                  : null;
            if (cardReason) cleanText = cardReason;
          }
          if (summaryClarifyingDeferred && currentEvent) {
            const locale = resolveDialogScaffoldLocale(context.user.locale);
            cleanText = buildSummaryClarifyingQuestion(currentEvent.description, locale);
          }
          if (
            branchForTurn === "summarizing"
            && !isOpening
            && nextFsm.branch !== "summarizing"
            && !summaryClarifyingDeferred
          ) {
            // The final summary reads as a cohesive psychological reflection — no
            // per-event recap list, no calendar/day words. The planning hand-off
            // (if any) is appended deterministically below.
            cleanText = sanitizeSummaryFinalVisibleText(cleanText);
            if (nextFsm.branch === "planning") {
              const locale = resolveDialogScaffoldLocale(context.user.locale);
              cleanText = ensureSummaryToPlanningBridge(cleanText, locale);
            }
          }
          if (!cleanText.trim() && branchForTurn === "practice" && !practicePicked && !shouldClose) {
            // The practice turn produced no card and no visible text (e.g. the
            // model put everything inside a marker that failed to resolve, or a
            // catalog-inconsistent request like 30-min breathing). Never crash the
            // client — fall back to a deterministic catalog-aware clarification.
            const locale = resolveDialogScaffoldLocale(context.user.locale);
            const v = practiceValidationAtTurn;
            const requestedDurationMin = v?.durationSec != null ? Math.round(v.durationSec / 60) : null;
            const kind = v?.practiceKind ?? null;
            const conflict = Boolean(v && v.hasDuration && v.hasType && !v.catalogConsistent);
            cleanText = buildPracticeClarificationFallback({
              locale,
              kind: conflict ? kind : null,
              requestedDurationMin: conflict ? requestedDurationMin : null,
              range: conflict && kind ? catalogDurationRangeForKind(kind) : null,
              altKind: conflict && requestedDurationMin != null ? catalogKindForDurationMin(requestedDurationMin) : null,
            });
            turnMode = "inquiry";
            console.warn(
              "[DIALOG_FSM] Practice turn yielded empty text — using deterministic clarification fallback",
              JSON.stringify({ conversationId: conversation.id, conflict, kind, requestedDurationMin }),
            );
          }
          if (!cleanText) {
            throw new Error("Model returned empty text after sanitization");
          }
          // Deterministic safety net: DeepSeek occasionally drops a stray English
          // word into Russian output ("рутинный task", "пусть ответ quietly…").
          // The prompt forbids it but the model is not fully reliable, so we also
          // replace a curated set of common offenders. Skip for EN dialogues.
          if (resolveResponseLocale(context.user.locale) === "ru") {
            cleanText = replaceSpontaneousEnglishRu(cleanText);
          }
          if (bufferUntilGuards) {
            controller.enqueue(encoder.encode(sse("chunk", { text: cleanText, modelUsed })));
          }

          // Persist FSM + assistant meta only after planned_events / daily_matrices writes succeed.
          await writeFsmState(routeDb, routeUserId, conversation.id, conversationMeta, nextFsm);

          const { data: inserted, error: insertError } = await routeDb
            .from("messages")
            .insert({
              user_id: routeUserId,
              conversation_id: conversation.id,
              role: "assistant",
              content: null,
              content_type: "text",
              meta: {
                use_case: useCase,
                scenario_id: scenarioId,
                turn_mode: turnMode,
                model_used: DIALOG_MODEL_TIER,
                model_id: modelUsed,
                latency_ms: Date.now() - requestStartedMs,
                iteration,
                ready_marker_triggered: turnMode === "final_recommendation",
                practicePicked: practicePicked ?? null,
                practice_picked: practicePicked ?? null,
                recommendationCorrected,
                dialog_branches: [branchForTurn],
                target_chakra: promptContext.targetChakra,
                phase_time: context.phaseTime,
                planning_persistence: planningPersistence,
                related_event_ids: turnRelatedEventIds ?? null,
                matrix_cells: turnMatrixCells ?? null,
              },
            })
            .select("id")
            .single();
          if (insertError) throw insertError;

          const persistenceConfirmed = planningPersistence.summarized.length > 0
            || planningPersistence.inserted.length > 0
            || planningPersistence.updated.length > 0
            || planningPersistence.cancelled.length > 0;
          const completePayload = {
            conversationId: conversation.id,
            fullText: cleanText,
            shouldClose,
            modelUsed,
            latencyMs: Date.now() - requestStartedMs,
            modelTier: DIALOG_MODEL_TIER,
            turnMode,
            iteration,
            readyMarkerTriggered: turnMode === "final_recommendation",
            branches: [branchForTurn],
            targetChakra: promptContext.targetChakra,
            phaseTime: context.phaseTime,
            validation: null,
            practicePicked: practicePicked ?? undefined,
            recommendationCorrected: recommendationCorrected ?? undefined,
            messageId: inserted?.id ?? null,
            ...(persistenceConfirmed
              ? {
                  planningPersistence,
                  relatedEventIds: turnRelatedEventIds,
                  matrixCells: turnMatrixCells,
                }
              : {}),
          };
          controller.enqueue(encoder.encode(sse("complete", completePayload)));

          controller.enqueue(
            encoder.encode(
              sse("turn_artifacts", {
                messageId: inserted?.id ?? null,
                planningPersistence,
                relatedEventIds: turnRelatedEventIds,
                matrixCells: turnMatrixCells,
              }),
            ),
          );

          if (shouldClose) {
            await closeConversation(routeDb, routeUserId, conversation.id);
          }
          controller.close();
        } catch (error) {
          console.error("[DIALOG_FSM] STREAM ERROR:", error instanceof Error ? error.message : String(error));
          await reportRouteError(error, {
            db: routeDb,
            userId: routeUserId,
            endpoint: "communicator/v2/dialog",
            stage: "responder_stream",
            payload: { conversation_id: conversation.id, iteration, branch: branchForTurn },
          });
          try {
            const salvaged = stripBrainSentinels(
              sanitizeAssistantText(fullText, resolveResponseLocale(context.user.locale)),
            ).trim();
            if (salvaged) {
              controller.enqueue(
                encoder.encode(
                  sse("complete", {
                    conversationId: conversation.id,
                    fullText: salvaged,
                    shouldClose: false,
                    modelUsed: model,
                    latencyMs: Date.now() - requestStartedMs,
                    modelTier: DIALOG_MODEL_TIER,
                    turnMode: "inquiry" as const,
                    iteration,
                    readyMarkerTriggered: false,
                    branches: [branchForTurn],
                    targetChakra: context.targetChakra,
                    phaseTime: context.phaseTime,
                    validation: null,
                  }),
                ),
              );
            } else {
              controller.enqueue(encoder.encode(sse("error", { error: toUserFacingStreamErrorMessage(error) })));
            }
            controller.close();
          } catch {
            /* stream already closed */
          }
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
    await reportRouteError(error, { db, userId, endpoint: "communicator/v2/dialog", stage: endpointStage });
    return errorResponse(error);
  }
}
