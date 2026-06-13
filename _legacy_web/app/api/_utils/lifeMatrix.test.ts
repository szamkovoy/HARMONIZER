import { describe, expect, it } from "vitest";

import {
  buildLifeMatrixReportSnapshot,
  buildCalendarRangeTrend,
  chooseTargetChakra,
  computeRangeMetric,
  hasEnoughLifeMatrixHistory,
  LIFE_MATRIX_SIZE,
  sumMatrices,
  type DenseMatrix,
} from "./lifeMatrix";
import type { PetalData } from "./topPetals";

function petal(chakra: number, strength: number, planet = `P${chakra}`): PetalData {
  return {
    planet: planet as PetalData["planet"],
    chakra_number: chakra,
    chakra_label: `ч${chakra}`,
    importance: strength,
    strength,
    harmoniousness: 0,
    tone: "ambivalent_strong",
    main_transit: null,
    main_aspect: null,
    main_orb: null,
    main_activation: null,
  };
}

function matrixFromRowMasses(masses: number[]): DenseMatrix {
  const matrix = Array.from({ length: LIFE_MATRIX_SIZE }, () =>
    Array.from({ length: LIFE_MATRIX_SIZE }, () => 0),
  );
  for (let chakra = 0; chakra < LIFE_MATRIX_SIZE; chakra += 1) {
    matrix[chakra]![0] = masses[chakra] ?? 0;
  }
  return matrix;
}

describe("chooseTargetChakra", () => {
  const top3Skewed = [petal(3, 0.82, "Jupiter"), petal(2, 0.61, "Moon"), petal(6, 0.44, "Saturn")];
  const skewedProfile = [0.05, 0.3, 0.4, 0.03, 0.1, 0.1, 0.02];

  it("picks first top3 chakra below overdev threshold (ch6 for skewed profile)", () => {
    const result = chooseTargetChakra(top3Skewed, matrixFromRowMasses(skewedProfile));

    expect(result).toMatchObject({
      chakraNumber: 6,
      reason: "matrix_filtered_by_strength",
    });
    expect(result.explain).toMatch(/переразви/i);
    expect(result.explain).not.toContain("терцил");
  });

  it("falls back to strongest when all top3 are overdeveloped", () => {
    const top3 = [petal(3, 0.82), petal(2, 0.61), petal(1, 0.5)];
    const profile = [0.32, 0.33, 0.34, 0.01, 0.0, 0.0, 0.0];
    const result = chooseTargetChakra(top3, matrixFromRowMasses(profile));

    expect(result).toMatchObject({
      chakraNumber: 3,
      reason: "astro_primary_all_overdeveloped",
    });
    expect(result.explain).toContain("Все три уже переразвиты");
  });

  it("picks strongest top3 immediately when it is not overdeveloped", () => {
    const top3 = [petal(5, 0.9, "Mars"), petal(3, 0.7), petal(2, 0.5)];
    const profile = [0.12, 0.12, 0.12, 0.12, 0.16, 0.12, 0.12];
    const result = chooseTargetChakra(top3, matrixFromRowMasses(profile));

    expect(result).toMatchObject({
      chakraNumber: 5,
      reason: "matrix_filtered_by_strength",
    });
    expect(result.explain).toContain("перекоса относительно равновесия нет");
  });
});

describe("buildCalendarRangeTrend", () => {
  function matrixWithSignal(chakra: number): DenseMatrix {
    const matrix = Array.from({ length: LIFE_MATRIX_SIZE }, () =>
      Array.from({ length: LIFE_MATRIX_SIZE }, () => 0),
    );
    matrix[chakra - 1]![0] = 1;
    return matrix;
  }

  it("returns one point after five active days at the last day of the block", () => {
    const activeDates = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-10"];
    const matrixByDate = new Map(
      activeDates.slice(0, 5).map((date, index) => [date, matrixWithSignal((index % 7) + 1)]),
    );

    const trend = buildCalendarRangeTrend(activeDates, matrixByDate, 5);

    expect(trend).toHaveLength(1);
    expect(trend[0]?.localDate).toBe("2026-05-05");
    expect(typeof trend[0]?.rangeMetric).toBe("number");
  });

  it("skips incomplete trailing block", () => {
    const activeDates = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06"];
    const matrixByDate = new Map(activeDates.map((date) => [date, matrixWithSignal(3)]));

    expect(buildCalendarRangeTrend(activeDates, matrixByDate, 5)).toHaveLength(1);
  });

  it("computes range metric on aggregated matrix, not averaged daily metrics", () => {
    const activeDates = ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"];
    const matrixByDate = new Map(activeDates.map((date) => [date, matrixWithSignal(1)]));
    const aggregatedMetric = computeRangeMetric(
      sumMatrices(activeDates.map((date) => matrixByDate.get(date)!)),
    );
    const trend = buildCalendarRangeTrend(activeDates, matrixByDate, 5);

    expect(trend[0]?.rangeMetric).toBe(aggregatedMetric);
  });

  it("builds a first point after five calendar days even when some days have no summarized events", () => {
    const activeDates = ["2026-05-25", "2026-05-26", "2026-06-02"];
    const matrixByDate = new Map(activeDates.map((date, index) => [date, matrixWithSignal((index % 7) + 1)]));

    const trend = buildCalendarRangeTrend(activeDates, matrixByDate, 5);

    expect(trend).toHaveLength(1);
    expect(trend[0]?.localDate).toBe("2026-05-29");
  });
});

describe("buildLifeMatrixReportSnapshot", () => {
  function matrixWithSignal(chakra: number): DenseMatrix {
    const matrix = Array.from({ length: LIFE_MATRIX_SIZE }, () =>
      Array.from({ length: LIFE_MATRIX_SIZE }, () => 0),
    );
    matrix[chakra - 1]![0] = 1;
    return matrix;
  }

  it("builds aggregate matrix and trend from compact daily rows", () => {
    const rows = [
      { localDate: "2026-05-01", matrix: matrixWithSignal(1) },
      { localDate: "2026-05-02", matrix: matrixWithSignal(2) },
      { localDate: "2026-05-03", matrix: matrixWithSignal(3) },
      { localDate: "2026-05-04", matrix: matrixWithSignal(4) },
      { localDate: "2026-05-05", matrix: matrixWithSignal(5) },
    ];

    const snapshot = buildLifeMatrixReportSnapshot(rows, { groupSize: 5, smoothingK: 50 });

    expect(snapshot.activeDaysCount).toBe(5);
    expect(snapshot.lastRolledDate).toBe("2026-05-05");
    expect(snapshot.calendarTrend).toHaveLength(1);
    expect(snapshot.rawMatrix).toEqual(sumMatrices(rows.map((row) => row.matrix)));
    expect(snapshot.visualMatrix.flat().some((value) => value > 0)).toBe(true);
  });
});

describe("hasEnoughLifeMatrixHistory", () => {
  it("requires both enough summarized events and five elapsed calendar days", () => {
    expect(hasEnoughLifeMatrixHistory({
      summarizedEventsCount: 5,
      firstSummaryLocalDate: "2026-05-25",
      currentLocalDate: "2026-06-02",
    })).toBe(true);
  });

  it("stays false when only active days are few but calendar gap is long and events are insufficient", () => {
    expect(hasEnoughLifeMatrixHistory({
      summarizedEventsCount: 4,
      firstSummaryLocalDate: "2026-05-25",
      currentLocalDate: "2026-06-02",
    })).toBe(false);
  });
});
