import type { Planet } from "../../../modules/daily-engine";
import type { DailyForecast } from "../../../modules/daily-engine";
import type { MorningRecommendationPayload } from "./morningRecommendation";

export function dailyForecastFromRow(row: Record<string, unknown>): DailyForecast {
  return {
    date: String(row.forecast_date ?? row.date),
    importance: row.importance as DailyForecast["importance"],
    activation: row.activation as DailyForecast["activation"],
    rankedPlanets: row.ranked_planets as Planet[],
    planetOfTheDay: row.planet_of_the_day as Planet,
    isAlternativeChoice: Boolean(row.is_alternative_choice),
    alternativeReasonText:
      typeof row.alternative_reason_text === "string" ? row.alternative_reason_text : undefined,
    todayPlanetState: row.today_planet_state as DailyForecast["todayPlanetState"],
    windowsOfOpportunity: row.windows_of_opportunity as DailyForecast["windowsOfOpportunity"],
    transitChart: row.transit_chart as DailyForecast["transitChart"],
    computedAt: String(row.computed_at),
    cacheValidUntil: String(row.cache_valid_until),
  };
}

/** Client-facing camelCase payload for `forecastPayload` (Home LLM layer). */
export function buildClientForecastPayload(
  row: Record<string, unknown>,
  morning: MorningRecommendationPayload | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    date: row.forecast_date,
    forecast_date: row.forecast_date,
    importance: row.importance,
    activation: row.activation,
    rankedPlanets: row.ranked_planets,
    ranked_planets: row.ranked_planets,
    planetOfTheDay: row.planet_of_the_day,
    planet_of_the_day: row.planet_of_the_day,
    isAlternativeChoice: row.is_alternative_choice,
    is_alternative_choice: row.is_alternative_choice,
    alternativeReasonText: row.alternative_reason_text,
    alternative_reason_text: row.alternative_reason_text,
    todayPlanetState: row.today_planet_state,
    today_planet_state: row.today_planet_state,
    windowsOfOpportunity: row.windows_of_opportunity,
    windows_of_opportunity: row.windows_of_opportunity,
    transitChart: row.transit_chart,
    transit_chart: row.transit_chart,
    computedAt: row.computed_at,
    computed_at: row.computed_at,
    cacheValidUntil: row.cache_valid_until,
    cache_valid_until: row.cache_valid_until,
    contentPhase: morning ? "secondary_ready" : "base_ready",
  };

  if (!morning) return base;

  return {
    ...base,
    slogan: morning.slogan,
    recommendationShortText: morning.short_text,
    recommendationLongText: morning.long_explanation,
    mathLevel: morning.math_level,
    math_level: morning.math_level,
    contentPhase: "secondary_ready",
  };
}
