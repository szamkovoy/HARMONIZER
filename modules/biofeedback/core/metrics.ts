import type { HrvPracticeTier } from "@/modules/biofeedback/core/types";
import {
  HRV_MIN_VALID_BEATS_FOR_METRICS,
  HRV_PREFIX_BEATS_FOR_SEGMENT,
  HRV_RR_HARD_MAX_MS,
  HRV_RR_HARD_MIN_MS,
  HRV_TAIL_BEATS_FINAL_LONG,
  HRV_TAIL_BEATS_FINAL_MID,
} from "@/modules/biofeedback/core/hrv-practice-constants";

/** Экспортируются для диагностического JSON (сравнение с классическим RMSSD). */
export const HRV_HAMPEL_WINDOW_SIZE = 13;
export const HRV_HAMPEL_NSIGMA = 3;
const HAMPEL_MAD_SCALE = 1.4826;

function rrPairOkForRmssd(rr0: number, rr1: number): boolean {
  return (
    rr0 >= HRV_RR_HARD_MIN_MS &&
    rr0 <= HRV_RR_HARD_MAX_MS &&
    rr1 >= HRV_RR_HARD_MIN_MS &&
    rr1 <= HRV_RR_HARD_MAX_MS
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianSorted(sorted: readonly number[]) {
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function median(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  return medianSorted([...values].sort((left, right) => left - right));
}

function splitIntoEqualChunks<T>(arr: readonly T[], parts: number): T[][] {
  if (arr.length === 0 || parts <= 0) {
    return [];
  }
  const out: T[][] = [];
  const n = arr.length;
  const base = Math.floor(n / parts);
  const rem = n % parts;
  let idx = 0;
  for (let p = 0; p < parts; p += 1) {
    const len = base + (p < rem ? 1 : 0);
    if (len > 0) {
      out.push(arr.slice(idx, idx + len) as T[]);
      idx += len;
    }
  }
  return out;
}

/**
 * Классический RMSSD по ряду интервалов RR (между валидными ударами): sqrt(mean((RR[i+1]-RR[i])²)).
 */
export function computeRmssdStandardFromRrIntervals(rr: readonly number[]): number {
  if (rr.length < 2) {
    return 0;
  }
  const sq: number[] = [];
  for (let i = 0; i < rr.length - 1; i += 1) {
    const d = rr[i + 1] - rr[i];
    sq.push(d * d);
  }
  return Math.sqrt(mean(sq));
}

/** RMSSD с усечением хвоста квадратов разностей — снижает влияние единичных артефактов на хвосте RR. */
function computeRmssdStandardFromRrIntervalsTrimmed(
  rr: readonly number[],
  trimRatio = 0.12,
): number {
  if (rr.length < 2) {
    return 0;
  }
  const sq: number[] = [];
  for (let i = 0; i < rr.length - 1; i += 1) {
    const d = rr[i + 1] - rr[i];
    sq.push(d * d);
  }
  if (sq.length < 3) {
    return Math.sqrt(mean(sq));
  }
  const sorted = [...sq].sort((left, right) => left - right);
  const trimCount = Math.min(
    Math.floor(sorted.length * trimRatio),
    Math.floor((sorted.length - 1) / 2),
  );
  const trimmed = trimCount <= 0 ? sorted : sorted.slice(trimCount, sorted.length - trimCount);
  return trimmed.length === 0 ? Math.sqrt(mean(sq)) : Math.sqrt(mean(trimmed));
}

function computeRmssdStandardFromRrIntervalsTrimmedMasked(
  rr: readonly number[],
  trimRatio: number,
  intervalValid: readonly boolean[],
): number {
  if (rr.length < 2 || intervalValid.length !== rr.length) {
    return computeRmssdStandardFromRrIntervalsTrimmed(rr, trimRatio);
  }
  const sq: number[] = [];
  for (let i = 0; i < rr.length - 1; i += 1) {
    if (!intervalValid[i] || !intervalValid[i + 1]) {
      continue;
    }
    const d = rr[i + 1] - rr[i];
    sq.push(d * d);
  }
  if (sq.length === 0) {
    return 0;
  }
  if (sq.length < 3) {
    return Math.sqrt(mean(sq));
  }
  const sorted = [...sq].sort((left, right) => left - right);
  const trimCount = Math.min(
    Math.floor(sorted.length * trimRatio),
    Math.floor((sorted.length - 1) / 2),
  );
  const trimmed = trimCount <= 0 ? sorted : sorted.slice(trimCount, sorted.length - trimCount);
  return trimmed.length === 0 ? Math.sqrt(mean(sq)) : Math.sqrt(mean(trimmed));
}

/** Практика: верхняя граница правдоподобного сегментного RMSSD (камера/хвост при снятии пальца). */
const HRV_PRACTICE_RMSSD_TRIM = 0.12;
const HRV_PRACTICE_RMSSD_ABS_MAX_MS = 160;

function medianBlockRmssdMasked(
  rr: readonly number[],
  blockCount: number,
  intervalValid: readonly boolean[],
): number {
  if (rr.length < 2 || blockCount <= 0 || intervalValid.length !== rr.length) {
    return 0;
  }
  if (blockCount === 1) {
    return computeRmssdStandardFromRrIntervalsTrimmedMasked(rr, HRV_PRACTICE_RMSSD_TRIM, intervalValid);
  }
  const chunks = splitIntoEqualChunks(rr, blockCount);
  const valChunks = splitIntoEqualChunks(intervalValid, blockCount);
  const vals = chunks
    .map((ch, idx) =>
      computeRmssdStandardFromRrIntervalsTrimmedMasked(
        ch,
        HRV_PRACTICE_RMSSD_TRIM,
        valChunks[idx] ?? [],
      ),
    )
    .filter((v) => v > 0);
  return vals.length === 0 ? 0 : median(vals);
}

function rmssdSegmentMasked(
  rr: readonly number[],
  blockCount: number,
  hampelOutlier: readonly boolean[],
): number {
  if (rr.length < 2) {
    return 0;
  }
  const intervalValid = hampelOutlier.map((o) => !o);
  let v = medianBlockRmssdMasked(rr, blockCount, intervalValid);
  if (v <= 0) {
    v = computeRmssdStandardFromRrIntervalsTrimmedMasked(rr, HRV_PRACTICE_RMSSD_TRIM, intervalValid);
  }
  return Math.min(v, HRV_PRACTICE_RMSSD_ABS_MAX_MS);
}

/** Индекс Баевского по сегменту RR: медиана сырого индекса по блокам, затем запасной вариант по всему ряду. */
function stressSegmentRaw(rr: readonly number[], blockCount: number): number {
  if (rr.length < 3) {
    return 0;
  }
  if (blockCount <= 1) {
    return calculateBaevskyStressIndexRaw(rr);
  }
  const chunks = splitIntoEqualChunks(rr, blockCount);
  const vals = chunks
    .map((ch) => (ch.length >= 3 ? calculateBaevskyStressIndexRaw(ch) : 0))
    .filter((v) => v > 0);
  const raw = vals.length === 0 ? 0 : median(vals);
  return raw > 0 ? raw : calculateBaevskyStressIndexRaw(rr);
}

/**
 * Hampel: выбросы по отношению к медиане окна; порог 3×MAD×1.4826.
 * Выбросы заменяются медианой окна (цепочка RR сохраняет длину).
 */
export function hampelFilterRrIntervals(
  rr: readonly number[],
  windowSize = HRV_HAMPEL_WINDOW_SIZE,
  nSigma = HRV_HAMPEL_NSIGMA,
): number[] {
  const n = rr.length;
  if (n === 0) {
    return [];
  }
  const half = Math.floor(windowSize / 2);
  const out = rr.slice();
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const win = rr.slice(lo, hi);
    const med = median(win);
    const absDev = win.map((x) => Math.abs(x - med));
    const mad = median(absDev);
    const thr = nSigma * HAMPEL_MAD_SCALE * mad;
    if (Math.abs(rr[i] - med) > thr) {
      out[i] = med;
    }
  }
  return out;
}

/**
 * Те же правила, что у Хампеля, но только флаги выбросов (для RMSSD — исключение интервалов, не подмена).
 */
export function hampelOutlierFlags(
  rr: readonly number[],
  windowSize = HRV_HAMPEL_WINDOW_SIZE,
  nSigma = HRV_HAMPEL_NSIGMA,
): boolean[] {
  const n = rr.length;
  if (n === 0) {
    return [];
  }
  const half = Math.floor(windowSize / 2);
  const out = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const win = rr.slice(lo, hi);
    const med = median(win);
    const absDev = win.map((x) => Math.abs(x - med));
    const mad = median(absDev);
    const thr = nSigma * HAMPEL_MAD_SCALE * mad;
    if (Math.abs(rr[i] - med) > thr) {
      out[i] = true;
    }
  }
  return out;
}

function preparePracticeRr(rr: readonly number[]): number[] {
  if (rr.length === 0) {
    return [];
  }
  return hampelFilterRrIntervals(rr, HRV_HAMPEL_WINDOW_SIZE, HRV_HAMPEL_NSIGMA);
}

/** RR между соседними ударами в окне [startBeatIdx, endBeatExclusive) после жёсткого фильтра длительности. */
function collectRrFromBeatWindow(
  beatMs: readonly number[],
  startBeatIdx: number,
  endBeatExclusive: number,
): number[] {
  const rr: number[] = [];
  const start = Math.max(0, startBeatIdx);
  const end = Math.min(endBeatExclusive, beatMs.length);
  for (let i = start; i < end - 1; i += 1) {
    const d = beatMs[i + 1] - beatMs[i];
    if (d >= HRV_RR_HARD_MIN_MS && d <= HRV_RR_HARD_MAX_MS) {
      rr.push(d);
    }
  }
  return rr;
}

function collectRrFromBeatPrefixBeats(beatMs: readonly number[], prefixBeatCount: number): number[] {
  return collectRrFromBeatWindow(beatMs, 0, Math.min(prefixBeatCount, beatMs.length));
}

function collectRrFromBeatTailBeats(beatMs: readonly number[], tailBeatCount: number): number[] {
  const n = beatMs.length;
  if (n < 2 || tailBeatCount < 2) {
    return [];
  }
  const start = Math.max(0, n - tailBeatCount);
  return collectRrFromBeatWindow(beatMs, start, n);
}

export function toRrIntervalsMs(beatTimestampsMs: readonly number[]) {
  const rrIntervals: number[] = [];
  for (let index = 1; index < beatTimestampsMs.length; index += 1) {
    const interval = beatTimestampsMs[index] - beatTimestampsMs[index - 1];
    if (interval > 0) {
      rrIntervals.push(interval);
    }
  }
  return rrIntervals;
}

export function calculatePulseRateBpm(rrIntervalsMs: readonly number[]) {
  if (rrIntervalsMs.length === 0) {
    return 0;
  }

  if (rrIntervalsMs.length < 4) {
    const averageInterval = mean(rrIntervalsMs);
    return averageInterval > 0 ? 60000 / averageInterval : 0;
  }

  const medianInterval = median(rrIntervalsMs);
  const filtered = rrIntervalsMs.filter((intervalMs) => Math.abs(intervalMs - medianInterval) <= medianInterval * 0.18);
  const averageInterval = mean(filtered.length >= 3 ? filtered : rrIntervalsMs);
  if (averageInterval <= 0) {
    return 0;
  }

  return 60000 / averageInterval;
}

export function calculatePulseRateBpmMedian(rrIntervalsMs: readonly number[]) {
  if (rrIntervalsMs.length === 0) {
    return 0;
  }

  const medianInterval = median(rrIntervalsMs);
  return medianInterval > 0 ? 60000 / medianInterval : 0;
}

export function calculateRmssdMs(rrIntervalsMs: readonly number[]) {
  if (rrIntervalsMs.length < 2) {
    return 0;
  }

  const squaredDiffs: number[] = [];
  for (let index = 1; index < rrIntervalsMs.length; index += 1) {
    const diff = rrIntervalsMs[index] - rrIntervalsMs[index - 1];
    squaredDiffs.push(diff * diff);
  }

  return Math.sqrt(mean(squaredDiffs));
}

export function calculateRmssdMsTrimmed(rrIntervalsMs: readonly number[], trimRatio = 0.12) {
  if (rrIntervalsMs.length < 3) {
    return calculateRmssdMs(rrIntervalsMs);
  }

  const squaredDiffs: number[] = [];
  for (let index = 1; index < rrIntervalsMs.length; index += 1) {
    const diff = rrIntervalsMs[index] - rrIntervalsMs[index - 1];
    squaredDiffs.push(diff * diff);
  }

  const sorted = [...squaredDiffs].sort((left, right) => left - right);
  const trimCount = Math.min(
    Math.floor(sorted.length * trimRatio),
    Math.floor((sorted.length - 1) / 2),
  );
  const trimmed =
    trimCount <= 0 ? sorted : sorted.slice(trimCount, sorted.length - trimCount);
  if (trimmed.length === 0) {
    return Math.sqrt(mean(squaredDiffs));
  }

  return Math.sqrt(mean(trimmed));
}

export function calculateRmssdMsRobust(
  rrIntervalsMs: readonly number[],
  options?: {
    trimRatio?: number;
    artifactRatio?: number;
    artifactFloorMs?: number;
  },
) {
  if (rrIntervalsMs.length < 3) {
    return calculateRmssdMs(rrIntervalsMs);
  }

  const trimRatio = options?.trimRatio ?? 0.08;
  const artifactRatio = options?.artifactRatio ?? 0.22;
  const artifactFloorMs = options?.artifactFloorMs ?? 120;
  const medianIntervalMs = [...rrIntervalsMs].sort((left, right) => left - right)[Math.floor(rrIntervalsMs.length / 2)];
  const maxAllowedDiffMs = Math.max(artifactFloorMs, medianIntervalMs * artifactRatio);

  const squaredDiffs: number[] = [];
  for (let index = 1; index < rrIntervalsMs.length; index += 1) {
    const diff = rrIntervalsMs[index] - rrIntervalsMs[index - 1];
    if (Math.abs(diff) <= maxAllowedDiffMs) {
      squaredDiffs.push(diff * diff);
    }
  }

  if (squaredDiffs.length < 2) {
    return calculateRmssdMsTrimmed(rrIntervalsMs, trimRatio);
  }

  const sorted = [...squaredDiffs].sort((left, right) => left - right);
  const trimCount = Math.min(
    Math.floor(sorted.length * trimRatio),
    Math.floor((sorted.length - 1) / 2),
  );
  const trimmed =
    trimCount <= 0 ? sorted : sorted.slice(trimCount, sorted.length - trimCount);

  return Math.sqrt(mean(trimmed));
}

/**
 * Мода по «мягкой» гистограмме: каждый RR делит вес 1.0 между двумя соседними бакетами (шаг bucketSizeMs),
 * чтобы значения у границ бакетов не перекидывали моду между соседними 50 ms.
 */
function buildModeBucketSoft(rrIntervalsMs: readonly number[], bucketSizeMs: number) {
  const histogram = new Map<number, number>();

  for (const interval of rrIntervalsMs) {
    const lo = Math.floor(interval / bucketSizeMs) * bucketSizeMs;
    const hi = lo + bucketSizeMs;
    const t = (interval - lo) / bucketSizeMs;
    histogram.set(lo, (histogram.get(lo) ?? 0) + (1 - t));
    histogram.set(hi, (histogram.get(hi) ?? 0) + t);
  }

  let modeBucketMs = 0;
  let modeWeight = 0;
  for (const [bucketMs, weight] of histogram.entries()) {
    if (weight > modeWeight || (weight === modeWeight && bucketMs > modeBucketMs)) {
      modeBucketMs = bucketMs;
      modeWeight = weight;
    }
  }

  return { modeBucketMs, modeWeight };
}

/** RMSSD по правилу: исключаем пары соседних RR, если любой из трёх ударов B_i…B_{i+2} помечен как невалидный для HRV (экстраполяция / holding). */
export function calculateRmssdMsWithBeatEligibility(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
): number {
  const n = beatTimestampsMs.length;
  if (n < 3) {
    return 0;
  }

  const squaredDiffs: number[] = [];
  for (let i = 0; i < n - 2; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1] || !beatEligible[i + 2]) {
      continue;
    }
    const rr0 = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    const rr1 = beatTimestampsMs[i + 2] - beatTimestampsMs[i + 1];
    if (rr0 <= 0 || rr1 <= 0) {
      continue;
    }
    const diff = rr1 - rr0;
    squaredDiffs.push(diff * diff);
  }

  if (squaredDiffs.length === 0) {
    return 0;
  }

  return Math.sqrt(mean(squaredDiffs));
}

/** То же правило окна: учитываем только тройки ударов, попадающие в скользящее окно по времени последнего удара. */
export function calculateRmssdMsWithBeatEligibilityWindowed(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  nowTimestampMs: number,
  windowMs: number,
): number {
  const cutoff = nowTimestampMs - windowMs;
  const n = beatTimestampsMs.length;
  if (n < 3) {
    return 0;
  }

  const squaredDiffs: number[] = [];
  for (let i = 0; i < n - 2; i += 1) {
    const b2 = beatTimestampsMs[i + 2];
    if (b2 < cutoff) {
      continue;
    }
    if (!beatEligible[i] || !beatEligible[i + 1] || !beatEligible[i + 2]) {
      continue;
    }
    const rr0 = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    const rr1 = beatTimestampsMs[i + 2] - beatTimestampsMs[i + 1];
    if (rr0 <= 0 || rr1 <= 0) {
      continue;
    }
    const diff = rr1 - rr0;
    squaredDiffs.push(diff * diff);
  }

  if (squaredDiffs.length === 0) {
    return 0;
  }

  return Math.sqrt(mean(squaredDiffs));
}

export function countHrvEligibleBeats(beatEligible: readonly boolean[]): number {
  let count = 0;
  for (const ok of beatEligible) {
    if (ok) {
      count += 1;
    }
  }
  return count;
}

export type HrvMetricsUpdateInput = {
  beatTimestampsMs: readonly number[];
  beatEligible: readonly boolean[];
  nowTimestampMs: number;
  slidingWindowMs: number;
  signalQuality: number;
  minQuality: number;
  minDisplayEligibleBeats: number;
  minFullEligibleBeats: number;
};

export type HrvMetricsUpdateResult = {
  eligibleBeatCount: number;
  eligibleRrForStress: number[];
  rmssdSlidingMs: number;
  rmssdFullSessionMs: number;
  stressRaw: number;
  stressPercent: number;
  rmssdReady: boolean;
  stressReady: boolean;
  useFullWindow: boolean;
};

/**
 * Единая точка для RMSSD и индекса Баевского: одни и те же отборы интервалов и один порог готовности.
 * До minDisplayEligibleBeats показываем только счётчик (см. UI).
 *
 * **Не вызывается** текущим пайплайном палец/камера (`FingerSignalAnalyzer` использует `computePracticeHrvMetrics`).
 * Оставлено для экспериментов, тестов или альтернативных источников RR.
 */
export function updateHrvMetrics(input: HrvMetricsUpdateInput): HrvMetricsUpdateResult {
  const {
    beatTimestampsMs,
    beatEligible,
    nowTimestampMs,
    slidingWindowMs,
    signalQuality,
    minQuality,
    minDisplayEligibleBeats,
    minFullEligibleBeats,
  } = input;

  const eligibleBeatCount = countHrvEligibleBeats(beatEligible);

  const eligibleRrSlidingForStress: number[] = [];
  for (let i = 0; i < beatTimestampsMs.length - 1; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1]) {
      continue;
    }
    const end = beatTimestampsMs[i + 1];
    if (end < nowTimestampMs - slidingWindowMs) {
      continue;
    }
    const rr = end - beatTimestampsMs[i];
    if (rr > 0) {
      eligibleRrSlidingForStress.push(rr);
    }
  }

  const eligibleRrFullSessionForStress: number[] = [];
  for (let i = 0; i < beatTimestampsMs.length - 1; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1]) {
      continue;
    }
    const rr = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    if (rr > 0) {
      eligibleRrFullSessionForStress.push(rr);
    }
  }

  const rmssdSlidingMs = calculateRmssdMsWithBeatEligibilityWindowed(
    beatTimestampsMs,
    beatEligible,
    nowTimestampMs,
    slidingWindowMs,
  );

  const rmssdFullSessionMs = calculateRmssdMsWithBeatEligibility(beatTimestampsMs, beatEligible);

  const qualityOk = signalQuality >= minQuality;
  const useFullWindow = eligibleBeatCount >= minFullEligibleBeats;
  const stressRrSource = useFullWindow ? eligibleRrFullSessionForStress : eligibleRrSlidingForStress;
  const stressRaw =
    stressRrSource.length >= 3 ? calculateBaevskyStressIndexRaw(stressRrSource) : 0;
  const stressPercent = mapBaevskyStressToPercent(stressRaw);

  const readyBase = qualityOk && eligibleBeatCount >= minDisplayEligibleBeats;

  return {
    eligibleBeatCount,
    eligibleRrForStress: stressRrSource,
    rmssdSlidingMs,
    rmssdFullSessionMs,
    stressRaw,
    stressPercent,
    rmssdReady: readyBase,
    stressReady: readyBase,
    useFullWindow,
  };
}

/** Порядковый номер валидного удара; startMs > 0 — считать только удары практики (после калибровки). */
export function buildEligibleOrdinalSinceStart(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  practiceStartMs: number,
): number[] {
  const ord: number[] = [];
  let c = 0;
  for (let i = 0; i < beatEligible.length; i += 1) {
    if (beatEligible[i] && (practiceStartMs <= 0 || beatTimestampsMs[i] >= practiceStartMs - 1)) {
      ord[i] = c;
      c += 1;
    } else {
      ord[i] = -1;
    }
  }
  return ord;
}

export function countEligibleBeatsSinceStart(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  practiceStartMs: number,
): number {
  let c = 0;
  for (let i = 0; i < beatEligible.length; i += 1) {
    if (beatEligible[i] && beatTimestampsMs[i] >= practiceStartMs - 1) {
      c += 1;
    }
  }
  return c;
}

/** RMSSD по правилу троек; учитываются только тройки, у которых третий удар среди первых maxOrdinalExclusive валидных. */
export function calculateRmssdMsWithBeatEligibilityOrdinalPrefix(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  maxOrdinalExclusive: number,
  practiceStartMs = 0,
): number {
  const n = beatTimestampsMs.length;
  if (n < 3 || maxOrdinalExclusive < 3) {
    return 0;
  }
  const ord = buildEligibleOrdinalSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  const squaredDiffs: number[] = [];
  for (let i = 0; i < n - 2; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1] || !beatEligible[i + 2]) {
      continue;
    }
    if (ord[i] < 0 || ord[i + 1] < 0 || ord[i + 2] < 0) {
      continue;
    }
    if (ord[i + 2] >= maxOrdinalExclusive) {
      continue;
    }
    const rr0 = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    const rr1 = beatTimestampsMs[i + 2] - beatTimestampsMs[i + 1];
    if (rr0 <= 0 || rr1 <= 0) {
      continue;
    }
    if (!rrPairOkForRmssd(rr0, rr1)) {
      continue;
    }
    const diff = rr1 - rr0;
    squaredDiffs.push(diff * diff);
  }
  if (squaredDiffs.length === 0) {
    return 0;
  }
  return Math.sqrt(mean(squaredDiffs));
}

/** Тройки, у которых все три удара входят в хвост последних tailCount валидных ударов. */
export function calculateRmssdMsWithBeatEligibilityOrdinalTail(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  tailCount: number,
  practiceStartMs = 0,
): number {
  const totalEligible = countEligibleBeatsSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  const n = beatTimestampsMs.length;
  if (n < 3 || tailCount < 3 || totalEligible < tailCount) {
    return 0;
  }
  const minOrd = totalEligible - tailCount;
  const maxOrdFirst = totalEligible - 3;
  const ord = buildEligibleOrdinalSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  const squaredDiffs: number[] = [];
  for (let i = 0; i < n - 2; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1] || !beatEligible[i + 2]) {
      continue;
    }
    if (ord[i] < 0 || ord[i + 1] < 0 || ord[i + 2] < 0) {
      continue;
    }
    if (ord[i] < minOrd || ord[i] > maxOrdFirst) {
      continue;
    }
    if (ord[i + 2] > totalEligible - 1) {
      continue;
    }
    const rr0 = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    const rr1 = beatTimestampsMs[i + 2] - beatTimestampsMs[i + 1];
    if (rr0 <= 0 || rr1 <= 0) {
      continue;
    }
    if (!rrPairOkForRmssd(rr0, rr1)) {
      continue;
    }
    const diff = rr1 - rr0;
    squaredDiffs.push(diff * diff);
  }
  if (squaredDiffs.length === 0) {
    return 0;
  }
  return Math.sqrt(mean(squaredDiffs));
}

export type PracticeHrvMetricsResult = {
  tier: HrvPracticeTier;
  /** Сколько валидных ударов в накопителе hrvValidBeats (не длина merged). */
  validBeatCount: number;
  showRmssd: boolean;
  showStress: boolean;
  rmssdApproximate: boolean;
  stressApproximate: boolean;
  showInitialFinal: boolean;
  rmssdMs: number;
  stressPercent: number;
  stressRaw: number;
  initialRmssdMs: number;
  initialStressPercent: number;
  initialStressRaw: number;
  finalRmssdMs: number;
  finalStressPercent: number;
  finalStressRaw: number;
};

/**
 * Метрики практики по всему ряду валидных ударов — RMSSD и Баевский считаются по **полной**
 * серии практики, без разделения на «начальный» и «финальный» сегменты.
 *
 * Пользовательский запрос (апрель 2026): «для практик дыхания RMSSD и индекс стресса должны
 * рассчитываться по данным всей практики, усредняясь как и остальные показатели». Было:
 * initial (первые 90 ударов) + final (последние 60/90 ударов). Стало: весь ряд как единый
 * сегмент с блочной медианой RMSSD (устойчивой к выбросам) и Баевским по всему ряду
 * (Хампель + импутация медианой).
 *
 * Тир определяется по числу валидных ударов: < 30 → `none`, иначе — по нижнему порогу
 * (для UI-информации и апроксимации).
 */
export function computePracticeHrvMetricsFullSession(
  hrvValidBeatTimestampsMs: readonly number[],
): PracticeHrvMetricsResult {
  const nBeat = hrvValidBeatTimestampsMs.length;
  const zero: PracticeHrvMetricsResult = {
    tier: "none",
    validBeatCount: nBeat,
    showRmssd: false,
    showStress: false,
    rmssdApproximate: false,
    stressApproximate: false,
    showInitialFinal: false,
    rmssdMs: 0,
    stressPercent: 0,
    stressRaw: 0,
    initialRmssdMs: 0,
    initialStressPercent: 0,
    initialStressRaw: 0,
    finalRmssdMs: 0,
    finalStressPercent: 0,
    finalStressRaw: 0,
  };

  if (nBeat < HRV_MIN_VALID_BEATS_FOR_METRICS) {
    return zero;
  }

  const rrRaw = collectRrFromBeatWindow(hrvValidBeatTimestampsMs, 0, nBeat);
  if (rrRaw.length < 2) {
    return zero;
  }
  const rrBaevsky = preparePracticeRr(rrRaw);
  const hampelMask = hampelOutlierFlags(rrRaw);

  // Разбиваем весь ряд на блоки ~30 RR для медианного RMSSD (устойчиво к локальным артефактам).
  const blockCount = Math.max(1, Math.min(6, Math.floor(rrRaw.length / 30)));
  const rmssdMs = rmssdSegmentMasked(rrRaw, blockCount, hampelMask);
  const stressRaw = stressSegmentRaw(rrBaevsky, blockCount);
  const stressPercent = mapBaevskyStressToPercent(stressRaw);

  let tier: HrvPracticeTier = "beats_30_59";
  if (nBeat >= 180) tier = "beats_180_plus";
  else if (nBeat >= 120) tier = "beats_120_179";
  else if (nBeat >= 90) tier = "beats_90_119";
  else if (nBeat >= 60) tier = "beats_60_89";

  const approximate = nBeat < 90;

  return {
    tier,
    validBeatCount: nBeat,
    showRmssd: true,
    showStress: nBeat >= 60,
    rmssdApproximate: approximate,
    stressApproximate: approximate,
    showInitialFinal: false,
    rmssdMs,
    stressPercent: nBeat >= 60 ? stressPercent : 0,
    stressRaw: nBeat >= 60 ? stressRaw : 0,
    initialRmssdMs: 0,
    initialStressPercent: 0,
    initialStressRaw: 0,
    finalRmssdMs: rmssdMs,
    finalStressPercent: nBeat >= 60 ? stressPercent : 0,
    finalStressRaw: nBeat >= 60 ? stressRaw : 0,
  };
}

/**
 * Старая версия «initial + final» сегментация — оставлена для внешних интеграций / тестов.
 * Для активной практики дыхания используется {@link computePracticeHrvMetricsFullSession}.
 */
export function computePracticeHrvMetrics(
  hrvValidBeatTimestampsMs: readonly number[],
): PracticeHrvMetricsResult {
  const nBeat = hrvValidBeatTimestampsMs.length;
  const beatMs = hrvValidBeatTimestampsMs;
  const zero: PracticeHrvMetricsResult = {
    tier: "none",
    validBeatCount: nBeat,
    showRmssd: false,
    showStress: false,
    rmssdApproximate: false,
    stressApproximate: false,
    showInitialFinal: false,
    rmssdMs: 0,
    stressPercent: 0,
    stressRaw: 0,
    initialRmssdMs: 0,
    initialStressPercent: 0,
    initialStressRaw: 0,
    finalRmssdMs: 0,
    finalStressPercent: 0,
    finalStressRaw: 0,
  };

  if (nBeat < HRV_MIN_VALID_BEATS_FOR_METRICS) {
    return zero;
  }

  if (nBeat <= 59) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, nBeat);
    const out = hampelOutlierFlags(rrRaw);
    const rmssdMs = rmssdSegmentMasked(rrRaw, 1, out);
    return {
      tier: "beats_30_59",
      validBeatCount: nBeat,
      showRmssd: true,
      showStress: false,
      rmssdApproximate: false,
      stressApproximate: false,
      showInitialFinal: false,
      rmssdMs,
      stressPercent: 0,
      stressRaw: 0,
      initialRmssdMs: 0,
      initialStressPercent: 0,
      initialStressRaw: 0,
      finalRmssdMs: 0,
      finalStressPercent: 0,
      finalStressRaw: 0,
    };
  }

  if (nBeat <= 89) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, nBeat);
    const rrBaevsky = preparePracticeRr(rrRaw);
    const out = hampelOutlierFlags(rrRaw);
    const rmssdMs = rmssdSegmentMasked(rrRaw, 2, out);
    const stressRaw = stressSegmentRaw(rrBaevsky, 2);
    return {
      tier: "beats_60_89",
      validBeatCount: nBeat,
      showRmssd: true,
      showStress: true,
      rmssdApproximate: true,
      stressApproximate: true,
      showInitialFinal: false,
      rmssdMs,
      stressPercent: mapBaevskyStressToPercent(stressRaw),
      stressRaw,
      initialRmssdMs: 0,
      initialStressPercent: 0,
      initialStressRaw: 0,
      finalRmssdMs: 0,
      finalStressPercent: 0,
      finalStressRaw: 0,
    };
  }

  if (nBeat <= 119) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
    const rrBaevsky = preparePracticeRr(rrRaw);
    const out = hampelOutlierFlags(rrRaw);
    const rmssdMs = rmssdSegmentMasked(rrRaw, 3, out);
    const stressRaw = stressSegmentRaw(rrBaevsky, 3);
    return {
      tier: "beats_90_119",
      validBeatCount: nBeat,
      showRmssd: true,
      showStress: true,
      rmssdApproximate: false,
      stressApproximate: false,
      showInitialFinal: false,
      rmssdMs,
      stressPercent: mapBaevskyStressToPercent(stressRaw),
      stressRaw,
      initialRmssdMs: 0,
      initialStressPercent: 0,
      initialStressRaw: 0,
      finalRmssdMs: 0,
      finalStressPercent: 0,
      finalStressRaw: 0,
    };
  }

  if (nBeat <= 179) {
    const rrInitialRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
    const rrInitialBaevsky = preparePracticeRr(rrInitialRaw);
    const outInitial = hampelOutlierFlags(rrInitialRaw);
    const initialRmssdMs = rmssdSegmentMasked(rrInitialRaw, 3, outInitial);
    const stressRawInitial = stressSegmentRaw(rrInitialBaevsky, 3);

    const rrFinalRaw = collectRrFromBeatTailBeats(beatMs, HRV_TAIL_BEATS_FINAL_MID);
    const rrFinalBaevsky = preparePracticeRr(rrFinalRaw);
    const outFinal = hampelOutlierFlags(rrFinalRaw);
    const finalRmssdMs = rmssdSegmentMasked(rrFinalRaw, 2, outFinal);
    const stressRawFinal = stressSegmentRaw(rrFinalBaevsky, 2);

    return {
      tier: "beats_120_179",
      validBeatCount: nBeat,
      showRmssd: true,
      showStress: true,
      rmssdApproximate: true,
      stressApproximate: true,
      showInitialFinal: true,
      rmssdMs: finalRmssdMs,
      stressPercent: mapBaevskyStressToPercent(stressRawFinal),
      stressRaw: stressRawFinal,
      initialRmssdMs,
      initialStressPercent: mapBaevskyStressToPercent(stressRawInitial),
      initialStressRaw: stressRawInitial,
      finalRmssdMs,
      finalStressPercent: mapBaevskyStressToPercent(stressRawFinal),
      finalStressRaw: stressRawFinal,
    };
  }

  const rrInitialRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
  const rrInitialBaevsky = preparePracticeRr(rrInitialRaw);
  const outInitial = hampelOutlierFlags(rrInitialRaw);
  const initialRmssdMs = rmssdSegmentMasked(rrInitialRaw, 3, outInitial);
  const stressRawInitial = stressSegmentRaw(rrInitialBaevsky, 3);

  const rrFinalRaw = collectRrFromBeatTailBeats(beatMs, HRV_TAIL_BEATS_FINAL_LONG);
  const rrFinalBaevsky = preparePracticeRr(rrFinalRaw);
  const outFinal = hampelOutlierFlags(rrFinalRaw);
  const finalRmssdMs = rmssdSegmentMasked(rrFinalRaw, 3, outFinal);
  const stressRawFinal = stressSegmentRaw(rrFinalBaevsky, 3);

  return {
    tier: "beats_180_plus",
    validBeatCount: nBeat,
    showRmssd: true,
    showStress: true,
    rmssdApproximate: false,
    stressApproximate: false,
    showInitialFinal: true,
    rmssdMs: finalRmssdMs,
    stressPercent: mapBaevskyStressToPercent(stressRawFinal),
    stressRaw: stressRawFinal,
    initialRmssdMs,
    initialStressPercent: mapBaevskyStressToPercent(stressRawInitial),
    initialStressRaw: stressRawInitial,
    finalRmssdMs,
    finalStressPercent: mapBaevskyStressToPercent(stressRawFinal),
    finalStressRaw: stressRawFinal,
  };
}

export type PracticeRmssdHampelSegmentDiag = {
  label: string;
  blockCount: number;
  rrMsHardFilterOnly: number[];
  /** Ряд после Хампеля с подменой выбросов медианой — тот же, что для Баевского. */
  rrMsAfterHampel: number[];
  /** `true` — интервал помечен выбросом; в RMSSD пайплайна не подставляется медиана, вклад в разности исключается. */
  hampelOutlierMask: boolean[];
  rmssdClassicNoHampelMs: number;
  rmssdPipelineMs: number;
  /** `null`, если классика 0 — долю не считаем. */
  diffPipelineVsClassicPercent: number | null;
};

export type PracticeRmssdHampelDiagnostics = {
  schemaVersion: 2;
  exportedAtMs: number;
  validBeatCount: number;
  tier: HrvPracticeTier;
  hampelWindowSize: number;
  hampelNSigma: number;
  description: string;
  /** Тот же сегмент, что и поле `rmssdMs` в `computePracticeHrvMetrics` (для 120+ — финальный хвост). */
  primaryForRmssdField: PracticeRmssdHampelSegmentDiag;
  /** Только при тирах с начало/конец — начальный сегмент (первые 90 ударов). */
  initialSegment?: PracticeRmssdHampelSegmentDiag;
  /** `cached` — снимок после сброса накопителя/«нового замера», пока нет свежего расчёта. */
  exportSource?: "live" | "cached";
};

function pipelineVsClassicDiffPercent(classic: number, pipeline: number): number | null {
  if (classic <= 0 || !Number.isFinite(classic)) {
    return null;
  }
  return (Math.abs(pipeline - classic) / classic) * 100;
}

function packRmssdSegmentDiag(
  label: string,
  rrRaw: readonly number[],
  blockCount: number,
): PracticeRmssdHampelSegmentDiag {
  const afterImputed = preparePracticeRr(rrRaw);
  const outlier = hampelOutlierFlags(rrRaw);
  const classic = computeRmssdStandardFromRrIntervals(rrRaw);
  const pipeline = rmssdSegmentMasked(rrRaw, blockCount, outlier);
  return {
    label,
    blockCount,
    rrMsHardFilterOnly: [...rrRaw],
    rrMsAfterHampel: [...afterImputed],
    hampelOutlierMask: [...outlier],
    rmssdClassicNoHampelMs: classic,
    rmssdPipelineMs: pipeline,
    diffPipelineVsClassicPercent: pipelineVsClassicDiffPercent(classic, pipeline),
  };
}

/**
 * Сравнение «классического» RMSSD (только жёсткий фильтр RR) с пайплайном практики (исключение выбросов Хампеля из RMSSD + trimmed + блоки).
 * RR берутся из полного накопителя `hrvValidBeatTimestampsMs` (как в `computePracticeHrvMetrics`).
 */
export function computePracticeRmssdHampelDiagnostics(
  hrvValidBeatTimestampsMs: readonly number[],
): PracticeRmssdHampelDiagnostics | null {
  const nBeat = hrvValidBeatTimestampsMs.length;
  if (nBeat < HRV_MIN_VALID_BEATS_FOR_METRICS) {
    return null;
  }

  const beatMs = hrvValidBeatTimestampsMs;
  const description =
    "schemaVersion 2: rmssdClassicNoHampelMs — по RR 300–2000 ms без Хампеля; rmssdPipelineMs — как в computePracticeHrvMetrics: выбросы Хампеля исключены из суммы разностей (не подмена медианой), затем trimmed и медиана блоков; Баевский по-прежнему на ряду с подменой медианой.";

  if (nBeat <= 59) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, nBeat);
    return {
      schemaVersion: 2,
      exportedAtMs: Date.now(),
      validBeatCount: nBeat,
      tier: "beats_30_59",
      hampelWindowSize: HRV_HAMPEL_WINDOW_SIZE,
      hampelNSigma: HRV_HAMPEL_NSIGMA,
      description,
      primaryForRmssdField: packRmssdSegmentDiag("prefix_all_beats", rrRaw, 1),
    };
  }

  if (nBeat <= 89) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, nBeat);
    return {
      schemaVersion: 2,
      exportedAtMs: Date.now(),
      validBeatCount: nBeat,
      tier: "beats_60_89",
      hampelWindowSize: HRV_HAMPEL_WINDOW_SIZE,
      hampelNSigma: HRV_HAMPEL_NSIGMA,
      description,
      primaryForRmssdField: packRmssdSegmentDiag("prefix_all_beats", rrRaw, 2),
    };
  }

  if (nBeat <= 119) {
    const rrRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
    return {
      schemaVersion: 2,
      exportedAtMs: Date.now(),
      validBeatCount: nBeat,
      tier: "beats_90_119",
      hampelWindowSize: HRV_HAMPEL_WINDOW_SIZE,
      hampelNSigma: HRV_HAMPEL_NSIGMA,
      description,
      primaryForRmssdField: packRmssdSegmentDiag("prefix_first_90_beats", rrRaw, 3),
    };
  }

  if (nBeat <= 179) {
    const rrInitialRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
    const rrFinalRaw = collectRrFromBeatTailBeats(beatMs, HRV_TAIL_BEATS_FINAL_MID);
    return {
      schemaVersion: 2,
      exportedAtMs: Date.now(),
      validBeatCount: nBeat,
      tier: "beats_120_179",
      hampelWindowSize: HRV_HAMPEL_WINDOW_SIZE,
      hampelNSigma: HRV_HAMPEL_NSIGMA,
      description,
      primaryForRmssdField: packRmssdSegmentDiag("tail_last_60_beats_final_display", rrFinalRaw, 2),
      initialSegment: packRmssdSegmentDiag("prefix_first_90_beats_initial", rrInitialRaw, 3),
    };
  }

  const rrInitialRaw = collectRrFromBeatPrefixBeats(beatMs, HRV_PREFIX_BEATS_FOR_SEGMENT);
  const rrFinalRaw = collectRrFromBeatTailBeats(beatMs, HRV_TAIL_BEATS_FINAL_LONG);
  return {
    schemaVersion: 2,
    exportedAtMs: Date.now(),
    validBeatCount: nBeat,
    tier: "beats_180_plus",
    hampelWindowSize: HRV_HAMPEL_WINDOW_SIZE,
    hampelNSigma: HRV_HAMPEL_NSIGMA,
    description,
    primaryForRmssdField: packRmssdSegmentDiag("tail_last_90_beats_final_display", rrFinalRaw, 3),
    initialSegment: packRmssdSegmentDiag("prefix_first_90_beats_initial", rrInitialRaw, 3),
  };
}

export function calculateBaevskyStressIndexRaw(
  rrIntervalsMs: readonly number[],
  bucketSizeMs = 50,
) {
  if (rrIntervalsMs.length < 3) {
    return 0;
  }

  const { modeBucketMs, modeWeight } = buildModeBucketSoft(rrIntervalsMs, bucketSizeMs);
  const modeSeconds = modeBucketMs / 1000;
  const amplitudePercent = (modeWeight / rrIntervalsMs.length) * 100;
  const minInterval = Math.min(...rrIntervalsMs);
  const maxInterval = Math.max(...rrIntervalsMs);
  const variationRangeSeconds = Math.max(0.05, (maxInterval - minInterval) / 1000);

  if (modeSeconds <= 0) {
    return 0;
  }

  return amplitudePercent / (2 * modeSeconds * variationRangeSeconds);
}

/**
 * Нормировка сырого индекса Баевского в 0–100.
 * Делитель больше 180 → мягче кривая (меньше «залипание» у 90+ на узком RR PPG — не баг, а шкала).
 */
export const BAEVSKY_STRESS_PERCENT_DIVISOR = 220;

export function mapBaevskyStressToPercent(rawStressIndex: number) {
  if (rawStressIndex <= 0) {
    return 0;
  }
  return clamp(100 * (1 - Math.exp(-rawStressIndex / BAEVSKY_STRESS_PERCENT_DIVISOR)), 0, 100);
}

export function normalizePulseRate(pulseRateBpm: number) {
  return clamp((pulseRateBpm - 40) / (180 - 40), 0, 1);
}

export function normalizeBreathRate(breathRateBpm: number) {
  return clamp((breathRateBpm - 5) / (30 - 5), 0, 1);
}

export function normalizeRmssd(rmssdMs: number) {
  return clamp((rmssdMs - 20) / (200 - 20), 0, 1);
}

export function normalizeStressIndex(stressIndex: number) {
  return clamp(stressIndex / 100, 0, 1);
}
