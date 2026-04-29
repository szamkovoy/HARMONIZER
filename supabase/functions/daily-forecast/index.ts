// @ts-nocheck
/**
 * POST: дневной прогноз M2 (кэш в user_daily_forecasts или пересчёт).
 * Повторяет контракт `_legacy_web/app/api/astro/daily-forecast/route.ts`.
 */
import { DateTime } from "https://esm.sh/luxon@3.7.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.1";
import { computeDailyForecast, dailyForecastToInsert } from "../_shared/dailyForecast.ts";
import { corsHeaders, createServiceClient, isOptions, json } from "../_shared/supabase.ts";

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [error.message, error.error, error.details, error.hint, error.code]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      return "Unknown daily-forecast error";
    }
  }
  return "Unknown daily-forecast error";
}

function todayLocalDate(timezone: string, at: Date = new Date()): string {
  const tz = timezone?.trim() || "UTC";
  return DateTime.fromJSDate(at, { zone: "utc" }).setZone(tz).toFormat("yyyy-MM-dd");
}

function natalProfileFromRow(row: any) {
  return {
    precisionMode: row.precision_mode,
    isDayChart: row.is_day_chart,
    ascendant:
      row.ascendant_longitude == null
        ? undefined
        : {
            longitude: row.ascendant_longitude,
            sign: Math.floor(row.ascendant_longitude / 30),
          },
    houseSystem: row.house_system,
    planets: row.planets,
    computedAt: row.computed_at,
    ephemerisLibVersion: row.ephemeris_lib_version ?? "unknown",
  };
}

async function requireUserId(req: Request): Promise<string> {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    throw json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    throw json({ error: "Unauthorized" }, { status: 401 });
  }
  return data.user.id;
}

async function loadRecentPlanets(db: any, userId: string): Promise<string[]> {
  const { data, error } = await db.from("user_settings").select("preferences").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const recent = data?.preferences?.recentPlanetsOfDay;
  return Array.isArray(recent) ? recent.slice(0, 2) : [];
}

async function loadActiveCalibration(db: any, userId: string) {
  const { data, error } = await db
    .from("user_calibrations")
    .select("s_calibrated,h_calibrated")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    s_calibrated: data.s_calibrated,
    h_calibrated: data.h_calibrated,
  };
}

async function loadActiveNatalProfile(db: any, userId: string) {
  const { data, error } = await db
    .from("user_natal_charts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw json({ error: "Natal profile not found" }, { status: 404 });
  }
  return { profile: natalProfileFromRow(data) };
}

async function cachedForecast(db: any, userId: string, forecastDate: string): Promise<unknown | null> {
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

Deno.serve(async (req) => {
  if (isOptions(req)) {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as {
      forecastDate?: string;
      userLocation?: { lat: number; lng: number; timezone: string };
      recentPlanetsOfDay?: string[];
      forceRefresh?: boolean;
    };

    if (!body.userLocation) {
      return json({ error: "userLocation is required" }, { status: 400 });
    }

    const db = createServiceClient();
    const forecastDate = body.forecastDate ?? todayLocalDate(body.userLocation.timezone);

    if (!body.forceRefresh) {
      const cached = await cachedForecast(db, userId, forecastDate);
      if (cached) return json({ source: "cache", forecast: cached });
    }

    const [{ profile: natalProfile }, calibration, recentPlanetsOfDay] = await Promise.all([
      loadActiveNatalProfile(db, userId),
      loadActiveCalibration(db, userId),
      body.recentPlanetsOfDay ? Promise.resolve(body.recentPlanetsOfDay.slice(0, 2)) : loadRecentPlanets(db, userId),
    ]);

    const forecast = computeDailyForecast({
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

    return json({ source: "computed", forecast: data, forecastPayload: forecast });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = errorMessage(error);
    console.error("[daily-forecast]", message, error);
    return json({ error: message }, { status: 500 });
  }
});
