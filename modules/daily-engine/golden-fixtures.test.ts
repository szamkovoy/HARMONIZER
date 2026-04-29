import { describe, expect, it } from "vitest";
import { computeDailyForecastFromTransits } from "./computeDailyForecast";
import type { Planet } from "../astro-core";
import { inputFor, natalProfile, transitChart } from "./test-fixtures";

type GoldenCase = {
  name: string;
  input: ReturnType<typeof inputFor>;
  chart: ReturnType<typeof transitChart>;
  expected: {
    planetOfTheDay: Planet;
    importanceSamples: Partial<Record<Planet, number>>;
    rankedFirst?: Planet;
    alternative?: boolean;
    todayTone?: "harmonic" | "dissonant" | "neutral";
  };
};

/** Зафиксированные ожидания по `computeDailyForecastFromTransits` — при смене формул обновляйте осознанно. */
const GOLDEN_FIXTURES: GoldenCase[] = [
  {
    name: "Saturn return dominates (same-body conjunction bonus)",
    input: inputFor({ natalProfile: natalProfile({ Saturn: { longitude: 100 } }) }),
    chart: transitChart({
      Saturn: { longitude: 101, speed: 0.03 },
      Sun: { longitude: 20 },
      Moon: { longitude: 50 },
      Mercury: { longitude: 170 },
      Venus: { longitude: 230 },
      Mars: { longitude: 300 },
      Jupiter: { longitude: 10 },
    }),
    expected: {
      planetOfTheDay: "Saturn",
      importanceSamples: { Saturn: 1.2608, Sun: 0.99324, Mars: 0.4977 },
      rankedFirst: "Saturn",
      todayTone: "neutral",
    },
  },
  {
    name: "Moon trine selects natal Venus",
    input: inputFor({ natalProfile: natalProfile({ Venus: { longitude: 120 } }) }),
    chart: transitChart({ Moon: { longitude: 240, speed: 13.1 } }),
    expected: {
      planetOfTheDay: "Venus",
      importanceSamples: { Venus: 0.854784 },
      rankedFirst: "Venus",
      todayTone: "neutral",
    },
  },
  {
    name: "Alternative planet after two Mars days",
    input: inputFor({
      natalProfile: natalProfile({ Mars: { longitude: 80 }, Venus: { longitude: 140 } }),
      recentPlanetsOfDay: ["Mars", "Mars"],
    }),
    chart: transitChart({
      Mars: { longitude: 80, speed: 0.5 },
      Venus: { longitude: 140, speed: 1 },
    }),
    expected: {
      planetOfTheDay: "Venus",
      importanceSamples: { Mars: 0.9164, Venus: 0.6624 },
      rankedFirst: "Mars",
      alternative: true,
      todayTone: "harmonic",
    },
  },
  {
    name: "Calibrated H drives harmonic tone on Jupiter",
    input: inputFor({
      calibration: {
        H_calibrated: {
          Jupiter: 0.7,
          Saturn: -0.6,
        },
      },
    }),
    chart: transitChart({ Jupiter: { longitude: natalProfile().planets.Jupiter.longitude } }),
    expected: {
      planetOfTheDay: "Jupiter",
      importanceSamples: { Jupiter: 0.8748, Mercury: 0.6642 },
      rankedFirst: "Jupiter",
      todayTone: "harmonic",
    },
  },
  {
    name: "Calibrated S scales importance (Saturn)",
    input: inputFor({
      natalProfile: natalProfile({ Saturn: { longitude: 100 } }),
      calibration: { S_calibrated: { Saturn: 0.25 } },
    }),
    chart: transitChart({ Saturn: { longitude: 101, speed: 0.03 } }),
    expected: {
      planetOfTheDay: "Saturn",
      importanceSamples: { Saturn: 0.625, Sun: 0.51264 },
      rankedFirst: "Saturn",
      todayTone: "neutral",
    },
  },
];

describe("Daily-Engine golden fixtures", () => {
  for (const fixture of GOLDEN_FIXTURES) {
    it(`reproduces: ${fixture.name}`, () => {
      const result = computeDailyForecastFromTransits({
        input: fixture.input,
        transitChart: fixture.chart,
      });

      expect(result.planetOfTheDay).toBe(fixture.expected.planetOfTheDay);
      if (fixture.expected.rankedFirst) {
        expect(result.rankedPlanets[0]).toBe(fixture.expected.rankedFirst);
      }
      if (fixture.expected.alternative != null) {
        expect(result.isAlternativeChoice).toBe(fixture.expected.alternative);
      }
      if (fixture.expected.todayTone) {
        expect(result.todayPlanetState.todayTone).toBe(fixture.expected.todayTone);
      }
      for (const [planet, value] of Object.entries(fixture.expected.importanceSamples) as Array<[Planet, number]>) {
        expect(result.importance[planet]).toBeCloseTo(value, 3);
      }
    });
  }
});
