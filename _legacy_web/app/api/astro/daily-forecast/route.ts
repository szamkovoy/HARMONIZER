import {
  computeDailyForecastWithAstronomia,
  type CalibrationLike,
  type DailyEngineInput,
  type DailyForecast,
  type Planet,
} from "../../../../modules/daily-engine";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { dailyForecastToInsert, loadActiveNatalProfile } from "../../_utils/astro-db";
import { todayLocalDate } from "../../calibration/extract/forecast-cache-date";
import { ensureMorningRecommendation } from "../../_utils/morningRecommendation";

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

async function persistRecommendation(
  db: ReturnType<typeof createServiceSupabase>,
  forecastId: string | null,
  payload: { shortText: string; longText: string },
) {
  if (!forecastId) return;
  const { error } = await db
    .from("user_daily_forecasts")
    .update({
      recommendation_short_text: payload.shortText,
      recommendation_long_text: payload.longText,
    })
    .eq("id", forecastId);
  if (error) throw error;
}

function mergeRecommendation(params: {
  forecast: Record<string, unknown>;
  recommendation: Awaited<ReturnType<typeof ensureMorningRecommendation>>;
}) {
  return {
    ...params.forecast,
    recommendationShortText: params.recommendation.short_text,
    recommendationLongText: params.recommendation.long_explanation,
    recommendation_short_text: params.recommendation.short_text,
    recommendation_long_text: params.recommendation.long_explanation,
    slogan: params.recommendation.slogan,
    mathLevel: params.recommendation.math_level,
    math_level: params.recommendation.math_level,
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
        const [{ profile: natalProfile }, calibration] = await Promise.all([
          loadActiveNatalProfile(db, userId),
          loadActiveCalibration(db, userId),
        ]);
        const recommendation = await ensureMorningRecommendation({
          db,
          userId,
          forecast: cached as DailyForecast,
          natalProfile,
          calibration,
          forceRefresh: false,
        });
        const forecastRow = {
          ...(cached as Record<string, unknown>),
          recommendation_short_text: recommendation.short_text,
          recommendation_long_text: recommendation.long_explanation,
        };
        await persistRecommendation(db, (cached as { id?: string } | null)?.id ?? null, {
          shortText: recommendation.short_text,
          longText: recommendation.long_explanation,
        });
        return json({
          source: "cache",
          forecast: forecastRow,
          forecastPayload: mergeRecommendation({
            forecast: forecastRow,
            recommendation,
          }),
          modelUsed: recommendation.modelUsed,
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

    const { data, error } = await db
      .from("user_daily_forecasts")
      .upsert(dailyForecastToInsert(userId, body.userLocation.timezone, forecast), {
        onConflict: "user_id,forecast_date",
      })
      .select("*")
      .single();
    if (error) throw error;
    const recommendation = await ensureMorningRecommendation({
      db,
      userId,
      forecast,
      natalProfile,
      calibration,
      forceRefresh: body.forceRefresh,
    });
    await persistRecommendation(db, (data as { id?: string } | null)?.id ?? null, {
      shortText: recommendation.short_text,
      longText: recommendation.long_explanation,
    });
    const forecastRow = {
      ...(data as Record<string, unknown>),
      recommendation_short_text: recommendation.short_text,
      recommendation_long_text: recommendation.long_explanation,
    };

    return json({
      source: "computed",
      forecast: forecastRow,
      forecastPayload: mergeRecommendation({
        forecast: forecast as unknown as Record<string, unknown>,
        recommendation,
      }),
      modelUsed: recommendation.modelUsed,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
