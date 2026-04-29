import { describe, expect, it } from "vitest";
import { computeNatalProfileFromPositions, type ChartPositions, type Planet, type PlanetPosition } from "../astro-core";
import { computeDailyForecastFromTransits } from "./computeDailyForecast";
import type { DailyEngineInput, TransitChart } from "./core/types";

const NATAL_POSITIONS: Record<Planet, PlanetPosition> = {
  Sun: { longitude: 13, speed: 0.98, isRetrograde: false },
  Moon: { longitude: 44, speed: 13.1, isRetrograde: false },
  Mercury: { longitude: 87, speed: 1, isRetrograde: false },
  Venus: { longitude: 132, speed: 1, isRetrograde: false },
  Mars: { longitude: 201, speed: 0.5, isRetrograde: false },
  Jupiter: { longitude: 266, speed: 0.08, isRetrograde: false },
  Saturn: { longitude: 312, speed: 0.03, isRetrograde: false },
};

const QUIET_TRANSITS: Record<Planet, PlanetPosition> = {
  Sun: { longitude: 3, speed: 0.98, isRetrograde: false },
  Moon: { longitude: 3, speed: 13.1, isRetrograde: false },
  Mercury: { longitude: 3, speed: 1, isRetrograde: false },
  Venus: { longitude: 3, speed: 1, isRetrograde: false },
  Mars: { longitude: 3, speed: 0.5, isRetrograde: false },
  Jupiter: { longitude: 3, speed: 0.08, isRetrograde: false },
  Saturn: { longitude: 3, speed: 0.03, isRetrograde: false },
};

function positions(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>>): Record<Planet, PlanetPosition> {
  const result = { ...NATAL_POSITIONS };
  for (const [planet, override] of Object.entries(overrides) as Array<[Planet, Partial<PlanetPosition> & { longitude: number }]>) {
    result[planet] = {
      ...result[planet],
      ...override,
      speed: override.speed ?? result[planet].speed,
      isRetrograde: override.isRetrograde ?? result[planet].isRetrograde,
    };
  }
  return result;
}

function natalProfile(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>> = {}) {
  const chart: ChartPositions = {
    planets: positions(overrides),
    ascendantLongitude: 270,
    isDayChart: true,
    ephemerisLibVersion: "fixture",
    computedAt: "2026-04-29T00:00:00.000Z",
  };
  return computeNatalProfileFromPositions({ precisionMode: "precise", chart });
}

function inputFor(overrides: Partial<DailyEngineInput> = {}): DailyEngineInput {
  return {
    natalProfile: natalProfile(),
    calibration: null,
    forecastDate: "2026-04-29",
    userLocation: { lat: 55.75, lng: 37.61, timezone: "Europe/Moscow" },
    recentPlanetsOfDay: [],
    ...overrides,
  };
}

function transitChart(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>>): TransitChart {
  const planets = { ...QUIET_TRANSITS };
  for (const [planet, override] of Object.entries(overrides) as Array<[Planet, Partial<PlanetPosition> & { longitude: number }]>) {
    planets[planet] = {
      ...planets[planet],
      ...override,
      speed: override.speed ?? planets[planet].speed,
      isRetrograde: override.isRetrograde ?? planets[planet].isRetrograde,
    };
  }

  return {
    referenceTime: "2026-04-29T14:00:00+03:00",
    planets,
  };
}

describe("M2 Daily-Engine", () => {
  it("case 1: Saturn return dominates with same-body conjunction bonus", () => {
    const input = inputFor({ natalProfile: natalProfile({ Saturn: { longitude: 100 } }) });
    const forecast = computeDailyForecastFromTransits({
      input,
      transitChart: transitChart({
        Saturn: { longitude: 101, speed: 0.03 },
        Sun: { longitude: 20 },
        Moon: { longitude: 50 },
        Mercury: { longitude: 170 },
        Venus: { longitude: 230 },
        Mars: { longitude: 300 },
        Jupiter: { longitude: 10 },
      }),
    });

    expect(forecast.planetOfTheDay).toBe("Saturn");
    expect(forecast.activation.Saturn).toBeGreaterThan(forecast.activation.Jupiter);
  });

  it("case 2: Moon trine can select natal Venus when it is the only signal", () => {
    const input = inputFor({ natalProfile: natalProfile({ Venus: { longitude: 120 } }) });
    const forecast = computeDailyForecastFromTransits({
      input,
      transitChart: transitChart({
        Moon: { longitude: 240, speed: 13.1 },
      }),
    });

    expect(forecast.planetOfTheDay).toBe("Venus");
    expect(forecast.activation.Venus).toBeGreaterThan(0);
  });

  it("case 3: picks the second ranked planet after two repeated days", () => {
    const input = inputFor({
      natalProfile: natalProfile({ Mars: { longitude: 80 }, Venus: { longitude: 140 } }),
      recentPlanetsOfDay: ["Mars", "Mars"],
    });
    const forecast = computeDailyForecastFromTransits({
      input,
      transitChart: transitChart({
        Mars: { longitude: 80, speed: 0.5 },
        Venus: { longitude: 140, speed: 1 },
      }),
    });

    expect(forecast.rankedPlanets[0]).toBe("Mars");
    expect(forecast.planetOfTheDay).not.toBe("Mars");
    expect(forecast.isAlternativeChoice).toBe(true);
  });

  it("case 5: derives harmonic and dissonant tone from effective H", () => {
    const input = inputFor({
      calibration: {
        H_calibrated: {
          Jupiter: 0.7,
          Saturn: -0.6,
        },
      },
    });
    const harmonic = computeDailyForecastFromTransits({
      input: { ...input, recentPlanetsOfDay: [] },
      transitChart: transitChart({ Jupiter: { longitude: input.natalProfile.planets.Jupiter.longitude } }),
    });
    const dissonant = computeDailyForecastFromTransits({
      input: { ...input, recentPlanetsOfDay: ["Jupiter", "Jupiter"] },
      transitChart: transitChart({
        Jupiter: { longitude: input.natalProfile.planets.Jupiter.longitude },
        Saturn: { longitude: input.natalProfile.planets.Saturn.longitude },
      }),
    });

    expect(harmonic.planetOfTheDay).toBe("Jupiter");
    expect(harmonic.todayPlanetState.todayTone).toBe("harmonic");
    expect(dissonant.planetOfTheDay).toBe("Saturn");
    expect(dissonant.todayPlanetState.todayTone).toBe("dissonant");
  });
});
