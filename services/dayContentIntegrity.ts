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

/**
 * Минимум, достаточный чтобы ОТРИСОВАТЬ free-экран: структурный прогноз + слоган +
 * короткий текст + math_level (все детерминированные, кроме текстов). Развёрнутый
 * `long_explanation` НЕ обязателен: если LLM недоступна и сервер отдал заглушку без
 * §-структуры (её локализатор обнуляет), карточка покажет детерминированный detail
 * fallback вместо жёсткой ошибки «Не удалось загрузить прогноз».
 */
export function isFreeDayContentRenderable(
  forecast: DailyForecast | null | undefined,
): forecast is DailyForecast {
  if (!isBaseForecastValid(forecast)) return false;
  if (!hasText(forecast.slogan)) return false;
  if (!hasText(forecast.recommendationShortText)) return false;
  if (!hasMathLevel(forecast.mathLevel)) return false;
  return true;
}

export function isDayContentReadyForHome(
  forecast: DailyForecast | null | undefined,
  accessMode: AccessMode,
): forecast is DailyForecast {
  if (!isBaseForecastValid(forecast)) return false;
  if (accessMode === "free") return isFreeDayContentRenderable(forecast);
  return true;
}

/**
 * Кэшировать (persist) можно только ПОЛНОЦЕННЫЙ контент. Для free это значит
 * complete (включая `long_explanation`), чтобы детерминированная заглушка (LLM
 * недоступна) НЕ оседала в кэше на весь день, а самозалечивалась при следующем
 * fetch, когда сервер догенерирует настоящий текст. Для paid достаточно базового
 * прогноза — вторичные тексты догружаются отдельным слоем.
 */
export function isDayContentCacheable(
  forecast: DailyForecast | null | undefined,
  accessMode: AccessMode,
): forecast is DailyForecast {
  if (!isBaseForecastValid(forecast)) return false;
  if (accessMode === "free") return isDayContentComplete(forecast, accessMode);
  return true;
}

export function isDayContentComplete(
  forecast: DailyForecast | null | undefined,
  accessMode: AccessMode,
): forecast is DailyForecast {
  if (!isBaseForecastValid(forecast)) return false;
  if (!hasText(forecast.slogan)) return false;
  if (!hasText(forecast.recommendationShortText)) return false;
  if (!hasText(forecast.recommendationLongText)) return false;
  if (!hasMathLevel(forecast.mathLevel)) return false;
  return true;
}
