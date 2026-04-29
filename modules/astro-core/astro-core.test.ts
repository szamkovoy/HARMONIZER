import { describe, expect, it } from "vitest";
import { computeNatalProfileFromPositions } from "./computeNatalProfile";
import type { ChartPositions, Planet, PlanetPosition } from "./core/types";

const BASE_POSITIONS: Record<Planet, PlanetPosition> = {
  Sun: { longitude: 10, speed: 0.98, isRetrograde: false },
  Moon: { longitude: 40, speed: 13.1, isRetrograde: false },
  Mercury: { longitude: 70, speed: 1, isRetrograde: false },
  Venus: { longitude: 130, speed: 1, isRetrograde: false },
  Mars: { longitude: 210, speed: 0.5, isRetrograde: false },
  Jupiter: { longitude: 260, speed: 0.08, isRetrograde: false },
  Saturn: { longitude: 320, speed: 0.03, isRetrograde: false },
};

function chart(params: {
  positions: Partial<Record<Planet, Partial<PlanetPosition> & { longitude: number }>>;
  ascendantLongitude?: number;
  isDayChart?: boolean;
}): ChartPositions {
  const planets = { ...BASE_POSITIONS } as Record<Planet, PlanetPosition>;

  for (const [planet, override] of Object.entries(params.positions) as Array<
    [Planet, Partial<PlanetPosition> & { longitude: number }]
  >) {
    planets[planet] = {
      ...planets[planet],
      ...override,
      speed: override.speed ?? planets[planet].speed,
      isRetrograde: override.isRetrograde ?? planets[planet].isRetrograde,
    };
  }

  return {
    planets,
    ascendantLongitude: params.ascendantLongitude,
    isDayChart: params.isDayChart ?? true,
    ephemerisLibVersion: "fixture",
    computedAt: "2026-04-29T00:00:00.000Z",
  };
}

describe("M1 Astro-Core natal math", () => {
  it("case 1: scores a strong, harmonious Jupiter", () => {
    const profile = computeNatalProfileFromPositions({
      precisionMode: "precise",
      chart: chart({
        ascendantLongitude: 150,
        isDayChart: true,
        positions: {
          Sun: { longitude: 20 },
          Moon: { longitude: 95 },
          Venus: { longitude: 345 },
          Jupiter: { longitude: 105 },
          Mars: { longitude: 160 },
          Saturn: { longitude: 300 },
        },
      }),
    });

    expect(profile.planets.Jupiter.S_initial).toBeGreaterThan(0.75);
    expect(profile.planets.Jupiter.H_initial).toBeGreaterThan(0.6);
  });

  it("case 2: scores a weak, dissonant Saturn", () => {
    const profile = computeNatalProfileFromPositions({
      precisionMode: "precise",
      chart: chart({
        ascendantLongitude: 30,
        isDayChart: false,
        positions: {
          Sun: { longitude: 25 },
          Moon: { longitude: 40 },
          Mars: { longitude: 21 },
          Saturn: { longitude: 20, isRetrograde: true },
          Jupiter: { longitude: 120 },
          Venus: { longitude: 250 },
        },
      }),
    });

    expect(profile.planets.Saturn.house).toBe(12);
    expect(profile.planets.Saturn.S_initial).toBeLessThan(0.3);
    expect(profile.planets.Saturn.H_initial).toBeLessThan(-0.5);
  });

  it("case 3: scores a strong Saturn architect profile", () => {
    const profile = computeNatalProfileFromPositions({
      precisionMode: "precise",
      chart: chart({
        ascendantLongitude: 270,
        isDayChart: true,
        positions: {
          Sun: { longitude: 20 },
          Moon: { longitude: 50 },
          Saturn: { longitude: 185 },
          Venus: { longitude: 305 },
          Jupiter: { longitude: 125 },
          Mars: { longitude: 20 },
        },
      }),
    });

    expect(profile.planets.Saturn.house).toBe(10);
    expect(profile.planets.Saturn.S_initial).toBeGreaterThan(0.8);
    expect(profile.planets.Saturn.H_initial).toBeGreaterThan(0.4);
  });

  it("case 4: supports unknown birth time via solar houses", () => {
    const profile = computeNatalProfileFromPositions({
      precisionMode: "unknown",
      chart: chart({
        isDayChart: true,
        positions: {
          Sun: { longitude: 140 },
          Moon: { longitude: 44 },
        },
      }),
    });

    expect(profile.ascendant).toBeUndefined();
    expect(profile.houseSystem).toBe("whole_sign_sun");
    expect(Object.keys(profile.planets)).toHaveLength(7);
    expect(profile.planets.Moon.S_initial).toBeGreaterThanOrEqual(0);
    expect(profile.planets.Moon.H_initial).toBeGreaterThanOrEqual(-1);
  });

  it("case 5: scores a harmonious Mars in Capricorn", () => {
    const profile = computeNatalProfileFromPositions({
      precisionMode: "precise",
      chart: chart({
        ascendantLongitude: 270,
        isDayChart: false,
        positions: {
          Sun: { longitude: 160 },
          Moon: { longitude: 40 },
          Mars: { longitude: 296 },
          Jupiter: { longitude: 56 },
          Venus: { longitude: 176 },
          Saturn: { longitude: 310 },
        },
      }),
    });

    expect(profile.planets.Mars.house).toBe(1);
    expect(profile.planets.Mars.S_initial).toBeGreaterThan(0.75);
    expect(profile.planets.Mars.H_initial).toBeGreaterThan(0.5);
  });
});
