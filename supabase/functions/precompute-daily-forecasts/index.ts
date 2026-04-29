// @ts-nocheck
import { DateTime } from "https://esm.sh/luxon@3.7.2";
import { assertCronSecret, createServiceClient, daysAgo, isOptions, json } from "../_shared/supabase.ts";
import { computeDailyForecast, dailyForecastToInsert } from "../_shared/dailyForecast.ts";

const BATCH_SIZE = 100;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function hasRecentActivity(db: any, userId: string): Promise<boolean> {
  const cutoff = daysAgo(14);
  const checks = await Promise.all([
    db.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("started_at", cutoff),
    db.from("practice_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("started_at", cutoff),
    db.from("user_event_log").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("occurred_at", cutoff),
  ]);

  for (const result of checks) {
    if (result.error) throw result.error;
    if ((result.count ?? 0) > 0) return true;
  }
  return false;
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
  return data ?? null;
}

async function hasFreshCache(db: any, userId: string, forecastDate: string): Promise<boolean> {
  const { data, error } = await db
    .from("user_daily_forecasts")
    .select("id")
    .eq("user_id", userId)
    .eq("forecast_date", forecastDate)
    .gt("cache_valid_until", new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function processUser(db: any, chart: any, force: boolean) {
  const user = chart.users;
  if (!user?.id || typeof user.tz !== "string" || typeof user.lat !== "number" || typeof user.lon !== "number") {
    return { status: "skipped", reason: "missing_location" };
  }

  const localNow = DateTime.now().setZone(user.tz);
  if (!localNow.isValid) return { status: "skipped", reason: "invalid_timezone" };
  if (!force && localNow.hour !== 0) return { status: "skipped", reason: "outside_local_midnight" };
  if (!force && !(await hasRecentActivity(db, user.id))) return { status: "skipped", reason: "inactive" };

  const forecastDate = localNow.toISODate();
  if (!forecastDate) return { status: "skipped", reason: "invalid_date" };
  if (!force && (await hasFreshCache(db, user.id, forecastDate))) return { status: "skipped", reason: "cache_hit" };

  const [recentPlanetsOfDay, calibration] = await Promise.all([
    loadRecentPlanets(db, user.id),
    loadActiveCalibration(db, user.id),
  ]);

  const forecast = computeDailyForecast({
    natalProfile: natalProfileFromRow(chart),
    calibration,
    forecastDate,
    userLocation: { lat: user.lat, lng: user.lon, timezone: user.tz },
    recentPlanetsOfDay,
  });

  const { error } = await db
    .from("user_daily_forecasts")
    .upsert(dailyForecastToInsert(user.id, user.tz, forecast), { onConflict: "user_id,forecast_date" });
  if (error) throw error;

  return { status: "computed", forecastDate, planetOfTheDay: forecast.planetOfTheDay };
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const targetUserId = url.searchParams.get("userId");
    if (targetUserId && !isUuid(targetUserId)) return json({ error: "Invalid userId" }, { status: 400 });

    const db = createServiceClient();
    let query = db
      .from("user_natal_charts")
      .select("*, users!inner(id,tz,lat,lon,onboarded_at)")
      .eq("is_active", true)
      .not("users.lat", "is", null)
      .not("users.lon", "is", null)
      .not("users.tz", "is", null)
      .order("computed_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (targetUserId) query = query.eq("user_id", targetUserId);
    const { data: charts, error } = await query;
    if (error) throw error;

    const results = [];
    for (const chart of charts ?? []) {
      try {
        results.push({ userId: chart.user_id, ...(await processUser(db, chart, force)) });
      } catch (error) {
        console.error("[precompute-daily-forecasts] user failed", chart.user_id, error);
        results.push({ userId: chart.user_id, status: "error", error: error instanceof Error ? error.message : String(error) });
      }
    }

    return json({
      ok: true,
      processed: results.length,
      computedCount: results.filter((item) => item.status === "computed").length,
      results,
    });
  } catch (error) {
    console.error("[precompute-daily-forecasts]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
