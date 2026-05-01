import type { SupabaseClient } from "@supabase/supabase-js";
import { signOf } from "../../../modules/astro-core/core/math";
import type { NatalProfile } from "../../../modules/astro-core";
import type { DailyForecast } from "../../../modules/daily-engine";

type NatalChartRow = {
  id: string;
  user_id: string;
  version: number;
  is_active: boolean;
  precision_mode: NatalProfile["precisionMode"];
  is_day_chart: boolean;
  ascendant_longitude: number | null;
  house_system: NatalProfile["houseSystem"];
  planets: NatalProfile["planets"];
  ephemeris_lib_version: string | null;
  computed_at: string;
  created_at: string;
};

export function natalProfileFromRow(row: NatalChartRow): NatalProfile {
  const house1Cusp =
    row.precision_mode === "precise" && row.ascendant_longitude != null
      ? Math.floor(row.ascendant_longitude / 30) * 30
      : null;
  return {
    precisionMode: row.precision_mode,
    isDayChart: row.is_day_chart,
    ascendant:
      row.ascendant_longitude == null
        ? undefined
        : {
            longitude: row.ascendant_longitude,
            sign: signOf(row.ascendant_longitude),
          },
    houseSystem: row.house_system,
    houseCusps: house1Cusp == null ? undefined : Array.from({ length: 12 }, (_, i) => (house1Cusp + i * 30) % 360),
    planets: row.planets,
    computedAt: row.computed_at,
    ephemerisLibVersion: row.ephemeris_lib_version ?? "unknown",
  };
}

export async function nextVersionFor(db: SupabaseClient, table: string, userId: string): Promise<number> {
  const { data, error } = await db
    .from(table)
    .select("version")
    .eq("user_id", userId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return ((data as { version?: number } | null)?.version ?? 0) + 1;
}

export async function loadActiveNatalProfile(db: SupabaseClient, userId: string): Promise<{
  row: NatalChartRow;
  profile: NatalProfile;
}> {
  const { data, error } = await db
    .from("user_natal_charts")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Response(JSON.stringify({ error: "Natal profile not found" }), { status: 404 });

  const row = data as NatalChartRow;
  return { row, profile: natalProfileFromRow(row) };
}

export function dailyForecastToInsert(userId: string, userTimezone: string, forecast: DailyForecast): Record<string, unknown> {
  return {
    user_id: userId,
    forecast_date: forecast.date,
    user_timezone: userTimezone,
    importance: forecast.importance,
    activation: forecast.activation,
    ranked_planets: forecast.rankedPlanets,
    planet_of_the_day: forecast.planetOfTheDay,
    is_alternative_choice: forecast.isAlternativeChoice,
    alternative_reason_text: forecast.alternativeReasonText ?? null,
    today_planet_state: forecast.todayPlanetState,
    windows_of_opportunity: forecast.windowsOfOpportunity,
    transit_chart: forecast.transitChart,
    computed_at: forecast.computedAt,
    cache_valid_until: forecast.cacheValidUntil,
  };
}
