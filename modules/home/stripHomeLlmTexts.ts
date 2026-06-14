import type { DailyForecast } from "@/modules/daily-engine";

/** Home LLM copy (slogan, recommendations, math) is locale-specific — drop before reload. */
export function stripHomeLlmTexts(forecast: DailyForecast): DailyForecast {
  return {
    ...forecast,
    slogan: undefined,
    recommendationShortText: undefined,
    recommendationLongText: undefined,
    mathLevel: undefined,
  };
}
