/**
 * PulseBpmEngine: текущий BPM по скользящему окну 10 с.
 *
 * Поведение полностью повторяет старое из `FingerSignalAnalyzer`:
 *  - `buildPulseRrMeasurements`: жёсткий 450..1400 ms + sequential filter (16% от медианы).
 *  - `selectRrWindow` ограничивает окно последними 10 с по `endTimestampMs`.
 *  - При ≥4 RR — медианный BPM (`calculatePulseRateBpmMedian`); иначе обычный
 *    `calculatePulseRateBpm` с фильтром по медиане ±18%.
 *  - Hold-логика (поддержание BPM в `holding` после tracking) — снаружи (на уровне FSM/Bus).
 *
 * Это «UI-friendly» BPM: поверх сырых RR-измерений движок держит короткое display-сглаживание,
 * чтобы на экране QC не было скачков 55 → 86 → 58 при одном неудачном RR.
 * LivePulseChannel остаётся отдельным потоком для beat-sync.
 */

import {
  BEAT_DUPLICATE_TOLERANCE_MS,
  PULSE_RR_DEVIATION_RATIO,
  PULSE_RR_MAX_MS,
  PULSE_RR_MIN_MS,
  PULSE_WINDOW_MS,
  RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
  RR_SEQUENCE_MIN_CONTEXT,
  RR_SEQUENCE_WINDOW_SIZE,
} from "@/modules/biofeedback/constants";
import {
  calculatePulseRateBpm,
  calculatePulseRateBpmMedian,
} from "@/modules/biofeedback/core/metrics";
import { median } from "@/modules/biofeedback/signal/optical-pipeline";

export interface PulseBpmInput {
  timestampMs: number;
  /** Полный отсортированный merged-ряд ударов. */
  mergedBeats: readonly number[];
  sourceKind?: "fingerCamera" | "wearable" | "simulated" | "emulated" | "none";
}

export interface PulseBpmSnapshot {
  /** Текущий средний BPM. 0 если данных мало. */
  bpm: number;
  /** Мгновенный BPM без display-сглаживания. */
  rawBpm: number;
  /** Размер использованного окна (с). */
  windowSeconds: number;
  /** Число RR в окне. */
  rrCount: number;
  /** Медианный RR (мс) — для оценки джиттера. */
  medianRrMs: number;
  /** Джиттер: медиана |RR - medianRR|. */
  jitterMs: number;
  /** Все интервалы окна (для UI / экспорта). */
  intervalsMs: number[];
  /** Соответствует ли окно условию «когерентный пульс» (≥5 RR + jitter в норме). */
  looksCoherent: boolean;
  /** Время последнего использованного удара. */
  lastBeatTimestampMs: number;
  /** Канонический поток ударов после pulse RR filter. */
  filteredBeatTimestampsMs: number[];
  /**
   * True (только для finger PPG) в короткий период после разрыва сигнала, пока не накопится
   * несколько чистых пост-гэп RR. В это время BPM удерживается на прошлом значении и не
   * считается «живым»: первый удар после тишины меряется относительно устаревшего удара и
   * даёт ложный BPM (артефактный скачок вниз/вверх). Wearable RR точны и не гейтятся.
   */
  reacquiring: boolean;
}

/**
 * Интервал между соседними ударами, который трактуется как разрыв сигнала. Заведомо больше
 * `PULSE_RR_MAX_MS` (1400 мс), поэтому сам «перекрывающий» RR уже отброшен hard-фильтром, а мы
 * лишь понимаем, где начался пост-гэп ряд.
 */
const POST_GAP_REACQUIRE_MIN_GAP_MS = 2_500;
/**
 * Сколько чистых пост-гэп RR нужно накопить, прежде чем снова доверять BPM.
 * Первые 1-2 пост-гэп RR часто оказываются артефактно короткими (~822 мс при истинных ~857 мс):
 * zero-phase bandpass звенит на разрыве `dropSamplesSince` (чистая пре-гэп история → скачок DC →
 * новые сэмплы), и пиковый детектор ловит первый пик чуть раньше истинного систолического. При
 * пороге 3 такие короткие RR задавают медиану и дают одиночный «пиковый» BPM (например 73 при
 * реальных 70), который потом резко падает — тот самый «одна точка вверху и летит вниз» на
 * графике. При 5 RR два артефактных интервала перевешиваются тремя истинными, медиана выходит на
 * реальный ритм, и первый опубликованный BPM сразу чистый. Цена — ~1.7 с дополнительного
 * `holding` на быстром восстановлении, что приемлемо относительно собственно серой полосы.
 */
const POST_GAP_MIN_RR = 5;

interface GapResumeBeat {
  resumeTs: number;
  gapMs: number;
}

/** Последний разрыв > minGapMs и первый beat после него (или null, если разрывов нет). */
function findLastGapResumeBeat(
  beats: readonly number[],
  minGapMs: number,
): GapResumeBeat | null {
  for (let i = beats.length - 1; i >= 1; i -= 1) {
    const gapMs = beats[i]! - beats[i - 1]!;
    if (gapMs > minGapMs) {
      return { resumeTs: beats[i]!, gapMs };
    }
  }
  return null;
}

const SHORT_GAP_INTERPOLATION_MISSED_BEATS = 4.5;
const SHORT_GAP_INTERPOLATION_MIN_MS = 2_800;
const SHORT_GAP_INTERPOLATION_MAX_MS = 5_000;

function getMaxInterpolatedGapMs(lastStableMedianRrMs: number): number {
  if (lastStableMedianRrMs <= 0 || !Number.isFinite(lastStableMedianRrMs)) {
    return SHORT_GAP_INTERPOLATION_MIN_MS;
  }
  return Math.min(
    SHORT_GAP_INTERPOLATION_MAX_MS,
    Math.max(
      SHORT_GAP_INTERPOLATION_MIN_MS,
      lastStableMedianRrMs * SHORT_GAP_INTERPOLATION_MISSED_BEATS,
    ),
  );
}

interface RrMeasurement {
  intervalMs: number;
  startTimestampMs: number;
  endTimestampMs: number;
}

export function buildRrMeasurements(beats: readonly number[]): RrMeasurement[] {
  const out: RrMeasurement[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const start = beats[i - 1]!;
    const end = beats[i]!;
    const interval = end - start;
    if (interval > 0) {
      out.push({ intervalMs: interval, startTimestampMs: start, endTimestampMs: end });
    }
  }
  return out;
}

/**
 * Дублирует логику `filterSequentialRrMeasurements` из старого finger-analysis.ts:
 * жёсткий диапазон + последовательный фильтр (после `RR_SEQUENCE_MIN_CONTEXT` принятых,
 * каждый следующий проверяется по медиане окна `RR_SEQUENCE_WINDOW_SIZE`).
 */
export function filterPulseRrMeasurements(
  measurements: readonly RrMeasurement[],
  sourceKind: PulseBpmInput["sourceKind"] = "fingerCamera",
): RrMeasurement[] {
  const accepted: RrMeasurement[] = [];
  const hardMin = sourceKind === "wearable" ? 300 : PULSE_RR_MIN_MS;
  const hardMax = sourceKind === "wearable" ? 2000 : PULSE_RR_MAX_MS;
  const deviationRatio = sourceKind === "wearable" ? 0.22 : PULSE_RR_DEVIATION_RATIO;
  for (const m of measurements) {
    if (m.intervalMs < hardMin || m.intervalMs > hardMax) {
      continue;
    }
    if (accepted.length >= RR_SEQUENCE_MIN_CONTEXT) {
      const recent = accepted.slice(-RR_SEQUENCE_WINDOW_SIZE).map((x) => x.intervalMs);
      const med = median(recent);
      const allowed = Math.max(
        RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
        med * deviationRatio,
      );
      if (Math.abs(m.intervalMs - med) > allowed) {
        continue;
      }
    }
    accepted.push(m);
  }
  return accepted;
}

function selectRecentRrMeasurements(
  measurements: readonly RrMeasurement[],
  nowMs: number,
  windowMs: number,
): RrMeasurement[] {
  const cutoff = nowMs - windowMs;
  const out: RrMeasurement[] = [];
  for (const m of measurements) {
    if (m.endTimestampMs > cutoff) {
      out.push(m);
    }
  }
  return out;
}

export function buildFilteredBeatTimestamps(
  measurements: readonly RrMeasurement[],
): number[] {
  if (measurements.length === 0) return [];
  const beats: number[] = [];
  for (const measurement of measurements) {
    if (beats.length === 0) {
      beats.push(measurement.startTimestampMs, measurement.endTimestampMs);
      continue;
    }
    const lastBeat = beats[beats.length - 1]!;
    if (Math.abs(measurement.startTimestampMs - lastBeat) <= BEAT_DUPLICATE_TOLERANCE_MS) {
      if (measurement.endTimestampMs - lastBeat > BEAT_DUPLICATE_TOLERANCE_MS * 0.35) {
        beats.push(measurement.endTimestampMs);
      }
      continue;
    }
    beats.push(measurement.startTimestampMs, measurement.endTimestampMs);
  }
  return beats;
}

export class PulseBpmEngine {
  private displayBpm = 0;
  private lastReliableBpmTs = 0;
  private lastStableMedianRrMs = 0;
  private recentDisplayCandidates: Array<{ timestampMs: number; bpm: number; reliable: boolean }> = [];

  push(input: PulseBpmInput): PulseBpmSnapshot {
    const { timestampMs, mergedBeats, sourceKind = "fingerCamera" } = input;
    const all = buildRrMeasurements(mergedBeats);
    const filtered = filterPulseRrMeasurements(all, sourceKind);
    const filteredBeatTimestampsMs = buildFilteredBeatTimestamps(filtered);
    let window = selectRecentRrMeasurements(filtered, timestampMs, PULSE_WINDOW_MS);

    // Finger PPG post-gap reacquire gate. После разрыва сигнала первые RR меряются
    // относительно устаревшего удара до гэпа и дают ложный BPM (например, фантомные 58,
    // а потом скачок к реальным ~69). Исключаем пре-гэп RR из окна и удерживаем прошлый BPM,
    // пока не накопится POST_GAP_MIN_RR чистых пост-гэп RR. Wearable RR точны — не гейтим.
    let reacquiring = false;
    if (sourceKind === "fingerCamera") {
      const gap = findLastGapResumeBeat(mergedBeats, POST_GAP_REACQUIRE_MIN_GAP_MS);
      if (gap != null) {
        const maxInterpolatedGapMs = getMaxInterpolatedGapMs(this.lastStableMedianRrMs);
        const requiresHardReacquire = gap.gapMs > maxInterpolatedGapMs;
        if (requiresHardReacquire) {
          const postGapAll = filtered.filter((m) => m.startTimestampMs >= gap.resumeTs);
          window = window.filter((m) => m.startTimestampMs >= gap.resumeTs);
          if (postGapAll.length < POST_GAP_MIN_RR) {
            reacquiring = true;
          }
        }
      }
    }

    const intervals = window.map((m) => m.intervalMs);
    const medianRr = median(intervals);
    const jitter = median(intervals.map((v) => Math.abs(v - medianRr)));

    // RR-drift reacquire gate (finger PPG). A gap > 2.5 s is caught above, but a short
    // detection lapse (a few missed beats, no big gap) can still let stale/long RR enter the
    // window and pull the median BPM off by >25 % in one snapshot (e.g. 73 → 53 bpm). Real HR
    // never jumps that fast, so when the window median deviates >25 % from the last stable
    // median we hold the previous displayBpm until the window returns within the band and
    // re-stabilises. This suppresses the single-point "needle" spikes after brief detection
    // drops. Wearable RR is trusted and never gated.
    if (
      sourceKind === "fingerCamera" &&
      !reacquiring &&
      this.lastStableMedianRrMs > 0 &&
      medianRr > 0 &&
      Math.abs(medianRr - this.lastStableMedianRrMs) / this.lastStableMedianRrMs > 0.25
    ) {
      reacquiring = true;
    }

    const looksCoherent =
      !reacquiring &&
      intervals.length >= 5 &&
      medianRr > 0 &&
      jitter <= Math.max(110, medianRr * 0.2);

    const rawBpm =
      intervals.length >= 4
        ? calculatePulseRateBpmMedian(intervals)
        : calculatePulseRateBpm(intervals);

    const candidateBpm = medianRr > 0 ? 60_000 / medianRr : rawBpm;
    // Во время реакквизиции не подкармливаем display-пул: копим только чистые пост-гэп RR,
    // а прошлый displayBpm держим замороженным до выхода из гейта.
    if (!reacquiring && candidateBpm > 0 && Number.isFinite(candidateBpm)) {
      this.recentDisplayCandidates.push({
        timestampMs,
        bpm: candidateBpm,
        reliable: looksCoherent || intervals.length >= 4,
      });
    }
    const candidateCutoff = timestampMs - 2_500;
    this.recentDisplayCandidates = this.recentDisplayCandidates.filter(
      (sample) => sample.timestampMs >= candidateCutoff,
    );

    const reliablePool = this.recentDisplayCandidates.filter((sample) => sample.reliable);
    const pool = reliablePool.length >= 3 ? reliablePool : this.recentDisplayCandidates;
    const poolBpm = pool.map((sample) => sample.bpm).filter((value) => value > 0);
    if (looksCoherent && candidateBpm > 0) {
      this.lastReliableBpmTs = timestampMs;
      // Only accept a new stable baseline when it is within ±25 % of the previous one (or
      // there is no baseline yet). Otherwise a sustained bogus rhythm (e.g. noise-driven
      // long RR after a detection lapse) would become "stable" by virtue of its own low
      // jitter, the drift gate would clear, and the bogus BPM would leak through. Real HR
      // drifts gradually, so a >25 % single-snapshot jump is never a legitimate new baseline.
      if (
        this.lastStableMedianRrMs === 0 ||
        Math.abs(medianRr - this.lastStableMedianRrMs) / this.lastStableMedianRrMs <= 0.25
      ) {
        this.lastStableMedianRrMs = medianRr;
      }
    }
    if (reacquiring) {
      // hold previous displayBpm; do not let the stale/settling RR move it
    } else if (poolBpm.length >= 3) {
      this.displayBpm = median(poolBpm);
    } else if (this.displayBpm <= 0 && candidateBpm > 0 && intervals.length >= 3) {
      this.displayBpm = candidateBpm;
    } else if (
      this.displayBpm > 0 &&
      timestampMs - this.lastReliableBpmTs > 2_500 &&
      candidateBpm > 0 &&
      intervals.length >= 3
    ) {
      this.displayBpm = candidateBpm;
    } else if (
      this.displayBpm > 0 &&
      timestampMs - this.lastReliableBpmTs > 8_000 &&
      poolBpm.length === 0
    ) {
      // Hold the last known BPM for up to ~8 s of total signal loss before declaring 0. The
      // reacquire gate already holds displayBpm across a gap and the post-gap settling window;
      // this fallback only fires in non-reacquiring lost-signal states (e.g. finger off with no
      // post-gap beat yet). A longer hold avoids the live readout flashing "0" during brief
      // mid-practice dropouts — the chart's gray band is driven by `liveMeasurementActive`, not
      // by this value, so holding here does not hide the gap on the graph.
      this.displayBpm = 0;
    }

    return {
      bpm: this.displayBpm,
      rawBpm,
      windowSeconds: PULSE_WINDOW_MS / 1000,
      rrCount: intervals.length,
      medianRrMs: medianRr,
      jitterMs: jitter,
      intervalsMs: intervals,
      looksCoherent,
      lastBeatTimestampMs: mergedBeats[mergedBeats.length - 1] ?? 0,
      filteredBeatTimestampsMs,
      reacquiring,
    };
  }

  reset(): void {
    this.displayBpm = 0;
    this.lastReliableBpmTs = 0;
    this.lastStableMedianRrMs = 0;
    this.recentDisplayCandidates = [];
  }
}
