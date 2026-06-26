import { describe, expect, it } from "vitest";

import { buildClientForecastPayload } from "./dailyForecastPayload";

describe("buildClientForecastPayload", () => {
  it("attaches morning recommendation fields for Home without planning short text", () => {
    const row = {
      forecast_date: "2026-06-27",
      importance: { Venus: 0.8 },
      activation: { Venus: 0.5 },
      ranked_planets: ["Venus", "Moon", "Sun"],
      planet_of_the_day: "Venus",
      is_alternative_choice: false,
      today_planet_state: { todayTone: "harmonic", naturalHarmoniousness: 0.2 },
      windows_of_opportunity: {},
      transit_chart: { planets: {} },
      computed_at: "2026-06-27T00:00:00.000Z",
      cache_valid_until: "2026-06-28T00:00:00.000Z",
      recommendation_short_text: "Planning-only focus text",
    };

    const payload = buildClientForecastPayload(row, {
      slogan: "Слоган дня",
      short_text: "Заметь: день не про расслабление.",
      long_explanation: "§1. ...",
      math_level: { markdown: "## math", structured: { natal_strengths: [], main_aspects: [], importance_breakdown: [] } },
      modelUsed: "gemini-test",
    });

    expect(payload.recommendationShortText).toBe("Заметь: день не про расслабление.");
    expect(payload.recommendation_short_text).toBeUndefined();
    expect(payload.slogan).toBe("Слоган дня");
    expect(payload.contentPhase).toBe("secondary_ready");
  });

  it("returns base_ready payload when morning cache is missing", () => {
    const row = {
      forecast_date: "2026-06-27",
      importance: {},
      activation: {},
      ranked_planets: ["Sun"],
      planet_of_the_day: "Sun",
      is_alternative_choice: false,
      today_planet_state: { todayTone: "neutral", naturalHarmoniousness: 0 },
      windows_of_opportunity: {},
      transit_chart: { planets: {} },
      computed_at: "2026-06-27T00:00:00.000Z",
      cache_valid_until: "2026-06-28T00:00:00.000Z",
    };

    const payload = buildClientForecastPayload(row, null);
    expect(payload.contentPhase).toBe("base_ready");
    expect(payload.recommendationShortText).toBeUndefined();
  });
});
