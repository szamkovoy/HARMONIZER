import {
  HRV_LATCH_INITIAL_AFTER_BEATS,
  HRV_MIN_VALID_BEATS_FOR_METRICS,
  HRV_RR_HARD_MAX_MS,
  HRV_RR_HARD_MIN_MS,
  HRV_TIER_MAX_BEATS,
} from "@/modules/biofeedback/core/hrv-practice-constants";
import {
  calculatePulseRateBpm,
  calculatePulseRateBpmMedian,
  computePracticeHrvMetrics,
  computePracticeRmssdHampelDiagnostics,
  type PracticeHrvMetricsResult,
  type PracticeRmssdHampelDiagnostics,
} from "@/modules/biofeedback/core/metrics";
import { bandpassPpgForPeakDetection } from "@/modules/biofeedback/core/ppg-bandpass";
import type {
  BiofeedbackCaptureConfig,
  BiofeedbackFrame,
  BiofeedbackSignalStatus,
  FingerCameraNativeSample,
  FingerPeakDiagnostic,
  FingerSignalSnapshot,
  OpticalSignalSample,
  PulseLockState,
  StressReadinessTier,
} from "@/modules/biofeedback/core/types";

type AnalyzerPoint = FingerCameraNativeSample & {
  opticalValue: number;
  quality: number;
};

type RrMeasurement = {
  intervalMs: number;
  startTimestampMs: number;
  endTimestampMs: number;
};

const SIGNAL_WINDOW_MS = 12_000;
/** Длинная история ударов для HRV (иначе «первые 90» вымываются из merged и RMSSD «плывёт»). */
const BEAT_HISTORY_WINDOW_MS = 45 * 60 * 1000;
/** Скользящее окно для оценки ЧСС (после калибровки обновляется непрерывно). */
const PULSE_WINDOW_MS = 10_000;
/** Окно проверки устойчивости после прогрева (повторяется при неудаче, без нового прогрева). */
const PULSE_SETTLE_MS = 10_000;
/** Доля окна с «хорошим» трекингом, достаточная для успеха (допускаются кратковременные сбои). */
const PULSE_SETTLE_GOOD_FRAC = 0.82;
const RMSSD_WINDOW_MS = 60_000;
const STRESS_FAST_WINDOW_MS = 60_000;
const MAX_RENDER_SAMPLES = 48;
const STABLE_LOCK_QUALITY_THRESHOLD = 0.54;
const HOLD_LOCK_MS = 5_000;
const HOLD_LOCK_RELEASE_QUALITY = 0.06;
const FINGER_PRESENCE_TRACK_THRESHOLD = 0.58;
const FINGER_PRESENCE_HOLD_THRESHOLD = 0.28;
const HRV_QUALITY_THRESHOLD = 0.52;
const PULSE_MIN_RR_COUNT = 5;
const HRV_HOLD_MS = 9_000;
const STRESS_HOLD_MS = 12_000;
const BEAT_DUPLICATE_TOLERANCE_MS = 220;
const BEAT_STALE_TIMEOUT_MS = 4_200;
const WARMING_HARD_RESET_MS = 10_000;
const PULSE_VALIDATION_GRACE_MS = 3_000;
const PULSE_LOCK_HOLD_MS = 6_000;
const WARMING_PHASE_MS = 10_000;
const METRICS_RESET_GRACE_MS = 5_000;
const QUALITY_HYSTERESIS_DROP = 0.44;
/** Постоянная времени сглаживания отображаемой RMSSD (~63% за τ; целевой горизонт 10–15 с). */
const HRV_RMSSD_DISPLAY_TAU_MS = 12_000;
/** То же для стресса в режиме начало/конец: цель — финальный сегмент, но кадр к кадру сглаживаем (как RMSSD). */
const HRV_STRESS_DISPLAY_TAU_MS = 12_000;
const PULSE_RR_MIN_MS = 450;
const PULSE_RR_MAX_MS = 1_400;
const RR_SEQUENCE_WINDOW_SIZE = 9;
const PULSE_RR_DEVIATION_RATIO = 0.16;
const RR_SEQUENCE_MIN_CONTEXT = 4;
const RR_SEQUENCE_MIN_ALLOWED_DELTA_MS = 100;
const PEAK_EDGE_MARGIN_MS = 220;
const PEAK_PROMINENCE_WINDOW_MS = 220;
const MIN_ACCEPTED_PEAK_VALUE = 0.0004;
const MIN_ACCEPTED_PEAK_PROMINENCE = 0.00035;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function standardDeviation(values: readonly number[]) {
  if (values.length < 2) {
    return 0;
  }

  const average = mean(values);
  const variance = mean(values.map((value) => {
    const delta = value - average;
    return delta * delta;
  }));
  return Math.sqrt(variance);
}

function scoreRange(value: number, min: number, max: number) {
  return clamp((value - min) / (max - min), 0, 1);
}

function blendTowards(current: number, next: number, factor: number) {
  if (current <= 0) {
    return next;
  }

  return current + (next - current) * clamp(factor, 0, 1);
}

function median(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middleIndex - 1] + sorted[middleIndex]) / 2
    : sorted[middleIndex];
}

type PeakDetectionResult = {
  candidatePeaks: FingerPeakDiagnostic[];
  acceptedPeaks: FingerPeakDiagnostic[];
  rejectedPeaks: FingerPeakDiagnostic[];
  beatTimestampsMs: number[];
};

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const clampedFraction = clamp(fraction, 0, 1);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * clampedFraction));
  return sorted[index];
}

function calculateRobustScale(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }

  const medianValue = median(values);
  const deviations = values.map((value) => Math.abs(value - medianValue));
  const mad = median(deviations);
  return mad > 0 ? mad * 1.4826 : 0;
}

function movingAverage3(values: readonly number[]) {
  if (values.length < 3) {
    return [...values];
  }

  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const prev = values[Math.max(0, i - 1)];
    const curr = values[i];
    const next = values[Math.min(values.length - 1, i + 1)];
    out.push((prev + curr + next) / 3);
  }
  return out;
}

function buildRrMeasurements(beatTimestampsMs: readonly number[]) {
  const measurements: RrMeasurement[] = [];

  for (let index = 1; index < beatTimestampsMs.length; index += 1) {
    const startTimestampMs = beatTimestampsMs[index - 1];
    const endTimestampMs = beatTimestampsMs[index];
    const intervalMs = endTimestampMs - startTimestampMs;
    if (intervalMs > 0) {
      measurements.push({
        intervalMs,
        startTimestampMs,
        endTimestampMs,
      });
    }
  }

  return measurements;
}

function selectRrWindow(
  measurements: readonly RrMeasurement[],
  nowTimestampMs: number,
  windowMs: number,
) {
  const cutoffTimestampMs = nowTimestampMs - windowMs;
  const selectedMeasurements = measurements.filter((measurement) => measurement.endTimestampMs > cutoffTimestampMs);

  if (selectedMeasurements.length === 0) {
    return {
      measurements: [] as RrMeasurement[],
      intervalsMs: [] as number[],
      coverageMs: 0,
      sumIntervalsMs: 0,
    };
  }

  const firstCoveredTimestampMs = Math.max(cutoffTimestampMs, selectedMeasurements[0].startTimestampMs);
  const coverageMs = Math.max(
    0,
    selectedMeasurements[selectedMeasurements.length - 1].endTimestampMs - firstCoveredTimestampMs,
  );
  const sumIntervalsMs = sum(selectedMeasurements.map((measurement) => measurement.intervalMs));

  return {
    measurements: selectedMeasurements,
    intervalsMs: selectedMeasurements.map((measurement) => measurement.intervalMs),
    coverageMs,
    sumIntervalsMs,
  };
}

function buildHrvRrMeasurements(measurements: readonly RrMeasurement[]) {
  return measurements.filter(
    (measurement) =>
      measurement.intervalMs >= HRV_RR_HARD_MIN_MS &&
      measurement.intervalMs <= HRV_RR_HARD_MAX_MS,
  );
}

function buildPulseRrMeasurements(measurements: readonly RrMeasurement[]): RrMeasurement[] {
  return filterSequentialRrMeasurements(
    measurements,
    PULSE_RR_MIN_MS,
    PULSE_RR_MAX_MS,
    PULSE_RR_DEVIATION_RATIO,
  );
}

function filterSequentialRrMeasurements(
  measurements: readonly RrMeasurement[],
  minIntervalMs: number,
  maxIntervalMs: number,
  deviationRatio: number,
) {
  const accepted: RrMeasurement[] = [];

  for (const measurement of measurements) {
    if (measurement.intervalMs < minIntervalMs || measurement.intervalMs > maxIntervalMs) {
      continue;
    }

    if (accepted.length >= RR_SEQUENCE_MIN_CONTEXT) {
      const recentIntervals = accepted.slice(-RR_SEQUENCE_WINDOW_SIZE).map((item) => item.intervalMs);
      const medianIntervalMs = median(recentIntervals);
      const allowedDeltaMs = Math.max(
        RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
        medianIntervalMs * deviationRatio,
      );
      if (Math.abs(measurement.intervalMs - medianIntervalMs) > allowedDeltaMs) {
        continue;
      }
    }

    accepted.push(measurement);
  }

  return accepted;
}

function calculateWindowProgressSeconds(coverageMs: number, targetWindowMs: number) {
  return Math.min(targetWindowMs, coverageMs) / 1000;
}

function estimateFps(samples: readonly AnalyzerPoint[]) {
  if (samples.length < 2) {
    return 0;
  }

  const intervalsMs: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const intervalMs = samples[index].timestampMs - samples[index - 1].timestampMs;
    if (intervalMs > 0) {
      intervalsMs.push(intervalMs);
    }
  }

  const averageIntervalMs = mean(intervalsMs);
  if (averageIntervalMs <= 0) {
    return 0;
  }

  return 1000 / averageIntervalMs;
}

function calculateSignalQuality(
  sample: AnalyzerPoint,
  amplitude: number,
  fps: number,
  sampleCount: number,
) {
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

/** Параболическая интерполяция: уточнение времени пика по трём отсчётам (соседи кадра максимума). */
const PARABOLIC_PEAK_DELTA_MAX_SAMPLES = 0.5;

function refinePeakTimestampMs(
  peakSampleIndex: number,
  detrendedValues: readonly number[],
  samples: readonly AnalyzerPoint[],
): number {
  const i = peakSampleIndex;
  const n = detrendedValues.length;
  if (i <= 0 || i >= n - 1) {
    return samples[i].timestampMs;
  }
  const Sn = detrendedValues[i];
  const Sm = detrendedValues[i - 1];
  const Sp = detrendedValues[i + 1];
  const denom = Sm - 2 * Sn + Sp;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) {
    return samples[i].timestampMs;
  }
  const delta = 0.5 * (Sm - Sp) / denom;
  const clampedDelta = clamp(delta, -PARABOLIC_PEAK_DELTA_MAX_SAMPLES, PARABOLIC_PEAK_DELTA_MAX_SAMPLES);
  const dtLeft = samples[i].timestampMs - samples[i - 1].timestampMs;
  const dtRight = samples[i + 1].timestampMs - samples[i].timestampMs;
  const avgDtMs = (dtLeft + dtRight) / 2;
  if (avgDtMs <= 0 || !Number.isFinite(avgDtMs)) {
    return samples[i].timestampMs;
  }
  return samples[i].timestampMs + clampedDelta * avgDtMs;
}

function calculateFingerPresenceConfidence(sample: AnalyzerPoint) {
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

function detectBeats(
  samples: readonly AnalyzerPoint[],
  detrendedValues: readonly number[],
  config: BiofeedbackCaptureConfig,
  fps: number,
): PeakDetectionResult {
  const N = detrendedValues.length;
  if (N < 20 || fps < 4) {
    return {
      candidatePeaks: [],
      acceptedPeaks: [],
      rejectedPeaks: [],
      beatTimestampsMs: [],
    };
  }

  const edgeMarginSamples = Math.max(2, Math.round((fps * PEAK_EDGE_MARGIN_MS) / 1000));
  const prominenceWindowSamples = Math.max(2, Math.round((fps * PEAK_PROMINENCE_WINDOW_MS) / 1000));
  const refractoryMs = Math.max(280, 60_000 / config.maxPulseBpm);
  const localMaxima: Array<{
    sampleIndex: number;
    timestampMs: number;
    value: number;
    prominence: number;
  }> = [];

  for (let i = 1; i < N - 1; i += 1) {
    if (!(detrendedValues[i] > detrendedValues[i - 1] && detrendedValues[i] >= detrendedValues[i + 1])) {
      continue;
    }

    const leftStart = Math.max(0, i - prominenceWindowSamples);
    const rightEnd = Math.min(N - 1, i + prominenceWindowSamples);
    let leftMin = detrendedValues[leftStart];
    let rightMin = detrendedValues[i];
    for (let j = leftStart; j <= i; j += 1) {
      leftMin = Math.min(leftMin, detrendedValues[j]);
    }
    for (let j = i; j <= rightEnd; j += 1) {
      rightMin = Math.min(rightMin, detrendedValues[j]);
    }

    localMaxima.push({
      sampleIndex: i,
      timestampMs: samples[i].timestampMs,
      value: detrendedValues[i],
      prominence: detrendedValues[i] - Math.max(leftMin, rightMin),
    });
  }

  if (localMaxima.length === 0) {
    return {
      candidatePeaks: [],
      acceptedPeaks: [],
      rejectedPeaks: [],
      beatTimestampsMs: [],
    };
  }

  const robustScale = calculateRobustScale(detrendedValues);
  const positiveValues = localMaxima
    .map((peak) => peak.value)
    .filter((value) => value > 0);
  const positiveProminences = localMaxima
    .map((peak) => peak.prominence)
    .filter((value) => value > 0);
  const heightThreshold = Math.max(
    MIN_ACCEPTED_PEAK_VALUE,
    robustScale * 0.22,
    percentile(positiveValues, 0.35) * 0.6,
  );
  const prominenceThreshold = Math.max(
    MIN_ACCEPTED_PEAK_PROMINENCE,
    robustScale * 0.18,
    percentile(positiveProminences, 0.35) * 0.65,
  );

  const candidatePeaks: FingerPeakDiagnostic[] = [];
  const acceptedPeaks: FingerPeakDiagnostic[] = [];
  const rejectedPeaks: FingerPeakDiagnostic[] = [];
  const acceptedByWindow: Array<{ diagnostic: FingerPeakDiagnostic; timestampMs: number }> = [];

  for (const peak of localMaxima) {
    const candidate: FingerPeakDiagnostic = {
      sampleIndex: peak.sampleIndex,
      timestampMs: peak.timestampMs,
      value: peak.value,
      prominence: peak.prominence,
      reasonCode: "accepted",
    };
    candidatePeaks.push(candidate);

    if (peak.sampleIndex <= edgeMarginSamples || peak.sampleIndex >= N - 1 - edgeMarginSamples) {
      rejectedPeaks.push({ ...candidate, reasonCode: "edge_margin" });
      continue;
    }

    if (peak.value < heightThreshold) {
      rejectedPeaks.push({ ...candidate, reasonCode: "below_height" });
      continue;
    }

    if (peak.prominence < prominenceThreshold) {
      rejectedPeaks.push({ ...candidate, reasonCode: "below_prominence" });
      continue;
    }

    const lastAccepted = acceptedByWindow[acceptedByWindow.length - 1];
    if (lastAccepted && peak.timestampMs - lastAccepted.timestampMs < refractoryMs) {
      if (peak.prominence > lastAccepted.diagnostic.prominence) {
        rejectedPeaks.push({
          ...lastAccepted.diagnostic,
          reasonCode: "refractory_replaced",
        });
        acceptedByWindow[acceptedByWindow.length - 1] = {
          diagnostic: candidate,
          timestampMs: peak.timestampMs,
        };
      } else {
        rejectedPeaks.push({ ...candidate, reasonCode: "refractory_weaker" });
      }
      continue;
    }

    acceptedByWindow.push({
      diagnostic: candidate,
      timestampMs: peak.timestampMs,
    });
  }

  for (const item of acceptedByWindow) {
    const refinedMs = refinePeakTimestampMs(
      item.diagnostic.sampleIndex,
      detrendedValues,
      samples,
    );
    acceptedPeaks.push({
      ...item.diagnostic,
      timestampMs: refinedMs,
    });
  }

  return {
    candidatePeaks,
    acceptedPeaks,
    rejectedPeaks,
    beatTimestampsMs: acceptedPeaks.map((peak) => peak.timestampMs),
  };
}

function deriveSignalStatus(
  signalQuality: number,
  pulseRateBpm: number,
  config: BiofeedbackCaptureConfig,
  pulseLockState: PulseLockState,
  fingerDetected: boolean,
): BiofeedbackSignalStatus {
  if (!fingerDetected) {
    return signalQuality >= 0.2 ? "searching" : "lost";
  }

  const hasValidPulse =
    pulseRateBpm >= config.minPulseBpm &&
    pulseRateBpm <= config.maxPulseBpm;

  if (signalQuality >= 0.62 && hasValidPulse && pulseLockState === "tracking") {
    return "stable";
  }
  if (pulseLockState === "holding" && hasValidPulse) {
    return "degraded";
  }
  if (signalQuality >= 0.36) {
    return "degraded";
  }
  if (signalQuality >= 0.2) {
    return "searching";
  }
  return "lost";
}

export class FingerSignalAnalyzer {
  private readonly samples: AnalyzerPoint[] = [];
  private readonly beatTimestampsMs: number[] = [];
  /** Удар валиден для RMSSD/стресса только если в момент фиксации был tracking (не holding). */
  private beatHrvEligible: boolean[] = [];
  /** Накопитель валидных (не экстраполированных) ударов для HRV; не ограничен 12 с буфера сигнала. */
  private readonly hrvValidBeatTimestampsMs: number[] = [];
  /** Момент начала текущего окна проверки устойчивости (после прогрева). */
  private validationWindowStartTimestampMs = 0;
  /** После успешной калибровки — не раньше этого времени добавляем удары в HRV-накопитель. */
  private hrvAccumulationStartTimestampMs = 0;
  /** Завершена ли калибровка: 10 с прогрева + 10 с окна проверки (пульс с ~20 с контакта при успехе). */
  private pulseCalibrationComplete = false;
  /** Накопленное время сегмента без аномалий во фазе settle. */
  private pulseSettleGoodMsAccum = 0;
  private warmingElapsedMs = 0;
  private metricsWarmingElapsedMs = 0;
  private lastPushTimestampMs = 0;
  private fingerAbsentSinceMs = 0;
  private pulseEstablished = false;
  private lockedPulseRateBpm = 0;
  private lastStableSignalQuality = 0;
  private lastStableTimestampMs = 0;
  private lastStablePulseRrIntervalsMs: number[] = [];
  private lastStableHrvTimestampMs = 0;
  private lastStableHrvRrIntervalsMs: number[] = [];
  private lastStableHrvRmssdMs = 0;
  private lastStableHrvBaevskyStressIndexRaw = 0;
  private lastStableHrvStressIndex = 0;
  private lastStableStressTimestampMs = 0;
  private lastStableStressWindowSeconds = 0;
  private lastStableStressTier: StressReadinessTier = "warming";
  private phaseAnchorTimestampMs = 0;
  private phasePeriodMs = 0;
  private warmingPhaseComplete = false;
  private pulseLostSinceMs = 0;
  private lastTrackingTimestampMs = 0;
  private smoothedRmssdDisplayMs = 0;
  private displayPulseEmaBpm = 0;
  /** Фиксация «начальных» метрик по первым 90 валидным ударам (не пересчитывать при росте n). */
  private hrvLatchedInitialRmssdMs = 0;
  private hrvLatchedInitialStressPercent = 0;
  private hrvLatchedInitialStressRaw = 0;
  private prevFingerDetected = false;
  private lastPracticeHrvWhileFinger: PracticeHrvMetricsResult | null = null;
  private hrvSessionEndCaptured = false;
  private hrvSessionEndInitialRmssdMs = 0;
  private hrvSessionEndFinalRmssdMs = 0;
  private hrvSessionEndInitialStressIndex = 0;
  private hrvSessionEndFinalStressIndex = 0;
  /** Последний успешный расчёт RMSSD diag (кнопка экспорта после «Новый замер» или при сбросе буфера). */
  private lastRmssdHampelDiagnostics: PracticeRmssdHampelDiagnostics | null = null;

  constructor(private readonly config: BiofeedbackCaptureConfig) {}

  private resetLockedState() {
    this.lockedPulseRateBpm = 0;
    this.lastStableSignalQuality = 0;
    this.lastStableTimestampMs = 0;
    this.lastStablePulseRrIntervalsMs = [];
    this.phaseAnchorTimestampMs = 0;
    this.phasePeriodMs = 0;
    this.lastTrackingTimestampMs = 0;
    this.displayPulseEmaBpm = 0;
  }

  private resetMetricWindows() {
    this.beatTimestampsMs.length = 0;
    this.beatHrvEligible = [];
    this.hrvValidBeatTimestampsMs.length = 0;
    this.validationWindowStartTimestampMs = 0;
    this.hrvAccumulationStartTimestampMs = 0;
    this.pulseCalibrationComplete = false;
    this.pulseSettleGoodMsAccum = 0;
    this.metricsWarmingElapsedMs = 0;
    this.pulseEstablished = false;
    this.warmingPhaseComplete = false;
    this.pulseLostSinceMs = 0;
    this.lastStablePulseRrIntervalsMs = [];
    this.lastStableHrvTimestampMs = 0;
    this.lastStableHrvRrIntervalsMs = [];
    this.lastStableHrvRmssdMs = 0;
    this.lastStableHrvBaevskyStressIndexRaw = 0;
    this.lastStableHrvStressIndex = 0;
    this.lastStableStressTimestampMs = 0;
    this.lastStableStressWindowSeconds = 0;
    this.lastStableStressTier = "warming";
    this.smoothedRmssdDisplayMs = 0;
    this.displayPulseEmaBpm = 0;
    this.hrvLatchedInitialRmssdMs = 0;
    this.hrvLatchedInitialStressPercent = 0;
    this.hrvLatchedInitialStressRaw = 0;
    this.prevFingerDetected = false;
    this.lastPracticeHrvWhileFinger = null;
    this.hrvSessionEndCaptured = false;
    this.hrvSessionEndInitialRmssdMs = 0;
    this.hrvSessionEndFinalRmssdMs = 0;
    this.hrvSessionEndInitialStressIndex = 0;
    this.hrvSessionEndFinalStressIndex = 0;
    this.lastRmssdHampelDiagnostics = null;
  }

  private mergeBeatTimestampsPhase1(
    nextBeatTimestampsMs: readonly number[],
    reanalysisStartTimestampMs: number,
  ): number[] {
    const stablePrefix = this.beatTimestampsMs.filter(
      (timestampMs) => timestampMs < reanalysisStartTimestampMs - BEAT_DUPLICATE_TOLERANCE_MS,
    );

    const merged: number[] = [...stablePrefix];

    for (const timestampMs of nextBeatTimestampsMs) {
      const lastBeatTimestampMs = merged[merged.length - 1];
      if (lastBeatTimestampMs == null || timestampMs - lastBeatTimestampMs > BEAT_DUPLICATE_TOLERANCE_MS) {
        merged.push(timestampMs);
      } else if (Math.abs(timestampMs - lastBeatTimestampMs) <= BEAT_DUPLICATE_TOLERANCE_MS) {
        merged[merged.length - 1] = timestampMs;
      }
    }

    return merged;
  }

  /**
   * Сопоставляет удары по времени с предыдущим кадром. Порядковый индекс нельзя использовать:
   * после обрезки истории (`slice`) и переанализа пиков длины массивов расходятся — иначе при
   * `holding` все удары ошибочно помечались неэкстраполированными/невалидными и счётчик HRV «плавал».
   */
  private syncBeatEligibilityFromMerged(
    merged: readonly number[],
    pulseLockState: PulseLockState,
    prevBeats: readonly number[],
    prevEligible: readonly boolean[],
  ) {
    const tracking = pulseLockState === "tracking";
    const nextEligible: boolean[] = [];
    for (let i = 0; i < merged.length; i += 1) {
      const ts = merged[i];
      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < prevBeats.length; j += 1) {
        const d = Math.abs(ts - prevBeats[j]);
        if (d < bestDist) {
          bestDist = d;
          bestJ = j;
        }
      }
      if (bestJ >= 0 && bestDist <= BEAT_DUPLICATE_TOLERANCE_MS) {
        nextEligible[i] = prevEligible[bestJ] ?? false;
      } else {
        nextEligible[i] = tracking;
      }
    }
    this.beatTimestampsMs.length = 0;
    this.beatTimestampsMs.push(...merged);
    this.beatHrvEligible = nextEligible;
  }

  /** Добавляет в накопитель только новые валидные (eligible) удары после калибровки. */
  private appendNewHrvValidBeats(merged: readonly number[], sampleTimestampMs: number) {
    if (!this.pulseCalibrationComplete) {
      return;
    }
    const startMs = this.hrvAccumulationStartTimestampMs > 0 ? this.hrvAccumulationStartTimestampMs : sampleTimestampMs;
    let last = this.hrvValidBeatTimestampsMs.at(-1) ?? 0;
    for (let i = 0; i < merged.length; i += 1) {
      if (!this.beatHrvEligible[i]) {
        continue;
      }
      const t = merged[i];
      if (t < startMs - 1) {
        continue;
      }
      if (last > 0 && t <= last + BEAT_DUPLICATE_TOLERANCE_MS * 0.35) {
        continue;
      }
      if (t > last) {
        this.hrvValidBeatTimestampsMs.push(t);
        last = t;
      }
    }
  }

  push(sample: FingerCameraNativeSample): FingerSignalSnapshot {
    const opticalValue = sample.redMean - sample.greenMean * 0.35 - sample.blueMean * 0.15;
    const nextPoint: AnalyzerPoint = {
      ...sample,
      opticalValue,
      quality: 0,
    };

    this.samples.push(nextPoint);

    const cutoffTimestampMs = sample.timestampMs - SIGNAL_WINDOW_MS;
    while (this.samples.length > 1 && this.samples[0].timestampMs < cutoffTimestampMs) {
      this.samples.shift();
    }

    const baseline = median(this.samples.map((point) => point.opticalValue));
    const detrendedValues = this.samples.map((point) => point.opticalValue - baseline);
    const detrendedValue = detrendedValues[detrendedValues.length - 1] ?? 0;
    const amplitude = standardDeviation(detrendedValues.slice(-Math.min(this.samples.length, 90)));
    const fps = estimateFps(this.samples);
    const signalQuality = calculateSignalQuality(nextPoint, amplitude, fps, this.samples.length);
    const fingerPresenceConfidence = calculateFingerPresenceConfidence(nextPoint);
    const fingerDetected = fingerPresenceConfidence >= FINGER_PRESENCE_TRACK_THRESHOLD;
    nextPoint.quality = signalQuality;

    const frameDeltaMs = this.lastPushTimestampMs > 0
      ? Math.min(sample.timestampMs - this.lastPushTimestampMs, 500)
      : 0;
    this.lastPushTimestampMs = sample.timestampMs;

    if (fingerDetected) {
      this.fingerAbsentSinceMs = 0;
      this.warmingElapsedMs += frameDeltaMs;
    } else if (this.warmingElapsedMs > 0) {
      if (this.fingerAbsentSinceMs === 0) {
        this.fingerAbsentSinceMs = sample.timestampMs;
      }
      if (sample.timestampMs - this.fingerAbsentSinceMs > WARMING_HARD_RESET_MS) {
        this.resetLockedState();
        this.resetMetricWindows();
        this.warmingElapsedMs = 0;
        this.fingerAbsentSinceMs = 0;
      }
    }

    const inWarmingPhase = this.warmingElapsedMs < WARMING_PHASE_MS;
    if (!inWarmingPhase && !this.warmingPhaseComplete) {
      this.beatTimestampsMs.length = 0;
      this.beatHrvEligible = [];
      this.warmingPhaseComplete = true;
      this.validationWindowStartTimestampMs = sample.timestampMs;
    }

    const bandpassedForPeaks = bandpassPpgForPeakDetection(detrendedValues, fps);
    const detrendedForPeaks = movingAverage3(bandpassedForPeaks);
    const peakDetection = inWarmingPhase
      ? {
          candidatePeaks: [] as FingerPeakDiagnostic[],
          acceptedPeaks: [] as FingerPeakDiagnostic[],
          rejectedPeaks: [] as FingerPeakDiagnostic[],
          beatTimestampsMs: [] as number[],
        }
      : detectBeats(this.samples, detrendedForPeaks, this.config, fps);

    const prevBeats = [...this.beatTimestampsMs];
    const prevEligible = [...this.beatHrvEligible];
    let merged = this.mergeBeatTimestampsPhase1(
      peakDetection.beatTimestampsMs,
      this.samples[0]?.timestampMs ?? sample.timestampMs,
    );

    const beatHistoryCutoffTimestampMs = sample.timestampMs - BEAT_HISTORY_WINDOW_MS;
    while (merged.length > 1 && merged[0] < beatHistoryCutoffTimestampMs) {
      merged = merged.slice(1);
    }

    const rawRrMeasurements = buildRrMeasurements(merged);
    const pulseRrMeasurements = buildPulseRrMeasurements(rawRrMeasurements);
    const hrvRrMeasurements = buildHrvRrMeasurements(rawRrMeasurements);

    const pulseWindow = selectRrWindow(pulseRrMeasurements, sample.timestampMs, PULSE_WINDOW_MS);
    const rmssdWindow = selectRrWindow(hrvRrMeasurements, sample.timestampMs, RMSSD_WINDOW_MS);
    const latestBeatTimestampMs = merged[merged.length - 1] ?? 0;
    const hasFreshBeat = latestBeatTimestampMs > 0 && sample.timestampMs - latestBeatTimestampMs <= BEAT_STALE_TIMEOUT_MS;

    const rawPulseRateBpm =
      pulseWindow.intervalsMs.length >= 4
        ? calculatePulseRateBpmMedian(pulseWindow.intervalsMs)
        : calculatePulseRateBpm(pulseWindow.intervalsMs);
    let rawRmssdMs = 0;
    let rawBaevskyStressIndexRaw = 0;
    let rawStressIndex = 0;
    const pulseMedianRrMs = median(pulseWindow.intervalsMs);
    const pulseRrJitterMs = median(
      pulseWindow.intervalsMs.map((intervalMs) => Math.abs(intervalMs - pulseMedianRrMs)),
    );

    const recentlyTracking = this.lastTrackingTimestampMs > 0 &&
      sample.timestampMs - this.lastTrackingTimestampMs < 2_000;
    const effectiveQualityThreshold = recentlyTracking
      ? QUALITY_HYSTERESIS_DROP
      : STABLE_LOCK_QUALITY_THRESHOLD;
    const pulseWindowLooksCoherent =
      pulseWindow.intervalsMs.length >= PULSE_MIN_RR_COUNT &&
      pulseMedianRrMs > 0 &&
      pulseRrJitterMs <= Math.max(110, pulseMedianRrMs * 0.2);
    const hasValidRrPulse =
      rawPulseRateBpm >= this.config.minPulseBpm &&
      rawPulseRateBpm <= this.config.maxPulseBpm &&
      pulseWindowLooksCoherent &&
      hasFreshBeat &&
      fingerDetected &&
      signalQuality >= effectiveQualityThreshold;

    let pulseLockState: PulseLockState = "searching";
    let pulseLockConfidence = 0;
    let pulseRateBpm = 0;
    let rmssdMs = 0;
    let baevskyStressIndexRaw = 0;
    let stressIndex = 0;
    let hrvConfidence = 0;
    let effectiveRrIntervalsMs: number[] = [];
    let stressReady = false;
    let stressWindowSeconds = calculateWindowProgressSeconds(this.metricsWarmingElapsedMs, STRESS_FAST_WINDOW_MS);
    let stressTier: StressReadinessTier = "warming";
    let pulseReady = false;
    let rmssdReady = false;

    if (hasValidRrPulse) {
      pulseRateBpm = rawPulseRateBpm;
      this.lockedPulseRateBpm = pulseRateBpm;
      this.lastStableSignalQuality = signalQuality;
      this.lastStableTimestampMs = sample.timestampMs;
      this.lastTrackingTimestampMs = sample.timestampMs;
      this.lastStablePulseRrIntervalsMs = pulseWindow.intervalsMs;
      this.phasePeriodMs = 60_000 / pulseRateBpm;
      this.phaseAnchorTimestampMs = merged[merged.length - 1] ?? sample.timestampMs;
      pulseLockState = "tracking";
      const rhythmConsistencyScore = 1 - clamp(
        pulseRrJitterMs / Math.max(110, pulseMedianRrMs * 0.18),
        0,
        1,
      );
      pulseLockConfidence = clamp(
        signalQuality * 0.45 +
          scoreRange(pulseWindow.intervalsMs.length, PULSE_MIN_RR_COUNT, 10) * 0.25 +
          rhythmConsistencyScore * 0.3,
        0,
        1,
      );
    } else {
      const msSinceStable = sample.timestampMs - this.lastStableTimestampMs;
      const holdConfidence = 1 - clamp(msSinceStable / PULSE_LOCK_HOLD_MS, 0, 1);

      if (
        this.lockedPulseRateBpm > 0 &&
        holdConfidence > 0 &&
        this.lastStableTimestampMs > 0 &&
        fingerPresenceConfidence >= FINGER_PRESENCE_HOLD_THRESHOLD &&
        signalQuality >= HOLD_LOCK_RELEASE_QUALITY
      ) {
        pulseRateBpm = this.lockedPulseRateBpm;
        effectiveRrIntervalsMs =
          this.lastStablePulseRrIntervalsMs.length > 0 ? this.lastStablePulseRrIntervalsMs : rmssdWindow.intervalsMs;
        pulseLockState = "holding";
        pulseLockConfidence = clamp(holdConfidence * 0.7 + signalQuality * 0.2, 0, 1);
      } else {
        this.resetLockedState();
        pulseRateBpm = 0;
      }
    }

    let pulsePhase = amplitude > 0 ? clamp(0.5 + detrendedValue / Math.max(amplitude * 4, 0.001), 0, 1) : 0.5;
    if (this.phasePeriodMs > 0 && pulseRateBpm > 0) {
      const elapsedSinceAnchorMs = Math.max(0, sample.timestampMs - this.phaseAnchorTimestampMs);
      pulsePhase = (elapsedSinceAnchorMs % this.phasePeriodMs) / this.phasePeriodMs;
    }

    if (fingerPresenceConfidence < FINGER_PRESENCE_HOLD_THRESHOLD) {
      pulseLockState = "searching";
      pulseLockConfidence = 0;
      pulseRateBpm = 0;
      rmssdMs = 0;
      baevskyStressIndexRaw = 0;
      stressIndex = 0;
      hrvConfidence = 0;
      stressReady = false;
      stressTier = "warming";
      effectiveRrIntervalsMs = [];
      pulsePhase = 0;
      this.smoothedRmssdDisplayMs = 0;
      this.displayPulseEmaBpm = 0;
    }

    const calibrationWasComplete = this.pulseCalibrationComplete;
    if (
      fingerDetected &&
      this.warmingElapsedMs >= WARMING_PHASE_MS &&
      !this.pulseCalibrationComplete
    ) {
      const goodPairSeen =
        pulseWindow.intervalsMs.length >= 2 &&
        pulseWindow.intervalsMs.slice(-2).every(
          (ms) => ms >= HRV_RR_HARD_MIN_MS && ms <= HRV_RR_HARD_MAX_MS,
        );
      const ve = sample.timestampMs - this.validationWindowStartTimestampMs;
      if (this.validationWindowStartTimestampMs > 0 && ve >= PULSE_SETTLE_MS) {
        const goodEnough =
          this.pulseSettleGoodMsAccum >= PULSE_SETTLE_MS * PULSE_SETTLE_GOOD_FRAC &&
          hasValidRrPulse &&
          pulseLockState === "tracking";
        if (goodEnough) {
          this.pulseCalibrationComplete = true;
        } else {
          this.beatTimestampsMs.length = 0;
          this.beatHrvEligible = [];
          this.pulseSettleGoodMsAccum = 0;
          this.validationWindowStartTimestampMs = sample.timestampMs;
        }
      } else if (hasValidRrPulse && pulseLockState === "tracking" && goodPairSeen) {
        this.pulseSettleGoodMsAccum += frameDeltaMs;
      } else {
        this.pulseSettleGoodMsAccum = 0;
      }
    }

    this.syncBeatEligibilityFromMerged(merged, pulseLockState, prevBeats, prevEligible);

    if (!calibrationWasComplete && this.pulseCalibrationComplete) {
      this.hrvValidBeatTimestampsMs.length = 0;
      this.hrvAccumulationStartTimestampMs = sample.timestampMs;
    }

    this.appendNewHrvValidBeats(merged, sample.timestampMs);

    const hrvUnlocked =
      this.pulseCalibrationComplete &&
      fingerDetected &&
      fingerPresenceConfidence >= FINGER_PRESENCE_HOLD_THRESHOLD;
    const qualityOk = signalQuality >= HRV_QUALITY_THRESHOLD;
    const practiceHrv = hrvUnlocked
      ? computePracticeHrvMetrics(this.hrvValidBeatTimestampsMs)
      : {
          tier: "none" as const,
          validBeatCount: 0,
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

    if (hrvUnlocked && qualityOk) {
      this.lastPracticeHrvWhileFinger = practiceHrv;
    }

    if (
      hrvUnlocked &&
      qualityOk &&
      this.hrvValidBeatTimestampsMs.length >= HRV_LATCH_INITIAL_AFTER_BEATS &&
      this.hrvLatchedInitialRmssdMs <= 0
    ) {
      const p = practiceHrv;
      this.hrvLatchedInitialRmssdMs = p.initialRmssdMs > 0 ? p.initialRmssdMs : p.rmssdMs;
      this.hrvLatchedInitialStressPercent =
        p.initialStressPercent > 0 ? p.initialStressPercent : p.stressPercent;
      this.hrvLatchedInitialStressRaw = p.initialStressRaw > 0 ? p.initialStressRaw : p.stressRaw;
    }

    rawRmssdMs = practiceHrv.rmssdMs;
    rawBaevskyStressIndexRaw = practiceHrv.stressRaw;
    rawStressIndex = practiceHrv.stressPercent;
    effectiveRrIntervalsMs = [];

    const hrvEligibleBeatCount = this.hrvValidBeatTimestampsMs.length;
    const hrvExtrapolatedBeatCount = this.beatHrvEligible.filter((ok) => !ok).length;

    const targetRmssdRaw = practiceHrv.rmssdMs;

    const hasDisplayablePulse =
      fingerDetected &&
      this.pulseCalibrationComplete &&
      pulseRateBpm >= this.config.minPulseBpm &&
      pulseRateBpm <= this.config.maxPulseBpm &&
      (pulseLockState === "tracking" || pulseLockState === "holding");

    if (hasDisplayablePulse) {
      pulseReady = true;
      this.pulseLostSinceMs = 0;
      if (!this.pulseEstablished) {
        this.metricsWarmingElapsedMs = 0;
      }
      this.metricsWarmingElapsedMs += frameDeltaMs;
      this.pulseEstablished = true;
    } else {
      if (this.pulseEstablished) {
        if (this.pulseLostSinceMs === 0) {
          this.pulseLostSinceMs = sample.timestampMs;
        }
        if (sample.timestampMs - this.pulseLostSinceMs < METRICS_RESET_GRACE_MS) {
          pulseReady = true;
        } else {
          this.metricsWarmingElapsedMs = 0;
          this.pulseEstablished = false;
          this.pulseLostSinceMs = 0;
        }
      }
    }

    rmssdReady = practiceHrv.showRmssd && qualityOk;
    stressReady = practiceHrv.showStress && qualityOk;

    const hasReliableHrv = practiceHrv.showRmssd && qualityOk && hrvUnlocked;

    if (hasReliableHrv) {
      const targetRmssdForDisplay = practiceHrv.showInitialFinal
        ? (practiceHrv.finalRmssdMs > 0 ? practiceHrv.finalRmssdMs : practiceHrv.rmssdMs)
        : targetRmssdRaw;
      const rmssdDisplayAlpha = 1 - Math.exp(-frameDeltaMs / HRV_RMSSD_DISPLAY_TAU_MS);
      this.smoothedRmssdDisplayMs =
        this.smoothedRmssdDisplayMs <= 0
          ? targetRmssdForDisplay
          : blendTowards(this.smoothedRmssdDisplayMs, targetRmssdForDisplay, rmssdDisplayAlpha);
      rmssdMs = this.smoothedRmssdDisplayMs;
      effectiveRrIntervalsMs = [];
      this.lastStableHrvTimestampMs = sample.timestampMs;
      this.lastStableHrvRrIntervalsMs = [];
      this.lastStableHrvRmssdMs = rmssdMs;
      hrvConfidence = clamp(
        0.56 +
          signalQuality * 0.18 +
          Math.min(practiceHrv.validBeatCount / HRV_TIER_MAX_BEATS, 1) * 0.22 +
          (practiceHrv.showStress ? 0.14 : 0),
        0,
        practiceHrv.showInitialFinal ? 0.92 : 1,
      );
    } else if (
      this.lastStableHrvTimestampMs > 0 &&
      (pulseLockState === "tracking" || pulseLockState === "holding")
    ) {
      const msSinceStableHrv = sample.timestampMs - this.lastStableHrvTimestampMs;
      const hrvHoldConfidence = 1 - clamp(msSinceStableHrv / HRV_HOLD_MS, 0, 1);
      if (hrvHoldConfidence > 0) {
        rmssdMs = this.lastStableHrvRmssdMs;
        effectiveRrIntervalsMs = this.lastStableHrvRrIntervalsMs;
        hrvConfidence = clamp(hrvHoldConfidence * 0.82 + signalQuality * 0.12, 0, 1);
      }
    }

    if (practiceHrv.showStress && hrvUnlocked && qualityOk) {
      if (practiceHrv.showInitialFinal) {
        const finalRaw =
          practiceHrv.finalStressRaw > 0 ? practiceHrv.finalStressRaw : practiceHrv.stressRaw;
        const finalPct =
          practiceHrv.finalStressPercent > 0 ? practiceHrv.finalStressPercent : practiceHrv.stressPercent;
        const stressDisplayAlpha = 1 - Math.exp(-frameDeltaMs / HRV_STRESS_DISPLAY_TAU_MS);
        baevskyStressIndexRaw = blendTowards(
          this.lastStableHrvBaevskyStressIndexRaw,
          finalRaw,
          stressDisplayAlpha,
        );
        stressIndex = blendTowards(this.lastStableHrvStressIndex, finalPct, stressDisplayAlpha);
      } else {
        const stressBlend = this.lastStableStressTimestampMs > 0 ? 0.16 : 1;
        baevskyStressIndexRaw = blendTowards(
          this.lastStableHrvBaevskyStressIndexRaw,
          practiceHrv.stressRaw,
          stressBlend,
        );
        stressIndex = blendTowards(this.lastStableHrvStressIndex, practiceHrv.stressPercent, stressBlend);
      }
      stressWindowSeconds = RMSSD_WINDOW_MS / 1000;
      stressTier =
        practiceHrv.tier === "beats_180_plus" || practiceHrv.tier === "beats_90_119"
          ? "stable90"
          : practiceHrv.tier === "none"
            ? "warming"
            : "fast60";
      this.lastStableHrvBaevskyStressIndexRaw = baevskyStressIndexRaw;
      this.lastStableHrvStressIndex = stressIndex;
      this.lastStableStressTimestampMs = sample.timestampMs;
      this.lastStableStressWindowSeconds = stressWindowSeconds;
      this.lastStableStressTier = stressTier;
    } else if (
      this.lastStableStressTimestampMs > 0 &&
      (pulseLockState === "tracking" || pulseLockState === "holding")
    ) {
      const msSinceStableStress = sample.timestampMs - this.lastStableStressTimestampMs;
      const stressHoldConfidence = 1 - clamp(msSinceStableStress / STRESS_HOLD_MS, 0, 1);
      if (stressHoldConfidence > 0) {
        baevskyStressIndexRaw = this.lastStableHrvBaevskyStressIndexRaw;
        stressIndex = this.lastStableHrvStressIndex;
        stressReady = true;
        stressWindowSeconds = this.lastStableStressWindowSeconds;
        stressTier = this.lastStableStressTier;
      }
    }

    let pulseRateBpmDisplay = pulseRateBpm;
    if (pulseRateBpm > 0 && fingerDetected) {
      this.displayPulseEmaBpm = this.displayPulseEmaBpm <= 0
        ? pulseRateBpm
        : blendTowards(this.displayPulseEmaBpm, pulseRateBpm, 0.11);
      pulseRateBpmDisplay = this.displayPulseEmaBpm;
    } else {
      this.displayPulseEmaBpm = 0;
    }

    const signalStatus = deriveSignalStatus(
      signalQuality,
      pulseRateBpmDisplay,
      this.config,
      pulseLockState,
      fingerDetected,
    );

    const opticalSamples: OpticalSignalSample[] = this.samples.slice(-MAX_RENDER_SAMPLES).map((point) => ({
      timestampMs: point.timestampMs,
      channel: "redMean",
      value: point.opticalValue,
      quality: point.quality,
    }));

    if (
      !fingerDetected &&
      this.prevFingerDetected &&
      this.pulseCalibrationComplete &&
      this.hrvValidBeatTimestampsMs.length >= HRV_MIN_VALID_BEATS_FOR_METRICS &&
      this.lastPracticeHrvWhileFinger &&
      this.lastPracticeHrvWhileFinger.validBeatCount >= HRV_MIN_VALID_BEATS_FOR_METRICS
    ) {
      const p = this.lastPracticeHrvWhileFinger;
      this.hrvSessionEndCaptured = true;
      if (p.showInitialFinal) {
        this.hrvSessionEndInitialRmssdMs =
          this.hrvLatchedInitialRmssdMs > 0 ? this.hrvLatchedInitialRmssdMs : p.initialRmssdMs;
        this.hrvSessionEndFinalRmssdMs = p.finalRmssdMs > 0 ? p.finalRmssdMs : p.rmssdMs;
        this.hrvSessionEndInitialStressIndex =
          this.hrvLatchedInitialStressPercent > 0
            ? this.hrvLatchedInitialStressPercent
            : p.initialStressPercent;
        this.hrvSessionEndFinalStressIndex =
          p.finalStressPercent > 0 ? p.finalStressPercent : p.stressPercent;
      } else {
        this.hrvSessionEndInitialRmssdMs = p.rmssdMs;
        this.hrvSessionEndFinalRmssdMs = p.rmssdMs;
        this.hrvSessionEndInitialStressIndex = p.stressPercent;
        this.hrvSessionEndFinalStressIndex = p.stressPercent;
      }
    }
    this.prevFingerDetected = fingerDetected;

    return {
      timestampMs: sample.timestampMs,
      sampleCount: this.samples.length,
      signalStatus,
      signalQuality,
      fingerDetected,
      fingerPresenceConfidence,
      pulseReady,
      pulseCalibrationComplete: this.pulseCalibrationComplete,
      pulseWindowSeconds: this.pulseCalibrationComplete
        ? (WARMING_PHASE_MS + PULSE_SETTLE_MS) / 1000
        : this.warmingElapsedMs < WARMING_PHASE_MS
          ? this.warmingElapsedMs / 1000
          : WARMING_PHASE_MS / 1000 +
            Math.min(
              Math.max(0, sample.timestampMs - this.validationWindowStartTimestampMs),
              PULSE_SETTLE_MS,
            ) /
              1000,
      pulseLockState,
      pulseLockConfidence,
      rawPulseRateBpm,
      rmssdReady,
      rmssdWindowSeconds: calculateWindowProgressSeconds(this.metricsWarmingElapsedMs, RMSSD_WINDOW_MS),
      rawRmssdMs,
      hrvConfidence,
      stressReady,
      stressWindowSeconds,
      stressTier,
      opticalValue,
      fingerContactElapsedMs: this.warmingElapsedMs,
      baseline,
      detrendedValue,
      ppgBandpassedValue: detrendedForPeaks[detrendedForPeaks.length - 1] ?? 0,
      pulseRateBpm: pulseRateBpmDisplay,
      breathRateBpm: 0,
      pulsePhase,
      breathPhase: 0,
      rmssdMs,
      baevskyStressIndexRaw,
      stressIndex,
      rrIntervalsMs: effectiveRrIntervalsMs,
      beatTimestampsMs: merged,
      rawRrIntervalsMs: rawRrMeasurements.map((measurement) => measurement.intervalMs),
      medianRrMs: pulseMedianRrMs,
      rawBaevskyStressIndexRaw,
      detectedBeatCount: this.beatTimestampsMs.length,
      candidatePeakCount: peakDetection.candidatePeaks.length,
      acceptedPeakCount: peakDetection.acceptedPeaks.length,
      rejectedPeakCount: peakDetection.rejectedPeaks.length,
      candidatePeaks: peakDetection.candidatePeaks,
      acceptedPeaks: peakDetection.acceptedPeaks,
      rejectedPeaks: peakDetection.rejectedPeaks,
      opticalSamples,
      redMean: sample.redMean,
      greenMean: sample.greenMean,
      blueMean: sample.blueMean,
      lumaMean: sample.lumaMean,
      redDominance: sample.redDominance,
      darknessRatio: sample.darknessRatio,
      saturationRatio: sample.saturationRatio,
      motion: sample.motion,
      hrvEligibleBeatCount,
      hrvExtrapolatedBeatCount,
      hrvMinDisplayEligibleBeats: HRV_MIN_VALID_BEATS_FOR_METRICS,
      hrvMinFullEligibleBeats: HRV_TIER_MAX_BEATS,
      hrvPracticeTier: practiceHrv.tier,
      hrvRmssdApproximate: practiceHrv.rmssdApproximate,
      hrvStressApproximate: practiceHrv.stressApproximate,
      hrvShowInitialFinal: practiceHrv.showInitialFinal,
      hrvInitialRmssdMs:
        this.hrvLatchedInitialRmssdMs > 0 ? this.hrvLatchedInitialRmssdMs : practiceHrv.initialRmssdMs,
      hrvInitialStressIndex:
        this.hrvLatchedInitialStressPercent > 0
          ? this.hrvLatchedInitialStressPercent
          : practiceHrv.initialStressPercent,
      hrvFinalRmssdMs: practiceHrv.finalRmssdMs,
      hrvFinalStressIndex: practiceHrv.finalStressPercent,
      hrvSessionEndCaptured: this.hrvSessionEndCaptured,
      hrvSessionEndInitialRmssdMs: this.hrvSessionEndInitialRmssdMs,
      hrvSessionEndFinalRmssdMs: this.hrvSessionEndFinalRmssdMs,
      hrvSessionEndInitialStressIndex: this.hrvSessionEndInitialStressIndex,
      hrvSessionEndFinalStressIndex: this.hrvSessionEndFinalStressIndex,
    };
  }

  /**
   * Снимок для экспорта: «классический» RMSSD по RR (без Хампеля) vs полный пайплайн на том же сегменте.
   * Если буфер HRV сейчас пуст (например после «Новый замер» или долгого сброса), но ранее был успешный расчёт —
   * возвращается **кэш** с `exportSource: "cached"`.
   */
  getPracticeRmssdHampelDiagnostics(): PracticeRmssdHampelDiagnostics | null {
    const n = this.hrvValidBeatTimestampsMs.length;
    const canCompute =
      this.pulseCalibrationComplete && n >= HRV_MIN_VALID_BEATS_FOR_METRICS;
    if (canCompute) {
      const d = computePracticeRmssdHampelDiagnostics(this.hrvValidBeatTimestampsMs);
      if (d) {
        this.lastRmssdHampelDiagnostics = { ...d, exportSource: "live" };
        return this.lastRmssdHampelDiagnostics;
      }
    }
    if (this.lastRmssdHampelDiagnostics) {
      return {
        ...this.lastRmssdHampelDiagnostics,
        exportedAtMs: Date.now(),
        exportSource: "cached",
      };
    }
    return null;
  }
}

export function toFingerBiofeedbackFrame(snapshot: FingerSignalSnapshot): BiofeedbackFrame {
  return {
    timestampMs: snapshot.timestampMs,
    source: "fingerCamera",
    signalStatus: snapshot.signalStatus,
    signalQuality: snapshot.signalQuality,
    pulsePhase: snapshot.pulsePhase,
    pulseRateBpm: snapshot.pulseRateBpm,
    breathPhase: snapshot.breathPhase,
    breathRateBpm: snapshot.breathRateBpm,
    rmssdMs: snapshot.rmssdMs,
    baevskyStressIndexRaw: snapshot.baevskyStressIndexRaw,
    stressIndex: snapshot.stressIndex,
    rrIntervalsMs: snapshot.rrIntervalsMs,
  };
}
