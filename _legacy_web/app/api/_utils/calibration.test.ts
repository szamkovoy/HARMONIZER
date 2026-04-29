import { describe, expect, it } from "vitest";
import type { NatalProfile, Planet } from "../../../../modules/astro-core";
import { PLANETS_7 } from "./calibration";
import { averageCalibration, type CalibrationExtraction } from "./calibration";

function natalWithValues(S_initial: number, H_initial: number): NatalProfile {
  return {
    planets: Object.fromEntries(
      PLANETS_7.map((planet) => [
        planet,
        {
          S_initial,
          H_initial,
        },
      ]),
    ) as Record<Planet, NatalProfile["planets"][Planet]>,
  } as NatalProfile;
}

const mockNatal = natalWithValues(0.5, 0);

const mockExtractionMaxPositive: CalibrationExtraction = {
  deltas: Object.fromEntries(
    PLANETS_7.map((planet) => [
      planet,
      {
        dS: 0.3,
        dH: 0.3,
        confirmed: true,
      },
    ]),
  ) as CalibrationExtraction["deltas"],
};

describe("averageCalibration", () => {
  it("uses 60/40 ratio for source=initial", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "initial");

    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
    expect(result.H_calibrated.Sun).toBeCloseTo(0.12, 2);
  });

  it("uses 60/40 ratio for source=manual_resync", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "manual_resync");

    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
    expect(result.H_calibrated.Sun).toBeCloseTo(0.12, 2);
  });

  it("uses 50/50 ratio for source=auto_aggregated", () => {
    const result = averageCalibration(mockNatal, mockExtractionMaxPositive, "auto_aggregated");

    expect(result.S_calibrated.Sun).toBeCloseTo(0.65, 2);
    expect(result.H_calibrated.Sun).toBeCloseTo(0.15, 2);
  });

  it("clamps deltas to +/-0.30 even if LLM returns out-of-range values", () => {
    const extremeExtraction: CalibrationExtraction = {
      deltas: {
        ...mockExtractionMaxPositive.deltas,
        Sun: { dS: 0.5, dH: -0.8, confirmed: true },
      },
    };

    const result = averageCalibration(mockNatal, extremeExtraction, "initial");

    expect(result.S_calibrated.Sun).toBeCloseTo(0.62, 2);
    expect(result.H_calibrated.Sun).toBeCloseTo(-0.12, 2);
  });

  it("clamps proposed values to valid S and H ranges", () => {
    const highNatal = natalWithValues(0.95, 0.95);

    const result = averageCalibration(highNatal, mockExtractionMaxPositive, "auto_aggregated");

    expect(result.S_calibrated.Sun).toBeLessThanOrEqual(1);
    expect(result.H_calibrated.Sun).toBeLessThanOrEqual(1);
  });
});
