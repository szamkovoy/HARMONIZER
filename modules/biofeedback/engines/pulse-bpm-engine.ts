/**
 * PulseBpmEngine: текущий средний BPM по скользящему окну 10 с.
 *
 * Поведение полностью повторяет старое из `FingerSignalAnalyzer`:
 *  - `buildPulseRrMeasurements`: жёсткий 450..1400 ms + sequential filter (16% от медианы).
 *  - `selectRrWindow` ограничивает окно последними 10 с по `endTimestampMs`.
 *  - При ≥4 RR — медианный BPM (`calculatePulseRateBpmMedian`); иначе обычный
 *    `calculatePulseRateBpm` с фильтром по медиане ±18%.
 *  - Hold-логика (поддержание BPM в `holding` после tracking) — снаружи (на уровне FSM/Bus).
 *
 * Это «UI-friendly» BPM: стабильное среднее. LivePulseChannel — отдельный поток для синка.
 */

import {
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
}

interface RrMeasurement {
  intervalMs: number;
  startTimestampMs: number;
  endTimestampMs: number;
}

function buildRrMeasurements(beats: readonly number[]): RrMeasurement[] {
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
function filterPulseRrMeasurements(measurements: readonly RrMeasurement[]): RrMeasurement[] {
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

export class PulseBpmEngine {
  push(input: PulseBpmInput): PulseBpmSnapshot {
    const { timestampMs, mergedBeats } = input;
    const all = buildRrMeasurements(mergedBeats);
    const filtered = filterPulseRrMeasurements(all);
    const window = selectRecentRrMeasurements(filtered, timestampMs, PULSE_WINDOW_MS);

    const intervals = window.map((m) => m.intervalMs);
    const medianRr = median(intervals);
    const jitter = median(intervals.map((v) => Math.abs(v - medianRr)));
    const looksCoherent =
      intervals.length >= 5 && medianRr > 0 && jitter <= Math.max(110, medianRr * 0.2);

    const bpm =
      intervals.length >= 4
        ? calculatePulseRateBpmMedian(intervals)
        : calculatePulseRateBpm(intervals);

    return {
      bpm,
      windowSeconds: PULSE_WINDOW_MS / 1000,
      rrCount: intervals.length,
      medianRrMs: medianRr,
      jitterMs: jitter,
      intervalsMs: intervals,
      looksCoherent,
      lastBeatTimestampMs: mergedBeats[mergedBeats.length - 1] ?? 0,
    };
  }

  // Stateless. Reset не нужен, но добавлен для единообразия с другими engines.
  reset(): void {}
}
