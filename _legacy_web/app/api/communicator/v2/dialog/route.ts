import type { SupabaseClient } from "@supabase/supabase-js";
import informationAxes from "../../../../../data/information_axes.json";
import { generateGeminiJson, streamGeminiText } from "../../../_utils/gemini";
import { parseResponseMarkers, stripResponseMarkers, type PracticePickMarker } from "../../../_utils/markers";
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
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type DialogueEntrySource = "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";

type Body = {
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

type MessageRecord = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  transcript: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

const HISTORY_LIMIT = 12;
const TEXT_BUDGET = 2_400;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function truncate(text: string, max = TEXT_BUDGET): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 32).trimEnd()}\n...[truncated]`;
}

function assertUseCase(useCase: unknown): DialogueUseCase {
  return useCase === "calibration" ? "calibration" : "daily_dialog";
}

function axesFor(useCase: DialogueUseCase) {
  const data = informationAxes as unknown as Record<string, { axes: Record<string, unknown>; soft_cap: number }>;
  return data[useCase] ?? { axes: {}, soft_cap: useCase === "calibration" ? 4 : 6 };
}

async function loadConversation(db: SupabaseClient, userId: string, body: Required<Pick<Body, "entrySource" | "triggerMeta">> & Body) {
  if (body.conversationId) {
    const { data, error } = await db
      .from("conversations")
      .select("*")
      .eq("id", body.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Response(JSON.stringify({ error: "Conversation not found" }), { status: 404 });
    return data as { id: string; trigger_meta?: Record<string, unknown> | null; entry_source?: string | null };
  }

  const { data, error } = await db
    .from("conversations")
    .insert({
      user_id: userId,
      entry_source: body.entrySource,
      trigger_meta: body.triggerMeta ?? {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as { id: string; trigger_meta?: Record<string, unknown> | null; entry_source?: string | null };
}

async function loadHistory(db: SupabaseClient, userId: string, conversationId: string): Promise<MessageRecord[]> {
  const { data, error } = await db
    .from("messages")
    .select("id,role,content,transcript,meta,created_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as MessageRecord[];
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
  const [calibrationResult, forecastResult] = await Promise.all([
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
  ]);
  if (calibrationResult.error) throw calibrationResult.error;
  if (forecastResult.error) throw forecastResult.error;
  return { calibration: calibrationResult.data as Record<string, unknown> | null, forecast: forecastResult.data as Record<string, unknown> | null };
}

function formatHistory(history: MessageRecord[]): string {
  return truncate(
    history
      .slice(-HISTORY_LIMIT)
      .map((message) => `${message.role}: ${message.content ?? message.transcript ?? ""}`.trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function lastUserMessage(history: MessageRecord[]): string | null {
  const message = [...history].reverse().find((item) => item.role === "user");
  return message?.content ?? message?.transcript ?? null;
}

function lastAssistantDecisions(history: MessageRecord[]): OrchestratorDecision[] {
  return history
    .filter((message) => message.role === "assistant")
    .map((message) => (message.meta?.orchestrator_decision ?? null) as OrchestratorDecision | null)
    .filter((decision): decision is OrchestratorDecision => Boolean(decision?.next_phase));
}

function profileSummary(context: Awaited<ReturnType<typeof loadContext>>): string {
  const calibration = context.calibration;
  const forecast = context.forecast;
  const phrases = Array.isArray((calibration?.user_lexicon as { phrases?: unknown[] } | undefined)?.phrases)
    ? ((calibration?.user_lexicon as { phrases: Array<{ text?: string }> }).phrases ?? [])
        .slice(0, 8)
        .map((phrase) => phrase.text)
        .filter(Boolean)
    : [];
  return truncate(
    JSON.stringify({
      calibrationVersion: calibration?.version ?? null,
      lastCalibrationDate: calibration?.last_calibration_date ?? null,
      planetOfTheDay: forecast?.planet_of_the_day ?? null,
      todayTone: (forecast?.today_planet_state as { todayTone?: string } | undefined)?.todayTone ?? null,
      userPhrases: phrases,
    }),
    1_200,
  );
}

function dailyContext(context: Awaited<ReturnType<typeof loadContext>>): string {
  const forecast = context.forecast;
  if (!forecast) return "";
  return truncate(
    JSON.stringify({
      planetOfTheDay: forecast.planet_of_the_day,
      todayPlanetState: forecast.today_planet_state,
      recommendationShortText: forecast.recommendation_short_text,
      windowsOfOpportunity: forecast.windows_of_opportunity,
    }),
    1_200,
  );
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

async function choosePractice(db: SupabaseClient, marker: PracticePickMarker | null, context: Awaited<ReturnType<typeof loadContext>>) {
  const planetToChakra: Record<string, number> = { Moon: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Mercury: 6, Sun: 7 };
  const chakraId = planetToChakra[String(context.forecast?.planet_of_the_day ?? "Sun")] ?? 7;
  const { data, error } = await db
    .from("practices")
    .select("id,slug,title,kind,default_duration_sec,practice_chakras!inner(chakra_id,weight)")
    .eq("is_active", true)
    .eq("practice_chakras.chakra_id", chakraId)
    .order("rating", { ascending: false })
    .limit(7);
  if (error) throw error;
  const stack = (data ?? []) as Array<{ id: string; slug: string; title: Record<string, string> | string | null; kind: string; default_duration_sec: number | null }>;
  const picked = stack.find((practice) => practice.id === marker?.id) ?? stack[0];
  if (!picked) return null;
  const title = typeof picked.title === "string" ? picked.title : picked.title?.ru ?? picked.title?.en ?? picked.slug;
  return { id: picked.id, name: title, reason: marker?.reason, stack };
}

async function buildDecision(params: {
  db: SupabaseClient;
  useCase: DialogueUseCase;
  userTimezone: string;
  conversationIdWasNull: boolean;
  userMessage: string;
  history: MessageRecord[];
  phases: PhaseRecord[];
  context: Awaited<ReturnType<typeof loadContext>>;
}): Promise<{ decision: OrchestratorDecision; orchestratorLatencyMs: number }> {
  const started = Date.now();
  const axes = axesFor(params.useCase);
  const iterationNumber = params.history.filter((message) => message.role === "user").length + 1;
  const greetingBypassEnabled = process.env.DIALOG_GREETING_BYPASS_ENABLED !== "false";
  if (greetingBypassEnabled && (params.conversationIdWasNull || params.history.length === 0)) {
    return {
      decision: {
        ...greetingBypassDecision(params.useCase, params.userTimezone, params.conversationIdWasNull ? "null_conversation_id" : "no_history"),
        reasoning: "Bypass: первый ход диалога, фаза детерминирована.",
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
    const similarity = contextSimilarity(params.userMessage, lastUserMessage(params.history), previousDecision);
    if (similarity > threshold) {
      return {
        decision: {
          ...previousDecision,
          reasoning: `Reused: similarity ${similarity.toFixed(2)} > ${threshold} threshold at iter ${iterationNumber}`,
          information_density: estimateDensity(params.userMessage),
          user_signals: quickSignalDetection(params.userMessage),
          decision_source: "cache_reused",
          cache_similarity: similarity,
          bypass_reason: undefined,
        },
        orchestratorLatencyMs: 0,
      };
    }
  }

  const fallbackPhase = params.useCase === "calibration" ? "deepen_specific_chakra" : "collect_state";
  const tod = timeOfDayContext(new Date(), params.userTimezone);
  const prompt = await getActivePrompt(params.db, "orchestrator_decision");
  const result = await generateGeminiJson<unknown>({
    prompt: renderPrompt(prompt.template, {
      use_case: params.useCase,
      available_phases: params.phases.map((phase) => `- ${phase.phase_id}: ${phase.description ?? ""}`).join("\n"),
      information_axes: axes,
      time_of_day: tod.timeOfDay,
      local_hour: tod.localHour,
      time_of_day_hint: tod,
      iteration_number: iterationNumber,
      soft_cap: axes.soft_cap,
      user_profile_summary: profileSummary(params.context),
      conversation_history: formatHistory(params.history),
      user_message: params.userMessage,
    }),
    model: prompt.model_hint,
    temperature: prompt.temperature,
    maxOutputTokens: prompt.max_output_tokens,
  });
  const decision = validateOrchestratorDecision(result.json, fallbackPhase);
  return {
    decision: { ...decision, decision_source: "fresh" },
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
}) {
  const tod = timeOfDayContext(new Date(), params.timezone);
  const planet = String(params.context.forecast?.planet_of_the_day ?? "Sun");
  return {
    time_of_day_greeting: tod.greeting,
    entry_source: params.body.entrySource ?? "home",
    entry_source_label: params.body.entrySource ?? "home",
    tone: params.decision.responder_hints?.tone ?? tod.tone,
    today_states_options: todayStatesOptions(params.context),
    planet_of_day_summary: `${planet}, tone=${(params.context.forecast?.today_planet_state as { todayTone?: string } | undefined)?.todayTone ?? "neutral"}`,
    user_current_state_summary: params.userMessage,
    filtered_practices_list: params.practicesList,
    deepen_axis: Object.entries(params.decision.information_completeness ?? {}).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "user_state",
    focus_chakra_label: planet,
    focus_chakra_number: { Moon: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Mercury: 6, Sun: 7 }[planet] ?? 7,
    window_time: (params.body.triggerMeta?.window_time as string | undefined) ?? "",
  };
}

export async function POST(req: Request) {
  try {
    const requestStarted = Date.now();
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const useCase = assertUseCase(body.useCase);
    const userMessage = String(body.userMessage ?? "").trim();
    const userTimezone = body.userTimezone ?? "UTC";
    if (!userMessage) return json({ error: "userMessage is required" }, { status: 400 });

    const db = createServiceSupabase();
    const conversationIdWasNull = !body.conversationId;
    const conversation = await loadConversation(db, userId, {
      ...body,
      entrySource: body.entrySource ?? "home",
      triggerMeta: body.triggerMeta ?? {},
    });
    const [history, phases, context] = await Promise.all([
      loadHistory(db, userId, conversation.id),
      loadPhases(db, useCase),
      loadContext(db, userId),
    ]);

    const { decision, orchestratorLatencyMs } = await buildDecision({
      db,
      useCase,
      userTimezone,
      conversationIdWasNull,
      userMessage,
      history,
      phases,
      context,
    });
    const phase = phases.find((item) => item.phase_id === decision.next_phase) ?? phases[0];
    decision.next_phase = phase.phase_id;

    await db.from("messages").insert({
      user_id: userId,
      conversation_id: conversation.id,
      role: "user",
      content: userMessage,
      content_type: "text",
      meta: { use_case: useCase },
    });

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

          const phasePrompt = await getActivePrompt(db, phase.prompt_key);
          const responderPrompt = await getActivePrompt(db, "responder_main");
          const practiceCandidate = await choosePractice(db, null, context);
          const practicesList = JSON.stringify(
            (practiceCandidate?.stack ?? []).map((practice) => ({
              id: practice.id,
              title: typeof practice.title === "string" ? practice.title : practice.title?.ru ?? practice.title?.en ?? practice.slug,
              kind: practice.kind,
              durationSec: practice.default_duration_sec,
            })),
          );
          const renderedPhase = renderPrompt(
            phasePrompt.template,
            phaseVariables({ body, context, decision, userMessage, timezone: userTimezone, practicesList }),
          );
          const prompt = renderPrompt(responderPrompt.template, {
            current_phase: phase.phase_id,
            phase_instruction: renderedPhase,
            tone: decision.responder_hints?.tone ?? "neutral",
            style_markers: (context.calibration?.user_lexicon as { style_markers?: unknown } | undefined)?.style_markers ?? {},
            user_phrases: profileSummary(context),
            use_user_phrases: decision.responder_hints?.use_user_phrases ?? [],
            avoid_topics: decision.responder_hints?.avoid_topics ?? [],
            user_profile_summary: profileSummary(context),
            daily_context: useCase === "daily_dialog" ? dailyContext(context) : "",
          });

          let fullText = "";
          let modelUsed = phasePrompt.model_hint ?? responderPrompt.model_hint ?? "gemini";
          for await (const chunk of streamGeminiText({
            prompt,
            model: phasePrompt.model_hint ?? responderPrompt.model_hint,
            temperature: phasePrompt.temperature ?? responderPrompt.temperature,
            maxOutputTokens: phasePrompt.max_output_tokens ?? responderPrompt.max_output_tokens,
          })) {
            modelUsed = chunk.modelUsed;
            if (firstTokenLatencyMs == null) firstTokenLatencyMs = Date.now() - requestStarted;
            fullText += chunk.text;
            controller.enqueue(encoder.encode(sse("chunk", { text: chunk.text })));
          }

          const markers = parseResponseMarkers(fullText);
          const cleanText = stripResponseMarkers(fullText);
          const finalPractice = phase.phase_id === "suggest_practice" ? await choosePractice(db, markers.practicePick, context) : null;

          if (markers.stateProposals.length) {
            await db.from("ai_state_proposals").insert(
              markers.stateProposals.map((proposal) => ({
                ...proposal,
                user_id: userId,
                conversation_id: conversation.id,
              })),
            );
          }
          if (markers.recommendationCorrection && context.forecast?.id) {
            await db
              .from("user_daily_forecasts")
              .update({
                recommendation_short_text: markers.recommendationCorrection.short_text ?? context.forecast.recommendation_short_text,
                is_corrected_via_dialog: true,
                corrected_at: new Date().toISOString(),
              })
              .eq("id", context.forecast.id);
          }

          const shouldClose = phase.is_terminal || decision.should_close;
          const { data: assistantMessage, error: messageError } = await db
            .from("messages")
            .insert({
              user_id: userId,
              conversation_id: conversation.id,
              role: "assistant",
              content: cleanText,
              content_type: "text",
              meta: {
                use_case: useCase,
                orchestrator_decision: decision,
                responder: {
                  phase_used: phase.phase_id,
                  extracted_states: markers.stateProposals.map((proposal) => proposal.proposed_label),
                  ai_state_proposals: markers.stateProposals,
                  model_used: modelUsed,
                },
              },
            })
            .select("id")
            .single();
          if (messageError) throw messageError;

          if (shouldClose) await db.from("conversations").update({ ended_at: new Date().toISOString() }).eq("id", conversation.id);
          await db.from("user_event_log").insert({
            user_id: userId,
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
                practicePicked: finalPractice
                  ? { id: finalPractice.id, name: finalPractice.name, reason: finalPractice.reason ?? markers.practicePick?.reason }
                  : undefined,
                recommendationCorrected: markers.recommendationCorrection
                  ? { newShortText: markers.recommendationCorrection.short_text, ...markers.recommendationCorrection }
                  : undefined,
              }),
            ),
          );
          controller.close();
        } catch (error) {
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
    return errorResponse(error);
  }
}
