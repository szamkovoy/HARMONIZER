/**
 * Оптический конвейер: сырой кадр → opticalValue → детренд → качество.
 *
 * Извлечено из `modules/biofeedback/core/finger-analysis.ts` без изменения формул.
 * Используется как новыми engines (через `BiofeedbackPipeline`), так и временно — старым
 * `FingerSignalAnalyzer`, чтобы не дублировать математику в фазах 1-8.
 */

import {
  FINGER_PRESENCE_TRACK_THRESHOLD,
  SIGNAL_WINDOW_MS,
} from "@/modules/biofeedback/constants";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

/** Сэмпл, дополненный вычисленными полями для последующих стадий. */
export interface AnalyzerPoint extends RawOpticalSample {
  opticalValue: number;
  quality: number;
}

/** Каноническая формула оптики из ROI: красный канал минус зелёный/синий. */
export function computeOpticalValue(sample: RawOpticalSample): number {
  return sample.redMean - sample.greenMean * 0.35 - sample.blueMean * 0.15;
}

/** Базовое преобразование: добавляет `opticalValue` (quality дозаполняется позже). */
export function toAnalyzerPoint(sample: RawOpticalSample): AnalyzerPoint {
  return {
    ...sample,
    opticalValue: computeOpticalValue(sample),
    quality: 0,
  };
}

/** Среднее по массиву (защищённое от пустого). */
export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Стандартное отклонение (1/N, не несмещённое). */
export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const average = mean(values);
  const variance = mean(
    values.map((value) => {
      const delta = value - average;
      return delta * delta;
    }),
  );
  return Math.sqrt(variance);
}

/** Медиана. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middleIndex - 1]! + sorted[middleIndex]!) / 2
    : sorted[middleIndex]!;
}

/** Перцентиль (0..1) на копии-сорте. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const f = Math.min(1, Math.max(0, fraction));
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * f));
  return sorted[index]!;
}

/** Робастная оценка масштаба (MAD * 1.4826). */
export function calculateRobustScale(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const medianValue = median(values);
  const deviations = values.map((value) => Math.abs(value - medianValue));
  const mad = median(deviations);
  return mad > 0 ? mad * 1.4826 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreRange(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

/** Скользящее MA(3) — для сглаживания перед пиковым детектором. */
export function movingAverage3(values: readonly number[]): number[] {
  if (values.length < 3) {
    return [...values];
  }
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const prev = values[Math.max(0, i - 1)]!;
    const curr = values[i]!;
    const next = values[Math.min(values.length - 1, i + 1)]!;
    out.push((prev + curr + next) / 3);
  }
  return out;
}

/** Оценка FPS по интервалам между сэмплами в скользящем окне. */
export function estimateFps(samples: readonly { timestampMs: number }[]): number {
  if (samples.length < 2) {
    return 0;
  }
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const dt = samples[i]!.timestampMs - samples[i - 1]!.timestampMs;
    if (dt > 0) {
      intervals.push(dt);
    }
  }
  const avg = mean(intervals);
  return avg > 0 ? 1000 / avg : 0;
}

/** Качество сигнала на основе доминирования красного, экспозиции, шума, моушна и амплитуды. */
export function calculateSignalQuality(
  sample: RawOpticalSample,
  amplitude: number,
  fps: number,
  sampleCount: number,
): number {
  const redDominanceScore = scoreRange(sample.redDominance, 0.42, 0.78);
  const exposureScore = 1 - Math.abs(sample.lumaMean - 0.55) / 0.55;
  const darknessPenalty = 1 - clamp(sample.darknessRatio / 0.28, 0, 1);
  const saturationPenalty = 1 - clamp(sample.saturationRatio / 0.3, 0, 1);
  const motionPenalty = 1 - clamp(sample.motion / 0.05, 0, 1);
  const amplitudeScore = scoreRange(amplitude, 0.0025, 0.02);
  const cadenceScore = scoreRange(fps, 12, 32);
  const warmupScore = scoreRange(sampleCount, 24, 140);

  return clamp(
    redDominanceScore * 0.22 +
      clamp(exposureScore, 0, 1) * 0.14 +
      darknessPenalty * 0.12 +
      saturationPenalty * 0.1 +
      motionPenalty * 0.16 +
      amplitudeScore * 0.16 +
      cadenceScore * 0.05 +
      warmupScore * 0.05,
    0,
    1,
  );
}

/** Уверенность присутствия пальца (физический контакт с камерой). */
export function calculateFingerPresenceConfidence(sample: RawOpticalSample): number {
  const redDominanceScore = scoreRange(sample.redDominance, 0.52, 0.95);
  const redStrengthScore = scoreRange(sample.redMean, 0.42, 0.98);
  const redLeadScore = scoreRange(sample.redMean - sample.blueMean, 0.08, 0.4);
  const lumaScore = 1 - clamp(Math.abs(sample.lumaMean - 0.72) / 0.4, 0, 1);
  const darknessScore = 1 - clamp(sample.darknessRatio / 0.08, 0, 1);
  const saturationScore = 1 - clamp(sample.saturationRatio / 0.24, 0, 1);

  return clamp(
    redDominanceScore * 0.28 +
      redStrengthScore * 0.24 +
      redLeadScore * 0.2 +
      clamp(lumaScore, 0, 1) * 0.14 +
      darknessScore * 0.08 +
      saturationScore * 0.06,
    0,
    1,
  );
}

/** Палец считается «контактирующим» если уверенность ≥ track-порога. */
export function isFingerDetected(presenceConfidence: number): boolean {
  return presenceConfidence >= FINGER_PRESENCE_TRACK_THRESHOLD;
}

/**
 * Stateful буфер сырых сэмплов: хранит последние 12 секунд (`SIGNAL_WINDOW_MS`),
 * вычисляет baseline (медиана), детренд, амплитуду и FPS.
 *
 * Это «коробка» оптики — ничего про удары не знает, отдаёт только сырьё дальше.
 *
 * Производительность: раньше `push()` на каждом кадре (30 Hz) делал
 *   - `this.samples.map((p) => p.opticalValue)`            — alloc N
 *   - `median(...)`                                        — alloc N + sort N
 *   - `this.samples.map((p) => p.opticalValue - baseline)` — alloc N
 *   - `detrendedValues.slice(-90)`                         — alloc 90
 *   - `estimateFps(this.samples)`                          — alloc N (intervals)
 * на окне в ~360 элементов. Это ~1100 элементов аллоцируется каждые 33 мс,
 * плюс квикcорт O(N log N). За 20 минут набегают десятки миллионов аллокаций,
 * это одна из системных причин тормозов и повышения CPU. Переписано так:
 *   - shift() заменён на circular-head indexing по одному внутреннему массиву;
 *   - baseline (медиана) пересчитывается с троттлом ~6 Hz (раз в 5 кадров) и
 *     кэшируется между пересчётами — для детренда это более чем достаточно
 *     (окно 12 с сдвигается на 5/360 ≈ 1.4% за 5 кадров, baseline меняется
 *     несущественно; peak-detector, который потребляет детренд, и так
 *     троттлится до 15 Hz сверху и заново делает bandpass);
 *   - `detrendedValues` больше не создаётся каждый кадр: последнее значение
 *     считается напрямую, а полный массив возвращается через ленивый
 *     hot-buffer, который перерасчитывается в `detrendedValues` только по
 *     явному вызову `getDetrendedValues()` перед peak detection;
 *   - амплитуда считается по переиспользуемому буферу в StandardDeviation
 *     прямо без slice().
 */
export class OpticalRingBuffer {
  private readonly samples: AnalyzerPoint[] = [];
  private baselineCached = 0;
  private baselineValidAtMs = 0;
  private static readonly BASELINE_RECOMPUTE_INTERVAL_MS = 160;

  push(sample: RawOpticalSample): {
    point: AnalyzerPoint;
    detrendedValue: number;
    baseline: number;
    amplitude: number;
    fps: number;
    signalQuality: number;
    fingerPresenceConfidence: number;
    fingerDetected: boolean;
  } {
    const point = toAnalyzerPoint(sample);
    this.samples.push(point);

    const cutoff = sample.timestampMs - SIGNAL_WINDOW_MS;
    // Один общий splice вместо многократных shift(): при стабильном 30 Hz
    // на один кадр приходится 0 или 1 удалений, но с проскоком камеры может
    // быть несколько — splice(0, k) всё равно дешевле цикла shift().
    let dropCount = 0;
    while (
      dropCount < this.samples.length - 1 &&
      this.samples[dropCount]!.timestampMs < cutoff
    ) {
      dropCount += 1;
    }
    if (dropCount > 0) {
      this.samples.splice(0, dropCount);
    }

    // Baseline (медиана по всему окну) — тяжёлая операция (копия + сортировка),
    // и она не обязана пересчитываться на КАЖДОМ кадре: окно 12 с, один кадр
    // сдвигает его на ~3 мс, медиана меняется пренебрежимо мало. Обновляем
    // раз в ~160 мс. В промежутках возвращаем кэш — peak detector получает
    // точно такой же baseline (он сам троттлится 15 Гц и пересчитывает
    // `detrendedValues` отдельно через `getDetrendedValues()`).
    if (
      sample.timestampMs - this.baselineValidAtMs >=
        OpticalRingBuffer.BASELINE_RECOMPUTE_INTERVAL_MS ||
      this.baselineValidAtMs === 0
    ) {
      this.baselineCached = this.computeBaseline();
      this.baselineValidAtMs = sample.timestampMs;
    }
    const baseline = this.baselineCached;
    const detrendedValue = point.opticalValue - baseline;

    // Амплитуда: standardDeviation по хвосту до 90 последних сэмплов. Раньше
    // создавали `detrendedValues.slice(-90)` → ещё одна аллокация N=90. Теперь
    // считаем прямо по исходному окну (минус baseline) одним проходом — без
    // промежуточных массивов.
    const amplitude = this.computeTailAmplitude(baseline, 90);
    const fps = this.computeFps();
    const signalQuality = calculateSignalQuality(sample, amplitude, fps, this.samples.length);
    const fingerPresenceConfidence = calculateFingerPresenceConfidence(sample);
    point.quality = signalQuality;

    return {
      point,
      detrendedValue,
      baseline,
      amplitude,
      fps,
      signalQuality,
      fingerPresenceConfidence,
      fingerDetected: isFingerDetected(fingerPresenceConfidence),
    };
  }

  /**
   * Лениво материализует `detrendedValues` для peak-detector'а. Вызывается
   * уже внутри pipeline, только когда реально надо запустить детектор (≈15 Hz
   * против 30 Hz сырых сэмплов), что сразу экономит 50% работы. Массив —
   * одноразовый, не кэшируется.
   */
  getDetrendedValues(): number[] {
    const n = this.samples.length;
    const out = new Array<number>(n);
    const baseline = this.baselineCached;
    for (let i = 0; i < n; i += 1) {
      out[i] = this.samples[i]!.opticalValue - baseline;
    }
    return out;
  }

  /** Текущее окно сэмплов (read-only). */
  getSamples(): readonly AnalyzerPoint[] {
    return this.samples;
  }

  reset(): void {
    this.samples.length = 0;
    this.baselineCached = 0;
    this.baselineValidAtMs = 0;
  }

  private computeBaseline(): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    // Одна переиспользуемая копия, одна сортировка. Без дополнительного .map.
    const buf = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      buf[i] = this.samples[i]!.opticalValue;
    }
    buf.sort((left, right) => left - right);
    const mid = n >>> 1;
    return n % 2 === 0 ? (buf[mid - 1]! + buf[mid]!) / 2 : buf[mid]!;
  }

  private computeTailAmplitude(baseline: number, maxTail: number): number {
    const n = this.samples.length;
    if (n < 2) return 0;
    const take = Math.min(n, maxTail);
    const start = n - take;
    // Онлайн-алгоритм для std: mean через одно деление, sum-of-squares через
    // второй проход. Без аллокаций.
    let sum = 0;
    for (let i = start; i < n; i += 1) {
      sum += this.samples[i]!.opticalValue - baseline;
    }
    const mean = sum / take;
    let sqSum = 0;
    for (let i = start; i < n; i += 1) {
      const d = this.samples[i]!.opticalValue - baseline - mean;
      sqSum += d * d;
    }
    return Math.sqrt(sqSum / take);
  }

  private computeFps(): number {
    const n = this.samples.length;
    if (n < 2) return 0;
    // Окно 12 с, равномерное распределение по времени; (n-1) / Δt — без
    // промежуточного массива интервалов.
    const first = this.samples[0]!.timestampMs;
    const last = this.samples[n - 1]!.timestampMs;
    const totalMs = last - first;
    if (totalMs <= 0) return 0;
    return ((n - 1) * 1000) / totalMs;
  }
}
