import { describe, expect, it } from "vitest";
import { natalProfile, transitChart } from "../../../../modules/daily-engine/test-fixtures";
import { buildTopPetals, describePetalsRelation, type CalibrationLike, type PetalData } from "./topPetals";

const mockNatal = natalProfile();
const mockForecast = {
  ranked_planets: ["Saturn", "Mars", "Sun", "Moon"],
  importance: {
    Saturn: 0.8,
    Mars: 0.6,
    Sun: 0.5,
    Moon: 0.3,
  },
  transit_chart: transitChart({
    Saturn: { longitude: mockNatal.planets.Saturn.longitude, speed: 0.03 },
    Mars: { longitude: mockNatal.planets.Mars.longitude + 90, speed: 0.5 },
  }),
};

describe("buildTopPetals", () => {
  it("returns top 3 by ranked planets and importance map", () => {
    const petals = buildTopPetals(mockForecast, mockNatal, null, 3);

    expect(petals[0].planet).toBe("Saturn");
    expect(petals[1].planet).toBe("Mars");
    expect(petals[2].planet).toBe("Sun");
    expect(petals[0].importance).toBe(0.8);
  });

  it("uses calibrated values when available", () => {
    const calibration: CalibrationLike = {
      s_calibrated: { Saturn: 0.85 },
      h_calibrated: { Saturn: 0.3 },
    };

    const petals = buildTopPetals(mockForecast, mockNatal, calibration, 3);

    expect(petals[0].strength).toBe(0.85);
    expect(petals[0].harmoniousness).toBe(0.3);
    expect(petals[0].tone).toBe("harmonic");
  });

  it("describePetalsRelation returns correct labels", () => {
    const allHarmonic = [{ tone: "harmonic" }, { tone: "harmonic" }, { tone: "harmonic" }] as PetalData[];

    expect(describePetalsRelation(allHarmonic)).toContain("чистая волна");
  });
});
