import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAddressFormHint } from "../../../_utils/addressForm";
import { natalProfileFromRow } from "../../../_utils/astro-db";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "../../../_utils/authorVoice";
import { buildForecastCompact, buildProfileCompact, logDTOSize } from "../../../_utils/dto";
import { generateGeminiText, getModelByHint } from "../../../_utils/gemini";
import { dialogSurfaceModelHint } from "../../../_utils/userModelTier";
import { reportRouteError } from "../../../_utils/monitoring";
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

async function loadGreetingContext(db: SupabaseClient, userId: string) {
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
      .select("display_name,birth_date,locale,address_form,membership_tier,trial_expires_at")
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
        membership_tier?: string | null;
        trial_expires_at?: string | null;
      } | null) ?? {},
  };
}

async function logPromptSize(db: SupabaseClient, userId: string, payload: Record<string, unknown>) {
  const { error } = await db.from("user_event_log").insert({
    user_id: userId,
    kind: "llm_prompt_size",
    payload,
  });
  if (error) console.warn("[greeting] Failed to log prompt size", error);
}

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const useCase = assertUseCase(body.useCase);
    const userTimezone = body.userTimezone ?? "UTC";
    db = createServiceSupabase();
    endpointStage = "create_conversation";
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
    const [phasePrompt, responderPrompt, context] = await Promise.all([
      getActivePrompt(db, phasePromptKey),
      getActivePrompt(db, "responder_main"),
      loadGreetingContext(db, userId),
    ]);
    const tod = timeOfDayContext(new Date(), userTimezone);
    const profileDTO = buildProfileCompact(context.natal, context.calibration, context.user);
    const forecastDTO = useCase === "daily_dialog" ? buildForecastCompact(context.forecast) : null;
    const todayTone = (context.forecast?.today_planet_state as { todayTone?: string; today_tone?: string } | undefined)?.todayTone
      ?? (context.forecast?.today_planet_state as { today_tone?: string } | undefined)?.today_tone
      ?? "neutral";
    const planetOfDay = String(context.forecast?.planet_of_the_day ?? "Sun");
    const addressFormHint = buildAddressFormHint(context.user.address_form, context.user.locale);
    const authorVoiceBlock = formatAuthorVoiceForPrompt(
      getAuthorVoice(context.user.locale),
      context.user.address_form === "informal" ? "ty" : "vy",
    );
    const profileSize = logDTOSize("greeting.profile", profileDTO, 350);
    const forecastSize = logDTOSize("greeting.forecast", forecastDTO, 200);
    await logPromptSize(db, userId, {
      endpoint: "communicator/v2/greeting",
      stage: "responder",
      profile_tokens: profileSize.tokens,
      forecast_tokens: forecastSize.tokens,
      total_tokens: profileSize.tokens + forecastSize.tokens,
    });
    const phaseInstruction = renderPrompt(phasePrompt.template, {
      time_of_day_greeting: tod.greeting,
      time_of_day: tod.timeOfDay,
      local_hour: tod.localHour,
      entry_source: body.entrySource ?? "home",
      entry_source_label: body.entrySource ?? "home",
      planet_of_day_summary: `${planetOfDay}, tone=${todayTone}`,
      today_tone: todayTone,
      address_form_hint: addressFormHint,
      window_time: body.triggerMeta?.window_time ?? "",
    });
    endpointStage = "responder";
    const greetingModel = dialogSurfaceModelHint(responderPrompt.model_hint, context.user);
    const result = await generateGeminiText({
      prompt: renderPrompt(responderPrompt.template, {
        author_voice_block: authorVoiceBlock,
        current_phase: decision.next_phase,
        phase_instruction: phaseInstruction,
        tone: decision.responder_hints?.tone ?? tod.tone,
        style_markers: {},
        user_phrases: "",
        use_user_phrases: [],
        avoid_topics: [],
        user_profile_summary: profileDTO,
        daily_context: forecastDTO,
      }),
      model: getModelByHint(greetingModel),
      temperature: responderPrompt.temperature,
      maxOutputTokens: responderPrompt.max_output_tokens,
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
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/greeting",
      stage: endpointStage,
    });
    return errorResponse(error);
  }
}
