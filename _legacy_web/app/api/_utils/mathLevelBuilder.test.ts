import { describe, expect, it } from "vitest";
import { natalProfile, transitChart } from "../../../../modules/daily-engine/test-fixtures";
import { buildMathLevel } from "./mathLevelBuilder";
import type { CalibrationLike } from "./topPetals";
import type { Planet } from "../../../modules/astro-core";

const mockNatal = natalProfile();
const mockForecast = {
  ranked_planets: ["Saturn", "Mars", "Sun", "Moon"],
  planet_of_the_day: "Saturn" as Planet,
  importance: {
    Saturn: 0.8,
    Mars: 0.6,
    Sun: 0.5,
    Moon: 0.3,
  },
  activation: {
    Saturn: 0.7,
    Mars: 0.5,
    Sun: 0.4,
    Moon: 0.2,
  },
  transit_chart: transitChart({
    Saturn: { longitude: mockNatal.planets.Saturn.longitude, speed: 0.03 },
    Mars: { longitude: mockNatal.planets.Mars.longitude + 90, speed: 0.5 },
  }),
};

const mockCalibration: CalibrationLike = {
  version: 2,
  source: "manual_resync",
  s_calibrated: { Saturn: 0.85 },
  h_calibrated: { Saturn: 0.3 },
  delta_from_initial: { Saturn: { dS: 0.1, dH: 0.2 } },
};

describe("buildMathLevel", () => {
  it("returns markdown with all sections", () => {
    const result = buildMathLevel(mockForecast, mockNatal, null);

    expect(result.markdown).toContain("Сила (S) и гармоничность (H)");
    expect(result.markdown).toContain("Активирующие транзиты");
    expect(result.markdown).toContain("Importance");
    expect(result.markdown).toContain("Выбор планеты дня");
  });

  it("includes calibration deltas when calibration is present", () => {
    const result = buildMathLevel(mockForecast, mockNatal, mockCalibration);

    expect(result.markdown).toContain("Дельты калибровки");
    expect(result.structured.calibration_deltas).toBeDefined();
  });

  it("structured.natal_strengths has all 7 planets", () => {
    const result = buildMathLevel(mockForecast, mockNatal, null);

    expect(result.structured.natal_strengths).toHaveLength(7);
  });
});
