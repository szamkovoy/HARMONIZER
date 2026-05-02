import type { SupabaseClient } from "@supabase/supabase-js";
import informationAxes from "../../../../../data/information_axes.json";
import { buildAddressFormHint } from "../../../_utils/addressForm";
import { natalProfileFromRow } from "../../../_utils/astro-db";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "../../../_utils/authorVoice";
import { buildForecastCompact, buildHistoryCompact, buildProfileCompact, logDTOSize } from "../../../_utils/dto";
import { GeminiJsonParseError, generateGeminiJson, getModelByHint, streamGeminiText } from "../../../_utils/gemini";
import { dialogSurfaceModelHint } from "../../../_utils/userModelTier";
import {
  computeCSI,
  computeETV,
  detectInsightMoment,
  detectTTMStage,
  estimateEmotionalValence,
  isReadyForPractice,
} from "../../../_utils/insightDetection";
import { parseResponseMarkers, stripResponseMarkers } from "../../../_utils/markers";
import { reportRouteError } from "../../../_utils/monitoring";
import {
  contextSimilarity,
  estimateDensity,
  greetingBypassDecision,
  quickSignalDetection,
  shouldForceFreshDecision,
  TERMINAL_PHASES,
  timeOfDayContext,
  validateOrchestratorDecision,
  type DialogueUseCase,
  type OrchestratorDecision,
} from "../../../_utils/orchestrator";
import { getActivePrompt, renderPrompt } from "../../../_utils/prompts";
import { getScenario } from "../../../_utils/scenarios";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";
import {
  isConversationExpired,
  lastAssistantDecisions,
  loadDayBackground,
  loadHistory,
  summarizeConversationIfNeeded,
  type ConversationRecord,
  type MessageRecord,
} from "./dialogHelpers";
import {
  choosePractice,
  publicPracticePickedPayload,
  shouldStayInPracticeSuggestion,
  type PracticePickedPayload,
} from "./practiceSelection";

export const runtime = "nodejs";

type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";

type Body = {
  scenario_id?: string;
  conversationId?: string | null;
  useCase?: DialogueUseCase;
  entrySource?: DialogueEntrySource;
  triggerMeta?: Record<string, unknown>;
  userMessage?: string;
  userTimezone?: string;
};

type PhaseRecord = {
  phase_id: string;
  prompt_key: string;
  is_terminal: boolean;
  is_silent: boolean;
  description: string | null;
  display_order: number | null;
};

const PRACTICE_STACK_PHASES = new Set(["suggest_practice", "ask_practice_intent"]);

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function warnDeprecatedDialogRoute(req: Request): void {
  if (new URL(req.url).pathname.includes("/api/communicator/v2/dialog")) {
    console.warn("[DEPRECATED] /api/communicator/v2/dialog is deprecated. Use /api/ai/dialog with scenario_id.");
  }
}

function assertUseCase(useCase: unknown): DialogueUseCase {
  return typeof useCase === "string" && useCase.trim() ? useCase.trim() : "daily_dialog";
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
  return { useCase: scenario.dialogue_use_case, scenarioId: scenario.id };
}

function axesFor(useCase: DialogueUseCase) {
  const data = informationAxes as unknown as Record<string, { axes: Record<string, unknown>; soft_cap: number }>;
  return data[useCase] ?? { axes: {}, soft_cap: useCase === "calibration" ? 4 : 6 };
}

function conversationTriggerMeta(body: Required<Pick<Body, "entrySource" | "triggerMeta">> & Body, useCase: DialogueUseCase) {
  return {
    ...(body.triggerMeta ?? {}),
    use_case: useCase,
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
        ...conversationTriggerMeta(body, useCase),
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

async function loadPhases(db: SupabaseClient, useCase: DialogueUseCase): Promise<PhaseRecord[]> {
  const { data, error } = await db
    .from("dialogue_phases")
    .select("phase_id,prompt_key,is_terminal,is_silent,description,display_order")
    .eq("use_case", useCase)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  if (!data?.length) throw new Response(JSON.stringify({ error: `No dialogue phases for ${useCase}` }), { status: 500 });
  return data as PhaseRecord[];
}

async function loadContext(db: SupabaseClient, userId: string) {
  const [calibrationResult, forecastResult, natalResult, userResult] = await Promise.all([
    db
      .from("user_calibrations")
      .select("version,states_map,user_lexicon,s_calibrated,h_calibrated,last_calibration_date")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("user_daily_forecasts")
      .select("*")
      .eq("user_id", userId)
      .order("forecast_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("user_natal_charts")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("users")
      .select("display_name,birth_date,locale,address_form,tz,membership_tier,trial_expires_at")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (calibrationResult.error) throw calibrationResult.error;
  if (forecastResult.error) throw forecastResult.error;
  if (natalResult.error) throw natalResult.error;
  if (userResult.error) throw userResult.error;
  return {
    calibration: calibrationResult.data as Record<string, unknown> | null,
    forecast: forecastResult.data as Record<string, unknown> | null,
    natal: natalResult.data ? natalProfileFromRow(natalResult.data as never) : null,
    user:
      (userResult.data as {
        display_name?: string | null;
        birth_date?: string | null;
        locale?: string | null;
        address_form?: string | null;
        tz?: string | null;
        membership_tier?: string | null;
        trial_expires_at?: string | null;
      } | null) ?? {},
  };
}

function lastUserMessage(history: MessageRecord[]): string | null {
  const message = [...history].reverse().find((item) => item.role === "user");
  return message?.content ?? message?.transcript ?? null;
}

function relevantUserPhrases(context: Awaited<ReturnType<typeof loadContext>>): string[] {
  const calibration = context.calibration;
  const forecast = context.forecast;
  const planet = String(forecast?.planet_of_the_day ?? "");
  const phrases = Array.isArray((calibration?.user_lexicon as { phrases?: unknown[] } | undefined)?.phrases)
    ? ((calibration?.user_lexicon as { phrases: Array<{ text?: string }> }).phrases ?? [])
        .filter((phrase) => !planet || (phrase as { associated_planet?: string }).associated_planet === planet)
        .slice(0, 5)
        .map((phrase) => phrase.text)
        .filter(Boolean)
    : [];
  return phrases as string[];
}

function todayStatesOptions(context: Awaited<ReturnType<typeof loadContext>>): string {
  const planet = String(context.forecast?.planet_of_the_day ?? "Sun");
  const statesMap = context.calibration?.states_map as Record<string, { positive_states?: Array<{ label?: string }>; negative_states?: Array<{ label?: string }> }> | undefined;
  const states = statesMap?.[planet];
  const labels = [...(states?.positive_states ?? []), ...(states?.negative_states ?? [])]
    .map((item) => item.label)
    .filter(Boolean)
    .slice(0, 6);
  return labels.join(", ");
}

async function logPromptSize(db: SupabaseClient, userId: string, payload: Record<string, unknown>) {
  const { error } = await db.from("user_event_log").insert({
    user_id: userId,
    kind: "llm_prompt_size",
    payload,
  });
  if (error) console.warn("[dialog] Failed to log prompt size", error);
}

function isGeminiJsonParseError(error: unknown): error is GeminiJsonParseError {
  return (
    error instanceof GeminiJsonParseError ||
    (error instanceof Error &&
      (error.name === "GeminiJsonParseError" || /Gemini response is not valid JSON/i.test(error.message)))
  );
}

function userMessageText(message: MessageRecord): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

function buildInsightMetrics(history: MessageRecord[], userMessage: string, locale?: string | null): NonNullable<OrchestratorDecision["insight_metrics"]> {
  const language = (locale ?? "ru").slice(0, 2);
  const previousUserMessages = history.filter((message) => message.role === "user").map(userMessageText).filter(Boolean);
  const recentMessages = [...previousUserMessages, userMessage].slice(-5);
  const csiTrend = recentMessages.map((message) => computeCSI(message, language));
  const insight = detectInsightMoment(csiTrend);
  const valenceTrend = recentMessages.map((message) => estimateEmotionalValence(message, language));
  const ttm = detectTTMStage(recentMessages, language);
  const readiness = isReadyForPractice(ttm.stage);

  return {
    csi: csiTrend.at(-1) ?? 0,
    csi_trend: csiTrend,
    insight_detected: insight.detected,
    insight_confidence: insight.confidence,
    ttm_stage: ttm.stage,
    ttm_confidence: ttm.confidence,
    ready_for_practice: readiness.ready,
    readiness_reason: readiness.reason,
    etv: computeETV(valenceTrend),
    valence_trend: valenceTrend,
  };
}

function blockedPhasesForInsight(metrics: NonNullable<OrchestratorDecision["insight_metrics"]>, useCase: DialogueUseCase): string[] {
  if (useCase !== "daily_dialog" || metrics.ready_for_practice) return [];
  return ["ask_practice_intent", "suggest_practice"];
}

function etvHint(etv: number): string {
  if (etv > 0.6) return "high (пользователь раскачивается, копай глубже)";
  if (etv < 0.3) return "low (стабилен, можно к практике при готовности)";
  return "moderate";
}

function ttmHint(metrics: NonNullable<OrchestratorDecision["insight_metrics"]>): string {
  return `Стадия готовности: ${metrics.ttm_stage}. ${
    metrics.ready_for_practice ? "Готов к практике." : `НЕ ГОТОВ к практике (${metrics.readiness_reason}).`
  }`;
}

function insightHint(metrics: NonNullable<OrchestratorDecision["insight_metrics"]>): string {
  return metrics.insight_detected
    ? `Инсайт детектирован (CSI=${(metrics.insight_confidence ?? 0).toFixed(2)}). Можно закреплять или переходить к практике, если TTM позволяет.`
    : "Инсайт не детектирован.";
}

function enforceInsightPhaseGuards(decision: OrchestratorDecision, metrics: NonNullable<OrchestratorDecision["insight_metrics"]>, useCase: DialogueUseCase): OrchestratorDecision {
  if (useCase !== "daily_dialog" || metrics.ready_for_practice) return decision;
  if (decision.next_phase !== "ask_practice_intent" && decision.next_phase !== "suggest_practice") return decision;

  return {
    ...decision,
    next_phase: metrics.ttm_stage === "preconcept" ? "deepen_inquiry" : "offer_insight",
    reasoning: `${decision.reasoning} Insight Engine guard: ${metrics.ttm_stage} blocks practice (${metrics.readiness_reason}).`,
    should_close: false,
    close_reason: null,
  };
}

async function buildDecision(params: {
  db: SupabaseClient;
  userId: string;
  useCase: DialogueUseCase;
  userTimezone: string;
  conversationIdWasNull: boolean;
  clientGreetingShown: boolean;
  userMessage: string;
  history: MessageRecord[];
  phases: PhaseRecord[];
  context: Awaited<ReturnType<typeof loadContext>>;
}): Promise<{ decision: OrchestratorDecision; orchestratorLatencyMs: number }> {
  const started = Date.now();
  const axes = axesFor(params.useCase);
  const iterationNumber = params.history.filter((message) => message.role === "user").length + 1;
  const insightMetrics = buildInsightMetrics(params.history, params.userMessage, params.context.user.locale);
  const blockedPhases = blockedPhasesForInsight(insightMetrics, params.useCase);
  const greetingBypassEnabled = process.env.DIALOG_GREETING_BYPASS_ENABLED !== "false";
  if (greetingBypassEnabled && !params.clientGreetingShown && (params.conversationIdWasNull || params.history.length === 0)) {
    return {
      decision: {
        ...greetingBypassDecision(
          params.useCase,
          params.userTimezone,
          params.conversationIdWasNull ? "null_conversation_id" : "no_history",
          params.phases[0]?.phase_id,
        ),
        reasoning: "Bypass: первый ход диалога, фаза детерминирована.",
        insight_metrics: insightMetrics,
      },
      orchestratorLatencyMs: 0,
    };
  }

  const previousDecisions = lastAssistantDecisions(params.history);
  const previousDecision = previousDecisions.at(-1);
  const cacheEnabled = process.env.DIALOG_DECISION_CACHE_ENABLED !== "false";
  const minIteration = Number(process.env.DIALOG_DECISION_CACHE_MIN_ITERATION ?? 3);
  const threshold = Number(process.env.DIALOG_DECISION_CACHE_THRESHOLD ?? 0.8);
  if (
    cacheEnabled &&
    iterationNumber >= minIteration &&
    previousDecision &&
    !TERMINAL_PHASES.has(previousDecision.next_phase) &&
    !shouldForceFreshDecision(previousDecisions)
  ) {
    const similarity = contextSimilarity(params.userMessage, lastUserMessage(params.history), previousDecision, params.context.user.locale);
    if (similarity > threshold) {
      const reusedDecision = enforceInsightPhaseGuards(
        {
          ...previousDecision,
          reasoning: `Reused: similarity ${similarity.toFixed(2)} > ${threshold} threshold at iter ${iterationNumber}`,
          information_density: estimateDensity(params.userMessage),
          user_signals: quickSignalDetection(params.userMessage, params.context.user.locale),
          insight_metrics: insightMetrics,
          decision_source: "cache_reused",
          cache_similarity: similarity,
          bypass_reason: undefined,
        },
        insightMetrics,
        params.useCase,
      );
      return {
        decision: reusedDecision,
        orchestratorLatencyMs: 0,
      };
    }
  }

  const fallbackPhase = params.useCase === "calibration" ? "deepen_specific_chakra" : "collect_state";
  const tod = timeOfDayContext(new Date(), params.userTimezone);
  const prompt = await getActivePrompt(params.db, "orchestrator_decision");
  const profileDTO = buildProfileCompact(params.context.natal, params.context.calibration, params.context.user);
  const historyDTO = buildHistoryCompact(params.history);
  const profileSize = logDTOSize("dialog.orchestrator.profile", profileDTO, 350);
  const historySize = logDTOSize("dialog.orchestrator.history", historyDTO, 1500);
  await logPromptSize(params.db, params.userId, {
    endpoint: "communicator/v2/dialog",
    stage: "orchestrator",
    profile_tokens: profileSize.tokens,
    history_tokens: historySize.tokens,
    total_tokens: profileSize.tokens + historySize.tokens,
  });
  const renderedPrompt = renderPrompt(prompt.template, {
      use_case: params.useCase,
      available_phases: params.phases.map((phase) => `- ${phase.phase_id}: ${phase.description ?? ""}`).join("\n"),
      information_axes: axes,
      blocked_phases: blockedPhases.join(", ") || "none",
      insight_metrics_json: insightMetrics,
      ttm_hint: ttmHint(insightMetrics),
      etv_hint: etvHint(insightMetrics.etv),
      insight_hint: insightHint(insightMetrics),
      time_of_day: tod.timeOfDay,
      local_hour: tod.localHour,
      time_of_day_hint: tod,
      iteration_number: iterationNumber,
      soft_cap: axes.soft_cap,
      user_profile_summary: profileDTO,
      conversation_history: historyDTO,
      user_message: params.userMessage,
  });

  let decision: OrchestratorDecision;
  try {
    const result = await generateGeminiJson<unknown>({
      prompt: renderedPrompt,
      model: getModelByHint(prompt.model_hint),
      temperature: prompt.temperature,
      maxOutputTokens: prompt.max_output_tokens,
    });
    decision = validateOrchestratorDecision(result.json, fallbackPhase);
  } catch (error) {
    if (!isGeminiJsonParseError(error)) throw error;
    const rawText = error instanceof GeminiJsonParseError ? error.rawText : "";
    await logPromptSize(params.db, params.userId, {
      endpoint: "communicator/v2/dialog",
      stage: "orchestrator_json_recovery",
      parse_error: error.message,
      raw_preview: rawText.slice(0, 500),
    });
    decision = validateOrchestratorDecision(
      {
        next_phase: fallbackPhase,
        reasoning: "Fallback: orchestrator returned invalid JSON, continuing with a safe phase.",
        information_completeness: {},
        information_density: estimateDensity(params.userMessage),
        user_signals: quickSignalDetection(params.userMessage, params.context.user.locale),
        insight_metrics: insightMetrics,
        should_close: false,
        close_reason: null,
        responder_hints: { tone: tod.tone, use_user_phrases: [], avoid_topics: [] },
      },
      fallbackPhase,
    );
  }
  return {
    decision: enforceInsightPhaseGuards({ ...decision, insight_metrics: insightMetrics, decision_source: "fresh" }, insightMetrics, params.useCase),
    orchestratorLatencyMs: Date.now() - started,
  };
}

function phaseVariables(params: {
  body: Body;
  context: Awaited<ReturnType<typeof loadContext>>;
  decision: OrchestratorDecision;
  userMessage: string;
  timezone: string;
  practicesList: string;
  selectedPractice: Omit<PracticePickedPayload, "stack"> | null;
}) {
  const tod = timeOfDayContext(new Date(), params.timezone);
  const planet = String(params.context.forecast?.planet_of_the_day ?? "Sun");
  const todayTone = (params.context.forecast?.today_planet_state as { todayTone?: string; today_tone?: string } | undefined)?.todayTone
    ?? (params.context.forecast?.today_planet_state as { today_tone?: string } | undefined)?.today_tone
    ?? "neutral";
  const addressFormHint = buildAddressFormHint(params.context.user.address_form, params.context.user.locale);
  return {
    time_of_day_greeting: tod.greeting,
    time_of_day: tod.timeOfDay,
    local_hour: tod.localHour,
    entry_source: params.body.entrySource ?? "home",
    entry_source_label: params.body.entrySource ?? "home",
    tone: params.decision.responder_hints?.tone ?? tod.tone,
    today_states_options: todayStatesOptions(params.context),
    planet_of_day_summary: `${planet}, tone=${todayTone}`,
    today_tone: todayTone,
    user_current_state_summary: params.userMessage,
    user_last_message: params.userMessage,
    filtered_practices_list: params.practicesList,
    selected_practice: params.selectedPractice ?? {},
    selected_practice_id: params.selectedPractice?.id ?? "",
    deepen_axis: Object.entries(params.decision.information_completeness ?? {}).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "user_state",
    focus_chakra_label: planet,
    focus_chakra_number: { Moon: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Mercury: 6, Sun: 7 }[planet] ?? 7,
    window_time: (params.body.triggerMeta?.window_time as string | undefined) ?? "",
    address_form_hint: addressFormHint,
    user_key_phrases_from_dialog: relevantUserPhrases(params.context).join(", "),
  };
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
      useCase: url.searchParams.get("useCase") ?? undefined,
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
    const requestStarted = Date.now();
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const userMessage = String(body.userMessage ?? "").trim();
    if (!userMessage) return json({ error: "userMessage is required" }, { status: 400 });

    db = createServiceSupabase();
    const { useCase, scenarioId } = await resolveDialogueScenario(db, body);
    const conversationIdWasNull = !body.conversationId;
    endpointStage = "load_context";
    const [context, phases] = await Promise.all([loadContext(db, userId), loadPhases(db, useCase)]);
    const userTimezone = context.user.tz ?? body.userTimezone ?? "UTC";
    const conversation = await loadConversation(db, userId, {
      ...body,
      entrySource: body.entrySource ?? "home",
      triggerMeta: body.triggerMeta ?? {},
    }, useCase, scenarioId, userTimezone);
    const [history, dailyBackground] = await Promise.all([
      loadHistory(db, userId, conversation.id),
      loadDayBackground(db, userId, userTimezone),
    ]);

    endpointStage = "orchestrator";
    const { decision, orchestratorLatencyMs } = await buildDecision({
      db,
      userId,
      useCase,
      userTimezone,
      conversationIdWasNull,
      clientGreetingShown: body.triggerMeta?.clientGreetingShown === true,
      userMessage,
      history,
      phases,
      context,
    });
    if (body.triggerMeta?.clientGreetingShown === true && decision.next_phase === "contextual_greeting") {
      decision.next_phase = useCase === "daily_dialog" ? "offer_insight" : "deepen_specific_chakra";
      decision.reasoning = "Client greeting was already shown; answering the user's message instead of greeting again.";
    }
    if (shouldStayInPracticeSuggestion({ useCase, history, userMessage })) {
      decision.next_phase = "suggest_practice";
      decision.reasoning = `${decision.reasoning} User reacted to the last practice offer; staying in suggest_practice and rotating the practice stack.`;
      decision.should_close = false;
      decision.close_reason = null;
    }
    const phase = phases.find((item) => item.phase_id === decision.next_phase) ?? phases[0];
    decision.next_phase = phase.phase_id;

    await db.from("messages").insert({
      user_id: userId,
      conversation_id: conversation.id,
      role: "user",
      content: userMessage,
      content_type: "text",
      meta: { use_case: useCase, scenario_id: scenarioId },
    });

    const routeDb = db;
    const routeUserId = userId;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let firstTokenLatencyMs: number | null = null;
        try {
          controller.enqueue(encoder.encode(sse("orchestrator_decision", decision)));
          if (phase.is_silent) {
            controller.enqueue(
              encoder.encode(sse("complete", { conversationId: conversation.id, fullText: "", shouldClose: false })),
            );
            controller.close();
            return;
          }

          const phasePrompt = await getActivePrompt(routeDb, phase.prompt_key);
          const responderPrompt = await getActivePrompt(routeDb, "responder_main");
          const practiceCandidate = PRACTICE_STACK_PHASES.has(phase.phase_id) ? await choosePractice(routeDb, routeUserId, null, context, userMessage, history) : null;
          const practicesList = practiceCandidate
            ? JSON.stringify(
                (practiceCandidate.stack ?? []).map((practice) => ({
                  id: practice.id,
                  title: typeof practice.title === "string" ? practice.title : practice.title?.ru ?? practice.title?.en ?? practice.slug,
                  kind: practice.kind,
                  durationSec: practice.default_duration_sec,
                })),
              )
            : "";
          const profileDTO = buildProfileCompact(context.natal, context.calibration, context.user);
          const forecastDTO = useCase === "daily_dialog" ? buildForecastCompact(context.forecast) : null;
          const historyDTO = buildHistoryCompact(history);
          const authorVoiceBlock = formatAuthorVoiceForPrompt(
            getAuthorVoice(context.user.locale),
            context.user.address_form === "informal" ? "ty" : "vy",
          );
          const profileSize = logDTOSize("dialog.responder.profile", profileDTO, 350);
          const forecastSize = logDTOSize("dialog.responder.forecast", forecastDTO, 200);
          const historySize = logDTOSize("dialog.responder.history", historyDTO, 1500);
          await logPromptSize(routeDb, routeUserId, {
            endpoint: "communicator/v2/dialog",
            stage: "responder",
            phase: phase.phase_id,
            profile_tokens: profileSize.tokens,
            forecast_tokens: forecastSize.tokens,
            history_tokens: historySize.tokens,
            practices_tokens: logDTOSize("dialog.responder.practices", practicesList, 250).tokens,
            total_tokens: profileSize.tokens + forecastSize.tokens + historySize.tokens,
          });
          const renderedPhase = renderPrompt(
            phasePrompt.template,
            phaseVariables({
              body,
              context,
              decision,
              userMessage,
              timezone: userTimezone,
              practicesList,
              selectedPractice: practiceCandidate ? publicPracticePickedPayload(practiceCandidate) : null,
            }),
          );
          const prompt = renderPrompt(responderPrompt.template, {
            author_voice_block: authorVoiceBlock,
            current_phase: phase.phase_id,
            phase_instruction: renderedPhase,
            tone: decision.responder_hints?.tone ?? "neutral",
            style_markers: (context.calibration?.user_lexicon as { style_markers?: unknown } | undefined)?.style_markers ?? {},
            user_phrases: relevantUserPhrases(context),
            use_user_phrases: decision.responder_hints?.use_user_phrases ?? [],
            avoid_topics: decision.responder_hints?.avoid_topics ?? [],
            user_profile_summary: profileDTO,
            daily_context: forecastDTO,
            daily_background: dailyBackground,
            history: historyDTO,
          });

          const responderModel = dialogSurfaceModelHint(responderPrompt.model_hint, context.user);
          let fullText = "";
          let modelUsed = getModelByHint(responderModel);
          for await (const chunk of streamGeminiText({
            prompt,
            model: getModelByHint(responderModel),
            temperature: responderPrompt.temperature,
            maxOutputTokens: responderPrompt.max_output_tokens,
          })) {
            modelUsed = chunk.modelUsed;
            if (firstTokenLatencyMs == null) firstTokenLatencyMs = Date.now() - requestStarted;
            fullText += chunk.text;
            controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text, modelUsed })));
          }

          const markers = parseResponseMarkers(fullText);
          const cleanText = stripResponseMarkers(fullText);
          const finalPractice = phase.phase_id === "suggest_practice" ? await choosePractice(routeDb, routeUserId, markers.practicePick, context, userMessage, history) : null;
          const finalPracticePublic = finalPractice
            ? publicPracticePickedPayload(finalPractice, markers.practicePick?.reason)
            : undefined;

          if (markers.stateProposals.length) {
            const stateProposalExpiresAt = new Date();
            stateProposalExpiresAt.setUTCDate(stateProposalExpiresAt.getUTCDate() + 30);
            const expiresAtIso = stateProposalExpiresAt.toISOString();
            await routeDb.from("ai_state_proposals").insert(
              markers.stateProposals.map((proposal) => ({
                ...proposal,
                user_id: routeUserId,
                conversation_id: conversation.id,
                expires_at: expiresAtIso,
              })),
            );
          }
          if (markers.recommendationCorrection && context.forecast?.id) {
            await routeDb
              .from("user_daily_forecasts")
              .update({
                recommendation_short_text: markers.recommendationCorrection.short_text ?? context.forecast.recommendation_short_text,
                is_corrected_via_dialog: true,
                corrected_at: new Date().toISOString(),
              })
              .eq("id", context.forecast.id);
          }

          const shouldClose = phase.is_terminal || decision.should_close;
          const { data: assistantMessage, error: messageError } = await routeDb
            .from("messages")
            .insert({
              user_id: routeUserId,
              conversation_id: conversation.id,
              role: "assistant",
              content: cleanText,
              content_type: "text",
              meta: {
                use_case: useCase,
                scenario_id: scenarioId,
                orchestrator_decision: decision,
                responder: {
                  phase_used: phase.phase_id,
                  extracted_states: markers.stateProposals.map((proposal) => proposal.proposed_label),
                  ai_state_proposals: markers.stateProposals,
                  model_used: modelUsed,
                },
                practice_picked: finalPracticePublic,
              },
            })
            .select("id")
            .single();
          if (messageError) throw messageError;

          if (shouldClose) await routeDb.from("conversations").update({ ended_at: new Date().toISOString() }).eq("id", conversation.id);
          await routeDb.from("user_event_log").insert({
            user_id: routeUserId,
            kind: "dialog_turn",
            payload: {
              conversation_id: conversation.id,
              decision_source: decision.decision_source,
              phase: phase.phase_id,
              orchestrator_latency_ms: orchestratorLatencyMs,
              first_token_latency_ms: firstTokenLatencyMs,
              cache_similarity: decision.cache_similarity ?? null,
            },
          });

          controller.enqueue(
            encoder.encode(
              sse("complete", {
                conversationId: conversation.id,
                messageId: assistantMessage.id,
                fullText: cleanText,
                shouldClose,
                modelUsed,
                practicePicked: finalPracticePublic,
                recommendationCorrected: markers.recommendationCorrection
                  ? { newShortText: markers.recommendationCorrection.short_text, ...markers.recommendationCorrection }
                  : undefined,
              }),
            ),
          );
          controller.close();
        } catch (error) {
          await reportRouteError(error, {
            db: routeDb,
            userId: routeUserId,
            endpoint: "communicator/v2/dialog",
            stage: "responder_stream",
            payload: {
              conversation_id: conversation.id,
              phase: phase.phase_id,
              use_case: useCase,
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
