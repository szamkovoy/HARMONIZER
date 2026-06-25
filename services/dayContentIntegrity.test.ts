import { describe, expect, it } from "vitest";

import { isDayContentComplete } from "./dayContentIntegrity";

const baseForecast = {
  date: "2026-06-25",
  importance: {
    Sun: 0,
    Moon: 0,
    Mercury: 0,
    Venus: 0,
    Mars: 1,
    Jupiter: 0,
    Saturn: 0,
  },
  activation: {
    Sun: 0,
    Moon: 0,
    Mercury: 0,
    Venus: 0,
    Mars: 1,
    Jupiter: 0,
    Saturn: 0,
  },
  rankedPlanets: ["Mars", "Sun", "Moon", "Mercury", "Venus", "Jupiter", "Saturn"],
  planetOfTheDay: "Mars",
  isAlternativeChoice: false,
  todayPlanetState: {
    naturalHarmoniousness: 0.5,
    todayTone: "harmonic",
  },
  windowsOfOpportunity: {
    sunrise: null,
    culmination: null,
    exactAspect: null,
  },
  transitChart: {
    referenceTime: "2026-06-25T12:00:00Z",
    planets: {} as never,
  },
  computedAt: "2026-06-25T09:00:00.000Z",
  cacheValidUntil: "2026-06-25T23:59:59.999Z",
  slogan: "test slogan",
  recommendationShortText: "short",
  recommendationLongText: "long",
};

describe("isDayContentComplete", () => {
  it("requires mathLevel for free forecasts too", () => {
    expect(isDayContentComplete(baseForecast as never, "free")).toBe(false);
    expect(
      isDayContentComplete(
        {
          ...baseForecast,
          mathLevel: { markdown: "math", structured: {} },
        } as never,
        "free",
      ),
    ).toBe(true);
  });
});
