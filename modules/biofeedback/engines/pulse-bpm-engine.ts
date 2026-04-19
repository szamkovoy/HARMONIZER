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
export function filterPulseRrMeasurements(measurements: readonly RrMeasurement[]): RrMeasurement[] {
  const accepted: RrMeasurement[] = [];
  for (const m of measurements) {
    if (m.intervalMs < PULSE_RR_MIN_MS || m.intervalMs > PULSE_RR_MAX_MS) {
      continue;
    }
    if (accepted.length >= RR_SEQUENCE_MIN_CONTEXT) {
      const recent = accepted.slice(-RR_SEQUENCE_WINDOW_SIZE).map((x) => x.intervalMs);
      const med = median(recent);
      const allowed = Math.max(
        RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
        med * PULSE_RR_DEVIATION_RATIO,
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
  private recentDisplayCandidates: Array<{ timestampMs: number; bpm: number; reliable: boolean }> = [];

  push(input: PulseBpmInput): PulseBpmSnapshot {
    const { timestampMs, mergedBeats } = input;
    const all = buildRrMeasurements(mergedBeats);
    const filtered = filterPulseRrMeasurements(all);
    const filteredBeatTimestampsMs = buildFilteredBeatTimestamps(filtered);
    const window = selectRecentRrMeasurements(filtered, timestampMs, PULSE_WINDOW_MS);

    const intervals = window.map((m) => m.intervalMs);
    const medianRr = median(intervals);
    const jitter = median(intervals.map((v) => Math.abs(v - medianRr)));
    const looksCoherent =
      intervals.length >= 5 && medianRr > 0 && jitter <= Math.max(110, medianRr * 0.2);

    const rawBpm =
      intervals.length >= 4
        ? calculatePulseRateBpmMedian(intervals)
        : calculatePulseRateBpm(intervals);

    const candidateBpm = medianRr > 0 ? 60_000 / medianRr : rawBpm;
    if (candidateBpm > 0 && Number.isFinite(candidateBpm)) {
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
    }
    if (poolBpm.length >= 3) {
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
      timestampMs - this.lastReliableBpmTs > 4_500 &&
      poolBpm.length === 0
    ) {
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
    };
  }

  reset(): void {
    this.displayBpm = 0;
    this.lastReliableBpmTs = 0;
    this.recentDisplayCandidates = [];
  }
}
