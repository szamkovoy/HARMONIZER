import type { SupabaseClient } from "@supabase/supabase-js";
import { generateGeminiText, proModel, proModelChain } from "../../../_utils/gemini";
import { reportRouteError } from "../../../_utils/monitoring";
import { getActivePrompt, renderPrompt } from "../../../_utils/prompts";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  forecastDate?: string;
  mode?: "short" | "long";
  context?: Record<string, unknown>;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  let endpointStage = "request";
  try {
    userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const mode = body.mode === "long" ? "long" : "short";
    db = createServiceSupabase();
    endpointStage = "load_forecast";
    const { data: forecast, error: forecastError } = await db
      .from("user_daily_forecasts")
      .select("*")
      .eq("user_id", userId)
      .eq("forecast_date", body.forecastDate ?? todayIsoDate())
      .maybeSingle();
    if (forecastError) throw forecastError;
    if (!forecast) return json({ error: "Forecast not found" }, { status: 404 });

    endpointStage = "recommendation_generation";
    const prompt = await getActivePrompt(db, mode === "long" ? "recommendation_long" : "recommendation_short");
    const result = await generateGeminiText({
      prompt: renderPrompt(prompt.template, {
        forecast_json: forecast,
        context_json: body.context ?? {},
        planet_of_the_day: forecast.planet_of_the_day,
      }),
      model: proModel(),
      fallbackModels: proModelChain(),
      temperature: prompt.temperature,
      maxOutputTokens: prompt.max_output_tokens,
    });

    const column = mode === "long" ? "recommendation_long_text" : "recommendation_short_text";
    const { data, error } = await db
      .from("user_daily_forecasts")
      .update({ [column]: result.text.trim() })
      .eq("id", forecast.id)
      .select("*")
      .single();
    if (error) throw error;

    return json({ text: result.text.trim(), modelUsed: result.modelUsed, forecast: data });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/recommendation-text",
      stage: endpointStage,
    });
    return errorResponse(error);
  }
}
