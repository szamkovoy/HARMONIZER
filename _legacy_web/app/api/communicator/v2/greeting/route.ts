import { generateGeminiText } from "../../../_utils/gemini";
import { greetingBypassDecision, timeOfDayContext, type DialogueUseCase } from "../../../_utils/orchestrator";
import { getActivePrompt, renderPrompt } from "../../../_utils/prompts";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  useCase?: DialogueUseCase;
  entrySource?: "home" | "event_reminder" | "practice_discuss" | "stories" | "onboarding";
  triggerMeta?: Record<string, unknown>;
  userTimezone?: string;
};

function assertUseCase(useCase: unknown): DialogueUseCase {
  return useCase === "calibration" ? "calibration" : "daily_dialog";
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const useCase = assertUseCase(body.useCase);
    const userTimezone = body.userTimezone ?? "UTC";
    const db = createServiceSupabase();
    const { data: conversation, error: conversationError } = await db
      .from("conversations")
      .insert({
        user_id: userId,
        entry_source: body.entrySource ?? "home",
        trigger_meta: body.triggerMeta ?? {},
      })
      .select("id")
      .single();
    if (conversationError) throw conversationError;

    const decision = greetingBypassDecision(useCase, userTimezone, "greeting_endpoint");
    const phasePromptKey = useCase === "calibration" ? "phase_welcome_and_hint" : "phase_contextual_greeting";
    const [phasePrompt, responderPrompt] = await Promise.all([getActivePrompt(db, phasePromptKey), getActivePrompt(db, "responder_main")]);
    const tod = timeOfDayContext(new Date(), userTimezone);
    const phaseInstruction = renderPrompt(phasePrompt.template, {
      time_of_day_greeting: tod.greeting,
      entry_source: body.entrySource ?? "home",
      entry_source_label: body.entrySource ?? "home",
      window_time: body.triggerMeta?.window_time ?? "",
    });
    const result = await generateGeminiText({
      prompt: renderPrompt(responderPrompt.template, {
        current_phase: decision.next_phase,
        phase_instruction: phaseInstruction,
        tone: decision.responder_hints?.tone ?? tod.tone,
        style_markers: {},
        user_phrases: "",
        use_user_phrases: [],
        avoid_topics: [],
        user_profile_summary: "",
        daily_context: "",
      }),
      model: phasePrompt.model_hint ?? responderPrompt.model_hint,
      temperature: phasePrompt.temperature ?? responderPrompt.temperature,
      maxOutputTokens: phasePrompt.max_output_tokens ?? responderPrompt.max_output_tokens,
    });

    const { data: message, error: messageError } = await db
      .from("messages")
      .insert({
        user_id: userId,
        conversation_id: conversation.id,
        role: "assistant",
        content: result.text.trim(),
        content_type: "text",
        meta: {
          use_case: useCase,
          orchestrator_decision: decision,
          responder: { phase_used: decision.next_phase, model_used: result.modelUsed },
        },
      })
      .select("id")
      .single();
    if (messageError) throw messageError;

    return json({
      conversationId: conversation.id,
      messageId: message.id,
      greetingText: result.text.trim(),
      decision,
      suggestedOptions: [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
