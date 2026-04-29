import { describe, expect, it } from "vitest";
import { computeDailyForecastFromTransits } from "./computeDailyForecast";
import { inputFor, natalProfile, transitChart } from "./test-fixtures";

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

  it("uses calibrated S when computing importance", () => {
    const baseInput = inputFor({
      natalProfile: natalProfile({ Saturn: { longitude: 100 } }),
    });
    const transits = transitChart({
      Saturn: { longitude: 101, speed: 0.03 },
    });

    const lowStrength = computeDailyForecastFromTransits({
      input: {
        ...baseInput,
        calibration: {
          S_calibrated: {
            Saturn: 0,
          },
        },
      },
      transitChart: transits,
    });
    const highStrength = computeDailyForecastFromTransits({
      input: {
        ...baseInput,
        calibration: {
          S_calibrated: {
            Saturn: 1,
          },
        },
      },
      transitChart: transits,
    });

    expect(highStrength.activation.Saturn).toBe(lowStrength.activation.Saturn);
    expect(highStrength.importance.Saturn).toBeGreaterThan(lowStrength.importance.Saturn);
  });
});
