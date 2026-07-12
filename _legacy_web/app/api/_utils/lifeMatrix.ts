import { DateTime } from "luxon";

import type { PetalData } from "./topPetals";

export type MatrixCell = {
  sphere: number;
  chakra: number;
  weight: number;
};

export type PlanningSphereCell = {
  sphere: number;
  weight: number;
};

export type DenseMatrix = number[][];

export type DailyMatrixSource = "summary" | "plan";

export const LIFE_MATRIX_SIZE = 7;
export const LIFE_MATRIX_MIN_READY_MEASUREMENTS = 5;
export const LIFE_MATRIX_MIN_READY_EVENTS = 5;
export const LIFE_MATRIX_MIN_READY_ELAPSED_DAYS = 5;
export const RANGE_GROUP_SIZE_DEFAULT = 7;
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

export function normalizePlanningSphereCells(rawCells: PlanningSphereCell[] | null | undefined): PlanningSphereCell[] {
  const grouped = new Map<number, number>();
  for (const cell of rawCells ?? []) {
    if (!validIndex(cell.sphere)) continue;
    const safeWeight = Number.isFinite(cell.weight) && cell.weight > 0 ? cell.weight : 0;
    if (safeWeight <= 0) continue;
    grouped.set(cell.sphere, (grouped.get(cell.sphere) ?? 0) + safeWeight);
  }

  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return [...grouped.entries()].map(([sphere, weight]) => ({
    sphere,
    weight: Number((weight / total).toFixed(6)),
  }));
}

export function planningSphereCellsFromMatrixCells(rawCells: MatrixCell[] | null | undefined): PlanningSphereCell[] {
  return normalizePlanningSphereCells(
    (rawCells ?? [])
      .filter((cell) => validIndex(cell.sphere) && validIndex(cell.chakra))
      .map((cell) => ({
        sphere: cell.sphere,
        weight: Number.isFinite(cell.weight) && cell.weight > 0 ? cell.weight : 0,
      })),
  );
}

export function parseCompactPlanningSphereCells(raw: string | null | undefined): PlanningSphereCell[] {
  if (!raw?.trim()) return [];
  const parsed = raw
    .split(";")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split(":").map((part) => part.trim());
      const sphereRaw = parts[0];
      const weightRaw = parts.length >= 3 ? parts[2] : parts[1];
      const parsedWeight = weightRaw ? Number.parseFloat(weightRaw) : 1;
      return {
        sphere: Number.parseInt(sphereRaw ?? "", 10),
        weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 1,
      };
    });
  return normalizePlanningSphereCells(parsed);
}

export function asPlanningSphereCells(value: unknown): PlanningSphereCell[] {
  if (!Array.isArray(value)) return [];
  const sphereOnly = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const raw = item as { sphere?: unknown; weight?: unknown; chakra?: unknown };
      if (!Number.isInteger(raw.sphere)) return null;
      if (raw.chakra != null && !Number.isInteger(raw.chakra)) return null;
      return {
        sphere: Number(raw.sphere),
        weight: Number.isFinite(Number(raw.weight)) && Number(raw.weight) > 0 ? Number(raw.weight) : 1,
        chakra: raw.chakra == null ? null : Number(raw.chakra),
      };
    })
    .filter((item): item is { sphere: number; weight: number; chakra: number | null } => Boolean(item));
  if (!sphereOnly.length) return [];
  const hasChakra = sphereOnly.some((cell) => cell.chakra != null);
  return hasChakra
    ? planningSphereCellsFromMatrixCells(
        sphereOnly
          .filter((cell): cell is { sphere: number; weight: number; chakra: number } => cell.chakra != null)
          .map((cell) => ({ sphere: cell.sphere, chakra: cell.chakra, weight: cell.weight })),
      )
    : normalizePlanningSphereCells(sphereOnly.map(({ sphere, weight }) => ({ sphere, weight })));
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

export function chooseTargetChakra(top3: PetalData[], _matrix: DenseMatrix | null): {
  chakraNumber: number;
  reason: "astro_primary" | "matrix_filtered_by_strength" | "astro_primary_all_overdeveloped";
  explain: string;
} {
  // Product alignment with morning recommendation / Home «Рекомендации на день»:
  // interpret the strongest planet of the day (top-1). Matrix overdev filtering of
  // top-3 used to pick a secondary chakra (e.g. 2 while Moon→1), so dialog and Home
  // disagreed. Keep the reason union for DB compatibility; matrix arg unused for now.
  if (!top3.length) {
    return {
      chakraNumber: 7,
      reason: "astro_primary",
      explain: "Сегодня нет выраженно сильной планеты, поэтому фокус дня — седьмая чакра по умолчанию.",
    };
  }

  const first = top3[0]!;
  return {
    chakraNumber: first.chakra_number,
    reason: "astro_primary",
    explain: `Это самое сильное направление дня по астрологии (${first.planet}).`,
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
