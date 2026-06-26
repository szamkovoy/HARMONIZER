import {
  computeDailyForecastWithAstronomia,
  type CalibrationLike,
  type DailyEngineInput,
  type DailyForecast,
  type Planet,
} from "../../../../modules/daily-engine";
import { asContentLocale } from "../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { dailyForecastToInsert, loadActiveNatalProfile } from "../../_utils/astro-db";
import { buildClientForecastPayload, dailyForecastFromRow } from "../../_utils/dailyForecastPayload";
import {
  ensureMorningRecommendation,
  loadCachedMorningRecommendation,
  type MorningRecommendationPayload,
} from "../../_utils/morningRecommendation";
import { todayLocalDate } from "../../calibration/extract/forecast-cache-date";

// Запись в user_daily_forecasts только через service_role (RLS: владелец — SELECT).
export const runtime = "nodejs";

type Body = {
  forecastDate?: string;
  userLocation?: DailyEngineInput["userLocation"];
  recentPlanetsOfDay?: Planet[];
  forceRefresh?: boolean;
  responseLocale?: string;
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
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("forecast_date", forecastDate)
    .gt("cache_valid_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

async function resolveMorningPayload(params: {
  db: ReturnType<typeof createServiceSupabase>;
  userId: string;
  forecast: DailyForecast;
  natalProfile: Awaited<ReturnType<typeof loadActiveNatalProfile>>["profile"];
  calibration: CalibrationLike | null;
  forceRefresh: boolean;
  requestedLocale?: string | null;
}): Promise<MorningRecommendationPayload | null> {
  if (params.forceRefresh) {
    return ensureMorningRecommendation({
      db: params.db,
      userId: params.userId,
      forecast: params.forecast,
      natalProfile: params.natalProfile,
      calibration: params.calibration,
      forceRefresh: true,
      responseLocale: asContentLocale(params.requestedLocale) ?? undefined,
    });
  }
  return loadCachedMorningRecommendation({
    db: params.db,
    userId: params.userId,
    requestedLocale: params.requestedLocale,
  });
}

async function respondWithForecast(params: {
  db: ReturnType<typeof createServiceSupabase>;
  userId: string;
  source: "cache" | "computed";
  row: Record<string, unknown>;
  forecast: DailyForecast;
  natalProfile: Awaited<ReturnType<typeof loadActiveNatalProfile>>["profile"];
  calibration: CalibrationLike | null;
  forceRefresh: boolean;
  requestedLocale?: string | null;
}) {
  const morning = await resolveMorningPayload({
    db: params.db,
    userId: params.userId,
    forecast: params.forecast,
    natalProfile: params.natalProfile,
    calibration: params.calibration,
    forceRefresh: params.forceRefresh,
    requestedLocale: params.requestedLocale,
  });

  return json({
    source: params.source,
    forecast: params.row,
    forecastPayload: buildClientForecastPayload(params.row, morning),
    modelUsed: morning?.modelUsed ?? null,
  });
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
    const forceRefresh = body.forceRefresh === true;

    const [{ profile: natalProfile }, calibration] = await Promise.all([
      loadActiveNatalProfile(db, userId),
      loadActiveCalibration(db, userId),
    ]);

    if (!forceRefresh) {
      const cached = await cachedForecast(db, userId, forecastDate);
      if (cached) {
        return respondWithForecast({
          db,
          userId,
          source: "cache",
          row: cached,
          forecast: dailyForecastFromRow(cached),
          natalProfile,
          calibration,
          forceRefresh: false,
          requestedLocale: body.responseLocale,
        });
      }
    }

    const recentPlanetsOfDay = body.recentPlanetsOfDay
      ? body.recentPlanetsOfDay.slice(0, 2)
      : await loadRecentPlanets(db, userId);

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
    if (
      existing?.is_corrected_via_dialog === true
      || (typeof existing?.recommendation_short_text === "string" && existing.recommendation_short_text.trim())
    ) {
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

    return respondWithForecast({
      db,
      userId,
      source: "computed",
      row: data as Record<string, unknown>,
      forecast,
      natalProfile,
      calibration,
      forceRefresh,
      requestedLocale: body.responseLocale,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
