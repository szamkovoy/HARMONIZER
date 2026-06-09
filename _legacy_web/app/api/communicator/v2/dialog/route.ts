import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { chakraLabelAccusativeRu, chakraLabelRu } from "@/modules/chakra/labels";
import chakraStatesBaseline from "@/data/chakra_states_baseline.json";
import { tonalRegisterForPlanet } from "@legacy/app/api/_utils/dialogTonalRegisters";
import { formatLifeSpheresBaselineForPrompt } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import {
  getModelByHint,
  streamGeminiText,
  type GeminiContent,
} from "@legacy/app/api/_utils/gemini";
import {
  parseResponseMarkers,
  sanitizeAssistantText,
  validateHistoryHasDurationAndType,
} from "@legacy/app/api/_utils/markers";
import { reportRouteError, toUserFacingStreamErrorMessage } from "@legacy/app/api/_utils/monitoring";
import { getScenario } from "@legacy/app/api/_utils/scenarios";
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
import { loadDialogDailyContext, type DialogDailyContext } from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import type { PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
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
  containsPracticeDeclined,
  stripBrainSentinels,
  type BrainPromptContext,
} from "@legacy/app/api/communicator/v2/dialog/dialogBranchPrompts";
import {
  persistDayFocus,
  persistPlanningFinalize,
  persistSummarizedEvent,
} from "@legacy/app/api/communicator/v2/dialog/dialogBrainPersistence";
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
  initiateDialog?: boolean;
  turnHistory?: TurnHistoryItem[];
};

type LoadedContext = DialogDailyContext;
type TurnMode =
  | "opening"
  | "inquiry"
  | "final_recommendation"
  | "final_without_practice";

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

function timeOfDayForHour(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "midday";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function buildBrainPromptContext(context: LoadedContext): BrainPromptContext {
  const locale: "ru" | "en" = context.user.locale?.startsWith("en") ? "en" : "ru";
  const now = context.nowLocal;
  const promptHour = promptLocalHour(now.hour);
  const targetChakra = context.targetChakra.chakraNumber;
  const states = chakraStates(targetChakra);
  const planetOfDay = typeof context.forecast?.planet_of_the_day === "string" ? context.forecast.planet_of_the_day : "Sun";
  const dayFocus = typeof context.forecast?.recommendation_short_text === "string" ? context.forecast.recommendation_short_text : null;
  return {
    locale,
    languageName: locale === "en" ? "English" : "Russian",
    addressForm: context.user.address_form === "informal" ? "ты" : "вы",
    dayOfWeek: now.setLocale(locale).toFormat("cccc"),
    dateLabel: now.setLocale(locale).toFormat("d LLLL"),
    timeOfDay: timeOfDayForHour(promptHour),
    phaseTime: context.phaseTime,
    targetChakraNumber: targetChakra,
    targetChakraLabel: chakraLabelRu(targetChakra),
    targetChakraAccusative: chakraLabelAccusativeRu(targetChakra),
    targetChakraExplain: context.targetChakra.explain,
    harmonicStates: states.harmonic,
    dissonantStates: states.dissonant,
    planetOfDay,
    tonalRegister: tonalRegisterForPlanet(planetOfDay),
    lifeSpheresBaseline: formatLifeSpheresBaselineForPrompt(context.user.locale),
    planningSphereLens: context.planningSphereLens,
    existingDayFocus: dayFocus,
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatHealthForPrompt(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const ctx = value as {
    providerStatus?: unknown;
    yoga?: { totalMinutes?: unknown; practiceCount?: unknown };
    activity?: { steps?: unknown; activeCalories?: unknown; workoutMinutes?: unknown };
    sleep?: { durationMinutes?: unknown };
  };
  const lines: string[] = [];
  const steps = numberOrNull(ctx.activity?.steps);
  const calories = numberOrNull(ctx.activity?.activeCalories);
  const workout = numberOrNull(ctx.activity?.workoutMinutes);
  const sleep = numberOrNull(ctx.sleep?.durationMinutes);
  if (steps != null) lines.push(`steps: ${Math.round(steps)}`);
  if (calories != null) lines.push(`active calories: ${Math.round(calories)}`);
  if (workout != null) lines.push(`workout minutes: ${Math.round(workout)}`);
  if (sleep != null) lines.push(`sleep minutes: ${Math.round(sleep)}`);
  if (!lines.length) {
    return ctx.providerStatus === "available"
      ? "no specific Apple/Google Health numbers were shared; do not invent any."
      : "Apple/Google Health is unavailable; do not mention steps, sleep, calories or workouts.";
  }
  return lines.join(", ");
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

function userDeclinesPractice(text: string): boolean {
  return /\b(не\s*надо|не\s*хочу|без\s*практик|не\s*буду|пропуст|потом|позже|не\s*сейчас|skip|no\s*practice|not\s*now|maybe\s*later)\b/i.test(text);
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
  return createConversation(db, userId, body, useCase, scenarioId);
}

function turnDecisionEvent(mode: TurnMode) {
  const phaseMap: Record<TurnMode, string> = {
    opening: "contextual_greeting",
    inquiry: "deepen_inquiry",
    final_recommendation: "suggest_practice",
    final_without_practice: "confirm_and_close",
  };
  return { mode, modelTier: "premium" as const, next_phase: phaseMap[mode] };
}

/** Planned events that are still open for the working day, in deterministic order. */
function openDueEvents(context: LoadedContext): PlannedEventRow[] {
  return context.dueEvents.filter((event) => event.status === "planned");
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

    const context = await loadDialogDailyContext(db, userId);
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
      if (candidate && !candidate.ended_at && !isConversationExpired(candidate, userTimezone, new Date(), resumeTtlMs)) {
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
    const summaryDate = daySummaryRequested && typeof triggerMeta.workingLocalDate === "string" ? triggerMeta.workingLocalDate : null;

    const context = await loadDialogDailyContext(db, userId, body.userTimezone, { summarizeWholeLocalDate: summaryDate });
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
    const workingLocalDate = summaryDate ?? context.localDate;
    if (!fsm || fsm.branch === "done") {
      fsm = initFsmState({
        tabMode,
        daySummaryRequested,
        hasDueEvents: openDueEvents(context).length > 0,
        targetChakra: context.targetChakra.chakraNumber,
        workingLocalDate,
      });
      conversationMeta = await writeFsmState(db, userId, conversation.id, conversationMeta, fsm);
    }

    const brainCtx = buildBrainPromptContext(context);
    const due = openDueEvents(context);
    const currentEvent = due[0] ?? null;
    const nextEvent = due[1] ?? null;

    // ----- Build the single per-turn prompt for the current branch -----
    let prompt: { systemInstruction: string; userInstruction: string };
    if (fsm.branch === "summarizing") {
      prompt = buildSummarizingPrompt(brainCtx, {
        isOpening,
        currentEvent: currentEvent ? { ref: currentEvent.id, description: currentEvent.description } : null,
        nextEvent: nextEvent ? { description: nextEvent.description } : null,
        isLastEvent: due.length <= 1,
        clarifyingAlreadyAsked: summaryAskedCount(fsm, currentEvent?.id) >= 1,
        healthContext: formatHealthForPrompt(triggerMeta.dayHealthContext),
        practicesContext: formatPracticesForPrompt(triggerMeta.dayPractices),
        continuesToPlanning: !isLastBranch(fsm),
      });
    } else if (fsm.branch === "practice") {
      prompt = buildPracticePrompt(brainCtx, { isOpening: false });
    } else {
      prompt = buildPlanningPrompt(brainCtx, { isOpening, noPractice: fsm.noPractice, noGreeting: fsm.noGreeting });
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

    const baseHistory = mapHistoryToGemini(history);
    const currentTurnPrefix: GeminiContent[] = isInitiate ? [] : [{ role: "user", parts: [{ text: userMessage }] }];
    const directiveTurn: GeminiContent = { role: "user", parts: [{ text: prompt.userInstruction }] };
    const model = getModelByHint("premium");
    const routeDb = db;
    const routeUserId = userId;
    const fsmAtTurnStart = fsm;
    const branchForTurn = fsm.branch;
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullText = "";
          let modelUsed = model;
          for await (const chunk of streamGeminiText({
            systemInstruction: prompt.systemInstruction,
            contents: [...baseHistory, ...currentTurnPrefix, directiveTurn],
            model,
            temperature: 0.85,
            maxOutputTokens: 2200,
          })) {
            modelUsed = chunk.modelUsed;
            fullText += chunk.text;
            controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed })));
          }

          const markers = parseResponseMarkers(fullText);

          // ----- Deterministic FSM transition + persistence per branch -----
          let nextFsm: DialogFsmState = fsmAtTurnStart;
          let turnMode: TurnMode = isOpening ? "opening" : "inquiry";
          let shouldClose = false;
          let practicePicked: Record<string, unknown> | null = null;
          let recommendationCorrected: Record<string, unknown> | null = null;
          const planningPersistence: { inserted: unknown[]; updated: unknown[]; summarized: unknown[] } = {
            inserted: [],
            updated: [],
            summarized: [],
          };
          const nowIso = context.nowLocal.toUTC().toISO() ?? new Date().toISOString();

          if (branchForTurn === "planning") {
            if (markers.plannedEvents.length > 0) {
              const persisted = await persistPlanningFinalize({
                db: routeDb,
                userId: routeUserId,
                conversationId: conversation.id,
                workingLocalDate,
                timezone: userTimezone,
                nowIso,
                markers: markers.plannedEvents,
              });
              planningPersistence.inserted = persisted.filter((p) => p.action === "inserted");
              planningPersistence.updated = persisted.filter((p) => p.action === "updated");
              if (!fsmAtTurnStart.noGreeting && markers.recommendationCorrection?.short_text) {
                await persistDayFocus({
                  db: routeDb,
                  userId: routeUserId,
                  forecastId: typeof context.forecast?.id === "string" ? context.forecast.id : null,
                  shortText: markers.recommendationCorrection.short_text,
                });
                recommendationCorrected = { newShortText: markers.recommendationCorrection.short_text, ...markers.recommendationCorrection };
              }
              nextFsm = advanceBranch({ ...fsmAtTurnStart, planningFinalized: true });
              if (nextFsm.branch === "done") {
                turnMode = "final_without_practice";
                shouldClose = true;
              } else {
                turnMode = "inquiry";
              }
            } else {
              turnMode = isOpening ? "opening" : "inquiry";
            }
          } else if (branchForTurn === "practice") {
            const declined = (containsPracticeDeclined(fullText) || userDeclinesPractice(userMessage)) && !markers.practicePick;
            const validation = validateHistoryHasDurationAndType([
              ...history.filter((m) => m.role === "user"),
              { role: "user" as const, content: userMessage },
            ]);
            if (declined) {
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
            const summaryMarker = currentEvent
              ? markers.summarizeEvents.find((s) => s.ref.trim() === currentEvent.id || currentEvent.description.toLowerCase().includes(s.ref.trim().toLowerCase()))
              : undefined;
            if (!isOpening && summaryMarker && currentEvent) {
              await persistSummarizedEvent({
                db: routeDb,
                userId: routeUserId,
                event: currentEvent,
                outcomeText: summaryMarker.outcome,
                outcomeCells: summaryMarker.outcomeCells,
                nowIso,
              });
              planningPersistence.summarized = [{ id: currentEvent.id, description: currentEvent.description }];
              if (due.length <= 1) {
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
            } else if (!isOpening && currentEvent) {
              // No marker this turn: count it as the single clarifying question.
              nextFsm = bumpSummaryAsked(fsmAtTurnStart, currentEvent.id);
              turnMode = "inquiry";
            } else {
              turnMode = isOpening ? "opening" : "inquiry";
            }
          }

          const cleanText = stripBrainSentinels(sanitizeAssistantText(fullText, context.user.locale));
          if (!cleanText) {
            throw new Error("Model returned empty text after sanitization");
          }

          const completePayload = {
            conversationId: conversation.id,
            fullText: cleanText,
            shouldClose,
            modelUsed,
            latencyMs: Date.now() - requestStartedMs,
            modelTier: "premium" as const,
            turnMode,
            iteration,
            readyMarkerTriggered: turnMode === "final_recommendation",
            branches: [branchForTurn],
            targetChakra: context.targetChakra,
            phaseTime: context.phaseTime,
            validation: null,
            practicePicked: practicePicked ?? undefined,
            recommendationCorrected: recommendationCorrected ?? undefined,
          };
          controller.enqueue(encoder.encode(sse("complete", completePayload)));

          // Persist FSM + assistant message after shipping UI-critical fields.
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
                model_used: "premium",
                model_id: modelUsed,
                latency_ms: Date.now() - requestStartedMs,
                iteration,
                ready_marker_triggered: turnMode === "final_recommendation",
                practicePicked: practicePicked ?? null,
                practice_picked: practicePicked ?? null,
                recommendationCorrected,
                dialog_branches: [branchForTurn],
                target_chakra: context.targetChakra,
                phase_time: context.phaseTime,
                planning_persistence: planningPersistence,
              },
            })
            .select("id")
            .single();
          if (insertError) throw insertError;

          controller.enqueue(
            encoder.encode(
              sse("turn_artifacts", {
                messageId: inserted?.id ?? null,
                planningPersistence,
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
            controller.enqueue(encoder.encode(sse("error", { error: toUserFacingStreamErrorMessage(error) })));
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
