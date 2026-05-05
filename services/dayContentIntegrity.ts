import type { DailyForecast } from "@/modules/daily-engine";
import type { AccessMode } from "@/services/globalContentClient";

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMathLevel(value: DailyForecast["mathLevel"] | undefined): boolean {
  return hasText(value?.markdown);
}

export function isBaseForecastValid(forecast: DailyForecast | null | undefined): forecast is DailyForecast {
  if (!forecast) return false;
  return (
    hasText(forecast.date) &&
    hasText(forecast.computedAt) &&
    hasText(forecast.cacheValidUntil) &&
    Boolean(forecast.planetOfTheDay) &&
    Boolean(forecast.todayPlanetState) &&
    Boolean(forecast.windowsOfOpportunity) &&
    Boolean(forecast.transitChart)
  );
}

export function isDayContentComplete(
  forecast: DailyForecast | null | undefined,
  accessMode: AccessMode,
): forecast is DailyForecast {
  if (!isBaseForecastValid(forecast)) return false;
  if (!hasText(forecast.slogan)) return false;
  if (!hasText(forecast.recommendationShortText)) return false;
  if (!hasText(forecast.recommendationLongText)) return false;
  if (accessMode !== "free" && !hasMathLevel(forecast.mathLevel)) return false;
  return true;
}
