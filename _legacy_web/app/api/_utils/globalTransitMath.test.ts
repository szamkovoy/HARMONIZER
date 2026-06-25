import { describe, expect, it } from "vitest";

import { buildGlobalMathLevel, computeGlobalDailyForecast, GLOBAL_MATH_SCHEMA_VERSION } from "./globalTransitMath";

describe("globalTransitMath", () => {
  it("builds a rich transit-only math payload for free forecasts", () => {
    const forecast = computeGlobalDailyForecast("2026-06-25");
    const mathLevel = buildGlobalMathLevel(forecast, "ru");

    expect(forecast.planet_scores).toHaveLength(7);
    expect(mathLevel.structured).toMatchObject({
      schema_version: GLOBAL_MATH_SCHEMA_VERSION,
      chart_mode: "transit_only",
      primary_planet: forecast.primary_planet,
      primary_chakra_number: forecast.primary_chakra_number,
      primary_tone: forecast.primary_tone,
    });
    expect(Array.isArray(mathLevel.structured?.planet_scores)).toBe(true);
    expect(Array.isArray(mathLevel.structured?.main_aspects)).toBe(true);
    expect(mathLevel.markdown).toContain("Почему выбрана именно эта тема дня");
    expect(mathLevel.markdown).toContain("Полный рейтинг планет");
    expect(mathLevel.markdown).toContain("Вес каждого аспекта");
  });
});
