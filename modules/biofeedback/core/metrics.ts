import type { HrvPracticeTier } from "@/modules/biofeedback/core/types";
import {
  HRV_MIN_VALID_BEATS_FOR_METRICS,
  HRV_PREFIX_BEATS_FOR_SEGMENT,
  HRV_RR_HARD_MAX_MS,
  HRV_RR_HARD_MIN_MS,
  HRV_TAIL_BEATS_FINAL_LONG,
  HRV_TAIL_BEATS_FINAL_MID,
} from "@/modules/biofeedback/core/hrv-practice-constants";

const HAMPEL_WINDOW_SIZE = 13;
const HAMPEL_NSIGMA = 3;
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

/** Практика: верхняя граница правдоподобного сегментного RMSSD (камера/хвост при снятии пальца). */
const HRV_PRACTICE_RMSSD_TRIM = 0.12;
const HRV_PRACTICE_RMSSD_ABS_MAX_MS = 160;

function medianBlockRmssd(rr: readonly number[], blockCount: number): number {
  if (rr.length < 2 || blockCount <= 0) {
    return 0;
  }
  if (blockCount === 1) {
    return computeRmssdStandardFromRrIntervalsTrimmed(rr, HRV_PRACTICE_RMSSD_TRIM);
  }
  const chunks = splitIntoEqualChunks(rr, blockCount);
  const vals = chunks
    .map((ch) => computeRmssdStandardFromRrIntervalsTrimmed(ch, HRV_PRACTICE_RMSSD_TRIM))
    .filter((v) => v > 0);
  return vals.length === 0 ? 0 : median(vals);
}

/** RMSSD по сегменту RR: медиана по блокам (trimmed), при нуле — по всему ряду; потолок против артефактов хвоста. */
function rmssdSegment(rr: readonly number[], blockCount: number): number {
  if (rr.length < 2) {
    return 0;
  }
  let v = medianBlockRmssd(rr, blockCount);
  if (v <= 0) {
    v = computeRmssdStandardFromRrIntervalsTrimmed(rr, HRV_PRACTICE_RMSSD_TRIM);
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
  windowSize = HAMPEL_WINDOW_SIZE,
  nSigma = HAMPEL_NSIGMA,
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

function preparePracticeRr(rr: readonly number[]): number[] {
  if (rr.length === 0) {
    return [];
  }
  return hampelFilterRrIntervals(rr, HAMPEL_WINDOW_SIZE, HAMPEL_NSIGMA);
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

/** RR между соседними по merged валидными ударами, оба с ordinal < maxOrdinalExclusive. */
function collectEligibleRrOrdinalPrefix(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  maxOrdinalExclusive: number,
  practiceStartMs: number,
): number[] {
  const ord = buildEligibleOrdinalSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  const rr: number[] = [];
  const n = beatTimestampsMs.length;
  for (let i = 0; i < n - 1; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1]) {
      continue;
    }
    if (ord[i] < 0 || ord[i + 1] < 0 || ord[i + 1] >= maxOrdinalExclusive) {
      continue;
    }
    const d = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    if (d >= HRV_RR_HARD_MIN_MS && d <= HRV_RR_HARD_MAX_MS) {
      rr.push(d);
    }
  }
  return rr;
}

/** RR в хвосте: оба удара с ordinal >= totalEligible - tailCount. */
function collectEligibleRrOrdinalTail(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  tailCount: number,
  practiceStartMs: number,
): number[] {
  const totalEligible = countEligibleBeatsSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  if (totalEligible < 2 || tailCount < 2) {
    return [];
  }
  const minOrd = totalEligible - tailCount;
  const ord = buildEligibleOrdinalSinceStart(beatTimestampsMs, beatEligible, practiceStartMs);
  const rr: number[] = [];
  const n = beatTimestampsMs.length;
  for (let i = 0; i < n - 1; i += 1) {
    if (!beatEligible[i] || !beatEligible[i + 1]) {
      continue;
    }
    if (ord[i] < 0 || ord[i] < minOrd) {
      continue;
    }
    if (ord[i + 1] < minOrd || ord[i + 1] > totalEligible - 1) {
      continue;
    }
    const d = beatTimestampsMs[i + 1] - beatTimestampsMs[i];
    if (d >= HRV_RR_HARD_MIN_MS && d <= HRV_RR_HARD_MAX_MS) {
      rr.push(d);
    }
  }
  return rr;
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
 * Метрики практики по числу валидных ударов в накопителе (после калибровки).
 * RR: жёсткий диапазон 300–2000 ms, затем Hampel (окно 13); RMSSD и Баевский по очищенному ряду;
 * агрегаты по блокам — медиана значений по блокам.
 */
export function computePracticeHrvMetrics(
  beatTimestampsMs: readonly number[],
  beatEligible: readonly boolean[],
  hrvValidBeatCount: number,
  practiceStartMs: number,
): PracticeHrvMetricsResult {
  const nBeat = hrvValidBeatCount;
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
    const rr = preparePracticeRr(
      collectEligibleRrOrdinalPrefix(beatTimestampsMs, beatEligible, nBeat, practiceStartMs),
    );
    const rmssdMs = rmssdSegment(rr, 1);
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
    const rr = preparePracticeRr(
      collectEligibleRrOrdinalPrefix(beatTimestampsMs, beatEligible, nBeat, practiceStartMs),
    );
    const rmssdMs = rmssdSegment(rr, 2);
    const stressRaw = stressSegmentRaw(rr, 2);
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
    const rr = preparePracticeRr(
      collectEligibleRrOrdinalPrefix(
        beatTimestampsMs,
        beatEligible,
        HRV_PREFIX_BEATS_FOR_SEGMENT,
        practiceStartMs,
      ),
    );
    const rmssdMs = rmssdSegment(rr, 3);
    const stressRaw = stressSegmentRaw(rr, 3);
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
    const rrInitial = preparePracticeRr(
      collectEligibleRrOrdinalPrefix(
        beatTimestampsMs,
        beatEligible,
        HRV_PREFIX_BEATS_FOR_SEGMENT,
        practiceStartMs,
      ),
    );
    const initialRmssdMs = rmssdSegment(rrInitial, 3);
    const stressRawInitial = stressSegmentRaw(rrInitial, 3);

    const rrFinal = preparePracticeRr(
      collectEligibleRrOrdinalTail(
        beatTimestampsMs,
        beatEligible,
        HRV_TAIL_BEATS_FINAL_MID,
        practiceStartMs,
      ),
    );
    const finalRmssdMs = rmssdSegment(rrFinal, 2);
    const stressRawFinal = stressSegmentRaw(rrFinal, 2);

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

  const rrInitial = preparePracticeRr(
    collectEligibleRrOrdinalPrefix(
      beatTimestampsMs,
      beatEligible,
      HRV_PREFIX_BEATS_FOR_SEGMENT,
      practiceStartMs,
    ),
  );
  const initialRmssdMs = rmssdSegment(rrInitial, 3);
  const stressRawInitial = stressSegmentRaw(rrInitial, 3);

  const rrFinal = preparePracticeRr(
    collectEligibleRrOrdinalTail(
      beatTimestampsMs,
      beatEligible,
      HRV_TAIL_BEATS_FINAL_LONG,
      practiceStartMs,
    ),
  );
  const finalRmssdMs = rmssdSegment(rrFinal, 3);
  const stressRawFinal = stressSegmentRaw(rrFinal, 3);

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

export function mapBaevskyStressToPercent(rawStressIndex: number) {
  if (rawStressIndex <= 0) {
    return 0;
  }
  return clamp(100 * (1 - Math.exp(-rawStressIndex / 180)), 0, 100);
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
