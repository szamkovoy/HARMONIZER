import { DateTime } from "luxon";

import { getLifeMatrixOverdevThreshold } from "./dialogConfig";
import type { PetalData } from "./topPetals";

export type MatrixCell = {
  sphere: number;
  chakra: number;
  weight: number;
};

export type DenseMatrix = number[][];

export type DailyMatrixSource = "summary" | "plan";

export const LIFE_MATRIX_SIZE = 7;
export const LIFE_MATRIX_MIN_READY_MEASUREMENTS = 5;
export const LIFE_MATRIX_MIN_READY_EVENTS = 5;
export const LIFE_MATRIX_MIN_READY_ELAPSED_DAYS = 5;
export const RANGE_GROUP_SIZE_DEFAULT = 5;
export const LIFE_MATRIX_LOG_SMOOTHING_K_DEFAULT = 50;

function emptyMatrix(): DenseMatrix {
  return Array.from({ length: LIFE_MATRIX_SIZE }, () => Array.from({ length: LIFE_MATRIX_SIZE }, () => 0));
}

function validIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= LIFE_MATRIX_SIZE;
}

export function normalizeCells(rawCells: MatrixCell[] | null | undefined): MatrixCell[] {
  const grouped = new Map<number, MatrixCell[]>();

  for (const cell of rawCells ?? []) {
    if (!validIndex(cell.sphere) || !validIndex(cell.chakra)) continue;
    const safeWeight = Number.isFinite(cell.weight) && cell.weight > 0 ? cell.weight : 0;
    if (safeWeight <= 0) continue;
    const next = grouped.get(cell.sphere) ?? [];
    next.push({ sphere: cell.sphere, chakra: cell.chakra, weight: safeWeight });
    grouped.set(cell.sphere, next);
  }

  const out: MatrixCell[] = [];
  for (const cells of grouped.values()) {
    const total = cells.reduce((sum, cell) => sum + cell.weight, 0);
    if (total <= 0) continue;
    for (const cell of cells) {
      out.push({
        sphere: cell.sphere,
        chakra: cell.chakra,
        weight: Number((cell.weight / total).toFixed(6)),
      });
    }
  }
  return out;
}

export function parseCompactCells(raw: string | null | undefined): MatrixCell[] {
  if (!raw?.trim()) return [];
  return normalizeCells(
    raw
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [sphere, chakra, weight] = chunk.split(":").map((part) => part.trim());
        return {
          sphere: Number.parseInt(sphere ?? "", 10),
          chakra: Number.parseInt(chakra ?? "", 10),
          weight: Number.parseFloat(weight ?? ""),
        };
      }),
  );
}

export function buildDailyMatrix(cellsCollections: MatrixCell[][]): DenseMatrix {
  const matrix = emptyMatrix();
  const bySphere = new Map<number, Array<{ chakra: number; weight: number }>>();

  for (const collection of cellsCollections) {
    for (const cell of normalizeCells(collection)) {
      const next = bySphere.get(cell.sphere) ?? [];
      next.push({ chakra: cell.chakra, weight: cell.weight });
      bySphere.set(cell.sphere, next);
    }
  }

  for (const [sphere, cells] of bySphere.entries()) {
    const total = cells.reduce((sum, cell) => sum + cell.weight, 0);
    if (total <= 0) continue;
    for (const cell of cells) {
      matrix[cell.chakra - 1]![sphere - 1] = Number((matrix[cell.chakra - 1]![sphere - 1]! + cell.weight / total).toFixed(6));
    }
  }

  return matrix;
}

export function flattenMatrix(matrix: DenseMatrix): number[] {
  return matrix.flat().filter((value) => Number.isFinite(value) && value > 0);
}

export function computeRangeMetric(matrix: DenseMatrix): number | null {
  const flat = flattenMatrix(matrix);
  const total = flat.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;

  const normalized = flat.map((value) => value / total);
  const entropy = normalized.reduce((sum, value) => sum - value * Math.log(value), 0);
  const maxEntropy = Math.log(LIFE_MATRIX_SIZE * LIFE_MATRIX_SIZE);
  if (!Number.isFinite(entropy) || !Number.isFinite(maxEntropy) || maxEntropy <= 0) return null;

  return Number((entropy / maxEntropy).toFixed(6));
}

export function sumMatrices(matrices: DenseMatrix[]): DenseMatrix {
  const out = emptyMatrix();
  for (const matrix of matrices) {
    for (let row = 0; row < LIFE_MATRIX_SIZE; row += 1) {
      for (let col = 0; col < LIFE_MATRIX_SIZE; col += 1) {
        out[row]![col] = Number((out[row]![col]! + (matrix[row]?.[col] ?? 0)).toFixed(6));
      }
    }
  }
  return out;
}

export function densityMatrix(matrix: DenseMatrix): DenseMatrix {
  const total = matrix.flat().reduce((sum, value) => sum + value, 0);
  if (total <= 0) return emptyMatrix();
  return matrix.map((row) => row.map((value) => Number((value / total).toFixed(6))));
}

export function logSmoothedVisMatrix(matrix: DenseMatrix, k = LIFE_MATRIX_LOG_SMOOTHING_K_DEFAULT): DenseMatrix {
  const density = densityMatrix(matrix);
  const raw = density.map((row) => row.map((value) => Math.log(1 + k * value)));
  const max = Math.max(0, ...raw.flat());
  if (max <= 0) return emptyMatrix();
  return raw.map((row) => row.map((value) => Number((value / max).toFixed(6))));
}

export function rowMass(matrix: DenseMatrix): number[] {
  return matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
}

export function isMatrixReady(measurementsCount: number): boolean {
  return measurementsCount >= LIFE_MATRIX_MIN_READY_MEASUREMENTS;
}

export function hasEnoughLifeMatrixHistory(params: {
  summarizedEventsCount: number;
  firstSummaryLocalDate: string | null;
  currentLocalDate: string;
}): boolean {
  if (params.summarizedEventsCount < LIFE_MATRIX_MIN_READY_EVENTS) return false;
  if (!params.firstSummaryLocalDate) return false;
  const first = DateTime.fromISO(params.firstSummaryLocalDate, { zone: "UTC" }).startOf("day");
  const current = DateTime.fromISO(params.currentLocalDate, { zone: "UTC" }).startOf("day");
  if (!first.isValid || !current.isValid || current < first) return false;
  const elapsedDays = Math.floor(current.diff(first, "days").days);
  return elapsedDays >= LIFE_MATRIX_MIN_READY_ELAPSED_DAYS;
}

export function chooseTargetChakra(top3: PetalData[], matrix: DenseMatrix | null): {
  chakraNumber: number;
  reason: "astro_primary" | "matrix_filtered_by_strength" | "astro_primary_all_overdeveloped";
  explain: string;
} {
  if (!top3.length) {
    return {
      chakraNumber: 7,
      reason: "astro_primary",
      explain: "fallback: no ranked planets available",
    };
  }

  if (!matrix) {
    const first = top3[0]!;
    return {
      chakraNumber: first.chakra_number,
      reason: "astro_primary",
      explain: `Матрица ещё не собрана, поэтому берём самое сильное направление дня: ${first.planet} -> чакра ${first.chakra_number}.`,
    };
  }

  const masses = rowMass(matrix);
  const total = masses.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    const first = top3[0]!;
    return {
      chakraNumber: first.chakra_number,
      reason: "astro_primary",
      explain: `Матрица пустая, поэтому берём самое сильное направление дня: ${first.planet} -> чакра ${first.chakra_number}.`,
    };
  }

  const proportions = masses.map((value) => value / total);
  const overdevThreshold = getLifeMatrixOverdevThreshold();
  const equilibriumShare = 1 / LIFE_MATRIX_SIZE;
  const overdevelopedInTop3 = top3
    .filter((candidate) => (proportions[candidate.chakra_number - 1] ?? 0) > overdevThreshold)
    .map((candidate) => `ч${candidate.chakra_number} (${(proportions[candidate.chakra_number - 1] ?? 0).toFixed(3)})`);
  const top3Summary = top3
    .map((candidate) => `${candidate.planet} -> ч${candidate.chakra_number}`)
    .join(", ");

  for (const candidate of top3) {
    const proportion = proportions[candidate.chakra_number - 1] ?? 0;
    if (proportion <= overdevThreshold) {
      const overdevNote =
        overdevelopedInTop3.length > 0
          ? ` Переразвиты относительно равновесия (${equilibriumShare.toFixed(4)}): ${overdevelopedInTop3.join(", ")}.`
          : " Среди top-3 перекоса относительно равновесия нет.";
      return {
        chakraNumber: candidate.chakra_number,
        reason: "matrix_filtered_by_strength",
        explain:
          `Сильнейшие направления дня: ${top3Summary}.` +
          overdevNote +
          ` Выбрано первое непереразвитое по силе — ${candidate.planet} (чакра ${candidate.chakra_number}, доля ${proportion.toFixed(3)}, порог перекоса ${overdevThreshold.toFixed(4)} при равновесии ${equilibriumShare.toFixed(4)}).`,
      };
    }
  }

  const first = top3[0]!;
  return {
    chakraNumber: first.chakra_number,
    reason: "astro_primary_all_overdeveloped",
    explain:
      `Сильнейшие направления дня: ${top3Summary}. Все три уже переразвиты относительно равновесия (${equilibriumShare.toFixed(4)}): ` +
      `${overdevelopedInTop3.join(", ")}. Остаёмся на сильнейшей планете дня ${first.planet} -> чакра ${first.chakra_number}.`,
  };
}

export function groupRangeTrend(values: Array<number | null>, groupSize = RANGE_GROUP_SIZE_DEFAULT): number[] {
  if (groupSize <= 1) return values.filter((value): value is number => value != null);
  const out: number[] = [];
  for (let index = 0; index < values.length; index += groupSize) {
    const chunk = values.slice(index, index + groupSize).filter((value): value is number => value != null);
    if (!chunk.length) continue;
    out.push(Number((chunk.reduce((sum, value) => sum + value, 0) / chunk.length).toFixed(6)));
  }
  return out;
}

export type CalendarTrendPoint = {
  localDate: string;
  rangeMetric: number;
};

export type DailyMatrixSnapshotRow = {
  localDate: string;
  matrix: DenseMatrix;
};

export type LifeMatrixReportSnapshot = {
  activeDaysCount: number;
  rawMatrix: DenseMatrix;
  visualMatrix: DenseMatrix;
  calendarTrend: CalendarTrendPoint[];
  lastRolledDate: string | null;
};

/** Groups sorted active calendar days into blocks of `groupSize` and computes range_metric on summed matrices. */
export function buildCalendarRangeTrend(
  activeDatesAsc: string[],
  matrixByDate: Map<string, DenseMatrix>,
  groupSize = RANGE_GROUP_SIZE_DEFAULT,
): CalendarTrendPoint[] {
  const first = activeDatesAsc[0];
  const last = activeDatesAsc.at(-1);
  if (!first || !last) return [];

  const firstDate = DateTime.fromISO(first, { zone: "UTC" }).startOf("day");
  const lastDate = DateTime.fromISO(last, { zone: "UTC" }).startOf("day");
  if (!firstDate.isValid || !lastDate.isValid || lastDate < firstDate) return [];

  const calendarDates: string[] = [];
  for (let cursor = firstDate; cursor <= lastDate; cursor = cursor.plus({ days: 1 })) {
    calendarDates.push(cursor.toFormat("yyyy-MM-dd"));
  }

  const out: CalendarTrendPoint[] = [];
  for (let index = 0; index + groupSize <= calendarDates.length; index += groupSize) {
    const blockDates = calendarDates.slice(index, index + groupSize);
    const matrices = blockDates
      .map((date) => matrixByDate.get(date))
      .filter((matrix): matrix is DenseMatrix => Boolean(matrix));
    if (matrices.length === 0) continue;
    const rangeMetric = computeRangeMetric(sumMatrices(matrices));
    if (rangeMetric == null) continue;
    out.push({ localDate: blockDates[groupSize - 1]!, rangeMetric });
  }
  return out;
}

export function uniqueSortedDates(dates: string[]): string[] {
  return [...new Set(dates.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function buildLifeMatrixReportSnapshot(
  rows: DailyMatrixSnapshotRow[],
  options?: {
    groupSize?: number;
    smoothingK?: number;
  },
): LifeMatrixReportSnapshot {
  const activeDates = uniqueSortedDates(rows.map((row) => row.localDate));
  const matrixByDate = new Map(rows.map((row) => [row.localDate, row.matrix]));
  const aggregatedMatrices = activeDates
    .map((date) => matrixByDate.get(date))
    .filter((matrix): matrix is DenseMatrix => Boolean(matrix));
  const rawMatrix = aggregatedMatrices.length ? sumMatrices(aggregatedMatrices) : emptyMatrix();

  return {
    activeDaysCount: activeDates.length,
    rawMatrix,
    visualMatrix: logSmoothedVisMatrix(rawMatrix, options?.smoothingK ?? LIFE_MATRIX_LOG_SMOOTHING_K_DEFAULT),
    calendarTrend: buildCalendarRangeTrend(activeDates, matrixByDate, options?.groupSize ?? RANGE_GROUP_SIZE_DEFAULT),
    lastRolledDate: activeDates.at(-1) ?? null,
  };
}
