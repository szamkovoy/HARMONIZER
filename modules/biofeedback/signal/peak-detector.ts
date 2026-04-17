/**
 * Пиковый детектор: ищет локальные максимумы на сглаженном детрендированном сигнале,
 * фильтрует по высоте, prominence, краевой зоне и refractory period.
 *
 * Извлечено из `modules/biofeedback/core/finger-analysis.ts`. Формула не изменена.
 */

import {
  MIN_ACCEPTED_PEAK_PROMINENCE,
  MIN_ACCEPTED_PEAK_VALUE,
  PARABOLIC_PEAK_DELTA_MAX_SAMPLES,
  PEAK_EDGE_MARGIN_MS,
  PEAK_PROMINENCE_WINDOW_MS,
} from "@/modules/biofeedback/constants";
import type { AnalyzerPoint } from "@/modules/biofeedback/signal/optical-pipeline";
import {
  calculateRobustScale,
  percentile,
} from "@/modules/biofeedback/signal/optical-pipeline";
import type {
  BiofeedbackCaptureConfig,
  FingerPeakDiagnostic,
} from "@/modules/biofeedback/core/types";

export interface PeakDetectionResult {
  candidatePeaks: FingerPeakDiagnostic[];
  acceptedPeaks: FingerPeakDiagnostic[];
  rejectedPeaks: FingerPeakDiagnostic[];
  beatTimestampsMs: number[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Параболическая интерполяция: уточнение времени пика по трём отсчётам. */
export function refinePeakTimestampMs(
  peakSampleIndex: number,
  detrendedValues: readonly number[],
  samples: readonly AnalyzerPoint[],
): number {
  const i = peakSampleIndex;
  const n = detrendedValues.length;
  if (i <= 0 || i >= n - 1) {
    return samples[i]!.timestampMs;
  }
  const sn = detrendedValues[i]!;
  const sm = detrendedValues[i - 1]!;
  const sp = detrendedValues[i + 1]!;
  const denom = sm - 2 * sn + sp;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) {
    return samples[i]!.timestampMs;
  }
  const delta = (0.5 * (sm - sp)) / denom;
  const clampedDelta = clamp(
    delta,
    -PARABOLIC_PEAK_DELTA_MAX_SAMPLES,
    PARABOLIC_PEAK_DELTA_MAX_SAMPLES,
  );
  const dtLeft = samples[i]!.timestampMs - samples[i - 1]!.timestampMs;
  const dtRight = samples[i + 1]!.timestampMs - samples[i]!.timestampMs;
  const avgDtMs = (dtLeft + dtRight) / 2;
  if (avgDtMs <= 0 || !Number.isFinite(avgDtMs)) {
    return samples[i]!.timestampMs;
  }
  return samples[i]!.timestampMs + clampedDelta * avgDtMs;
}

/**
 * Базовый детектор пиков. Не stateful — принимает массив сэмплов и сглаженных значений
 * и выдаёт три списка пиков (candidate / accepted / rejected) + список меток ударов.
 */
export function detectBeats(
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
  const prominenceWindowSamples = Math.max(
    2,
    Math.round((fps * PEAK_PROMINENCE_WINDOW_MS) / 1000),
  );
  const refractoryMs = Math.max(280, 60_000 / config.maxPulseBpm);
  const localMaxima: Array<{
    sampleIndex: number;
    timestampMs: number;
    value: number;
    prominence: number;
  }> = [];

  for (let i = 1; i < N - 1; i += 1) {
    if (
      !(
        detrendedValues[i]! > detrendedValues[i - 1]! &&
        detrendedValues[i]! >= detrendedValues[i + 1]!
      )
    ) {
      continue;
    }

    const leftStart = Math.max(0, i - prominenceWindowSamples);
    const rightEnd = Math.min(N - 1, i + prominenceWindowSamples);
    let leftMin = detrendedValues[leftStart]!;
    let rightMin = detrendedValues[i]!;
    for (let j = leftStart; j <= i; j += 1) {
      leftMin = Math.min(leftMin, detrendedValues[j]!);
    }
    for (let j = i; j <= rightEnd; j += 1) {
      rightMin = Math.min(rightMin, detrendedValues[j]!);
    }

    localMaxima.push({
      sampleIndex: i,
      timestampMs: samples[i]!.timestampMs,
      value: detrendedValues[i]!,
      prominence: detrendedValues[i]! - Math.max(leftMin, rightMin),
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
  const positiveValues = localMaxima.map((p) => p.value).filter((v) => v > 0);
  const positiveProminences = localMaxima.map((p) => p.prominence).filter((v) => v > 0);
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
  const acceptedByWindow: Array<{
    diagnostic: FingerPeakDiagnostic;
    timestampMs: number;
  }> = [];

  for (const peak of localMaxima) {
    const candidate: FingerPeakDiagnostic = {
      sampleIndex: peak.sampleIndex,
      timestampMs: peak.timestampMs,
      value: peak.value,
      prominence: peak.prominence,
      reasonCode: "accepted",
    };
    candidatePeaks.push(candidate);

    if (
      peak.sampleIndex <= edgeMarginSamples ||
      peak.sampleIndex >= N - 1 - edgeMarginSamples
    ) {
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
