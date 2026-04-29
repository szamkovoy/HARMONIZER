import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  forecastDate?: string;
  shortText?: string;
  short_text?: string;
  windowsCorrection?: string;
  windows_correction?: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const shortText = body.shortText ?? body.short_text;
    if (!shortText?.trim() && !body.windowsCorrection && !body.windows_correction) {
      return json({ error: "shortText or windowsCorrection is required" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: current, error: readError } = await db
      .from("user_daily_forecasts")
      .select("id,recommendation_short_text,windows_of_opportunity")
      .eq("user_id", userId)
      .eq("forecast_date", body.forecastDate ?? todayIsoDate())
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return json({ error: "Forecast not found" }, { status: 404 });

    const { data, error } = await db
      .from("user_daily_forecasts")
      .update({
        recommendation_short_text: shortText ?? current.recommendation_short_text,
        is_corrected_via_dialog: true,
        corrected_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .select("*")
      .single();
    if (error) throw error;

    return json({
      recommendationCorrected: {
        newShortText: data.recommendation_short_text,
        short_text: data.recommendation_short_text,
        windows_correction: body.windowsCorrection ?? body.windows_correction,
      },
      forecast: data,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
