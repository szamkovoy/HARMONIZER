import { computeNatalProfileFromPositions, type ChartPositions, type Planet, type PlanetPosition } from "../astro-core";
import type { DailyEngineInput, TransitChart } from "./core/types";

export const NATAL_POSITIONS: Record<Planet, PlanetPosition> = {
  Sun: { longitude: 13, speed: 0.98, isRetrograde: false },
  Moon: { longitude: 44, speed: 13.1, isRetrograde: false },
  Mercury: { longitude: 87, speed: 1, isRetrograde: false },
  Venus: { longitude: 132, speed: 1, isRetrograde: false },
  Mars: { longitude: 201, speed: 0.5, isRetrograde: false },
  Jupiter: { longitude: 266, speed: 0.08, isRetrograde: false },
  Saturn: { longitude: 312, speed: 0.03, isRetrograde: false },
};

export const QUIET_TRANSITS: Record<Planet, PlanetPosition> = {
  Sun: { longitude: 3, speed: 0.98, isRetrograde: false },
  Moon: { longitude: 3, speed: 13.1, isRetrograde: false },
  Mercury: { longitude: 3, speed: 1, isRetrograde: false },
  Venus: { longitude: 3, speed: 1, isRetrograde: false },
  Mars: { longitude: 3, speed: 0.5, isRetrograde: false },
  Jupiter: { longitude: 3, speed: 0.08, isRetrograde: false },
  Saturn: { longitude: 3, speed: 0.03, isRetrograde: false },
};

export function positions(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>>): Record<Planet, PlanetPosition> {
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

export function natalProfile(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>> = {}) {
  const chart: ChartPositions = {
    planets: positions(overrides),
    ascendantLongitude: 270,
    isDayChart: true,
    ephemerisLibVersion: "fixture",
    computedAt: "2026-04-29T00:00:00.000Z",
  };
  return computeNatalProfileFromPositions({ precisionMode: "precise", chart });
}

export function inputFor(overrides: Partial<DailyEngineInput> = {}): DailyEngineInput {
  return {
    natalProfile: natalProfile(),
    calibration: null,
    forecastDate: "2026-04-29",
    userLocation: { lat: 55.75, lng: 37.61, timezone: "Europe/Moscow" },
    recentPlanetsOfDay: [],
    ...overrides,
  };
}

export function transitChart(overrides: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>>): TransitChart {
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
