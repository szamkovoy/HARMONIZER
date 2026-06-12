import {
  computeDailyForecastWithAstronomia,
  type CalibrationLike,
  type DailyEngineInput,
  type Planet,
} from "../../../../modules/daily-engine";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { dailyForecastToInsert, loadActiveNatalProfile } from "../../_utils/astro-db";
import { todayLocalDate } from "../../calibration/extract/forecast-cache-date";

// Запись в user_daily_forecasts только через service_role (RLS: владелец — SELECT).
export const runtime = "nodejs";

type Body = {
  forecastDate?: string;
  userLocation?: DailyEngineInput["userLocation"];
  recentPlanetsOfDay?: Planet[];
  forceRefresh?: boolean;
};

async function loadRecentPlanets(db: ReturnType<typeof createServiceSupabase>, userId: string): Promise<Planet[]> {
  const { data, error } = await db
    .from("user_settings")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const preferences = (data as { preferences?: { recentPlanetsOfDay?: Planet[] } } | null)?.preferences;
  return Array.isArray(preferences?.recentPlanetsOfDay) ? preferences.recentPlanetsOfDay.slice(0, 2) : [];
}

async function loadActiveCalibration(db: ReturnType<typeof createServiceSupabase>, userId: string): Promise<CalibrationLike | null> {
  const { data, error } = await db
    .from("user_calibrations")
    .select("s_calibrated,h_calibrated")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as { s_calibrated?: CalibrationLike["s_calibrated"]; h_calibrated?: CalibrationLike["h_calibrated"] };
  return {
    s_calibrated: row.s_calibrated,
    h_calibrated: row.h_calibrated,
  };
}

async function cachedForecast(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  forecastDate: string,
): Promise<unknown | null> {
  const { data, error } = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("forecast_date", forecastDate)
    .gt("cache_valid_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function mergeStoredContent(forecast: Record<string, unknown>) {
  return {
    ...forecast,
    recommendationShortText:
      typeof forecast.recommendation_short_text === "string" ? forecast.recommendation_short_text : undefined,
    recommendationLongText:
      typeof forecast.recommendation_long_text === "string" ? forecast.recommendation_long_text : undefined,
    contentPhase:
      typeof forecast.recommendation_short_text === "string" && forecast.recommendation_short_text.trim()
        ? "secondary_ready"
        : "base_ready",
  };
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    if (!body.userLocation) {
      return json({ error: "userLocation is required" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const forecastDate = body.forecastDate ?? todayLocalDate(body.userLocation.timezone);

    if (!body.forceRefresh) {
      const cached = await cachedForecast(db, userId, forecastDate);
      if (cached) {
        return json({
          source: "cache",
          forecast: cached,
          forecastPayload: mergeStoredContent(cached as Record<string, unknown>),
          modelUsed: null,
        });
      }
    }

    const [{ profile: natalProfile }, calibration, recentPlanetsOfDay] = await Promise.all([
      loadActiveNatalProfile(db, userId),
      loadActiveCalibration(db, userId),
      body.recentPlanetsOfDay ? Promise.resolve(body.recentPlanetsOfDay.slice(0, 2)) : loadRecentPlanets(db, userId),
    ]);

    const forecast = await computeDailyForecastWithAstronomia({
      natalProfile,
      calibration,
      forecastDate,
      userLocation: body.userLocation,
      recentPlanetsOfDay,
    });

    // Recomputing the forecast (e.g. after the user edits their birth date) must
    // NOT wipe a day recommendation already written by the planning dialog —
    // otherwise the Day tab shows the actions but loses the day-level focus.
    const { data: existing, error: existingError } = await db
      .from("user_daily_forecasts")
      .select("recommendation_short_text,recommendation_long_text,is_corrected_via_dialog,corrected_at")
      .eq("user_id", userId)
      .eq("forecast_date", forecastDate)
      .maybeSingle();
    if (existingError) throw existingError;

    const insertPayload = dailyForecastToInsert(userId, body.userLocation.timezone, forecast);
    if (existing?.is_corrected_via_dialog === true || (typeof existing?.recommendation_short_text === "string" && existing.recommendation_short_text.trim())) {
      insertPayload.recommendation_short_text = existing.recommendation_short_text ?? null;
      insertPayload.recommendation_long_text = existing.recommendation_long_text ?? null;
      insertPayload.is_corrected_via_dialog = existing.is_corrected_via_dialog ?? false;
      insertPayload.corrected_at = existing.corrected_at ?? null;
    }

    const { data, error } = await db
      .from("user_daily_forecasts")
      .upsert(insertPayload, {
        onConflict: "user_id,forecast_date",
      })
      .select("*")
      .single();
    if (error) throw error;
    return json({
      source: "computed",
      forecast: data,
      forecastPayload: mergeStoredContent(forecast as unknown as Record<string, unknown>),
      modelUsed: null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
