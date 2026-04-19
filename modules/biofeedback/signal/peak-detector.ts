/**
 * Пиковый детектор: ищет локальные максимумы на сглаженном детрендированном сигнале,
 * фильтрует по высоте, prominence, краевой зоне и refractory period.
 *
 * Извлечено из `modules/biofeedback/core/finger-analysis.ts`. Формула не изменена.
 */

import {
  DICROTIC_ADAPTIVE_REFRACTORY_FRAC,
  DICROTIC_POST_FILTER_FRACTION,
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
  /** Статический refractory, применявшийся на старте окна (мс). Для диагностики. */
  refractoryMsStatic: number;
  /** Самый свежий адаптивный refractory на конец окна (мс). 0 если адаптация не сработала. */
  refractoryMsAdaptive: number;
  /** Медианный RR по принятым пикам окна (мс). 0 если ударов <3. */
  medianRrMsInWindow: number;
  /** Сколько пиков отбраковано как дикротические (post-filter). */
  dicroticRejectedCount: number;
  /** Сколько пиков отбраковано как split-artifact (короткий+длинный ~= один RR). */
  splitArtifactRejectedCount: number;
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

/** Медиана RR по последним N принятым пикам (мс). 0, если пиков <3. */
function computeRecentMedianRrMs(
  accepted: readonly { timestampMs: number }[],
  windowRr: number = 8,
): number {
  if (accepted.length < 3) return 0;
  const rr: number[] = [];
  const start = Math.max(1, accepted.length - windowRr);
  for (let i = start; i < accepted.length; i += 1) {
    rr.push(accepted[i]!.timestampMs - accepted[i - 1]!.timestampMs);
  }
  if (rr.length === 0) return 0;
  const sorted = [...rr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Пост-фильтр дикротических зубцов: если RR < `DICROTIC_POST_FILTER_FRACTION × medianRr`,
 * удаляется пик с меньшей `prominence`. Иногда дикротик слабее главного пика, иногда
 * наоборот — поэтому всегда удаляем более слабый из пары.
 *
 * Работает по месту: модифицирует `accepted`, добавляет в `rejectedPeaks`, возвращает
 * число удалённых пиков.
 */
function removeDicroticPeaks(
  accepted: { diagnostic: FingerPeakDiagnostic; timestampMs: number }[],
  rejectedPeaks: FingerPeakDiagnostic[],
  medianRrMs: number,
): number {
  if (medianRrMs <= 0 || accepted.length < 2) return 0;
  const minRrAllowedMs = medianRrMs * DICROTIC_POST_FILTER_FRACTION;
  let removed = 0;
  let i = 1;
  while (i < accepted.length) {
    const prev = accepted[i - 1]!;
    const cur = accepted[i]!;
    const rr = cur.timestampMs - prev.timestampMs;
    if (rr < minRrAllowedMs) {
      if (cur.diagnostic.prominence <= prev.diagnostic.prominence) {
        rejectedPeaks.push({ ...cur.diagnostic, reasonCode: "dicrotic_notch" });
        accepted.splice(i, 1);
      } else {
        rejectedPeaks.push({ ...prev.diagnostic, reasonCode: "dicrotic_notch" });
        accepted.splice(i - 1, 1);
        if (i > 1) i -= 1;
      }
      removed += 1;
    } else {
      i += 1;
    }
  }
  return removed;
}

function medianOfIntervals(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Убирает «расщеплённый» удар: ложный внутренний пик делит один нормальный RR на пару
 * `короткий + длинный`, при этом их сумма близка к локальной медиане RR.
 *
 * Это именно тот паттерн, который мы видим в реальных экспортируемых рядах:
 *   418 + 655 ≈ 1073, 553 + 556 ≈ 1109, 420 + 748 ≈ 1168 …
 * Live BPM его переживает (sequential filter), но сырой merged-ряд получает лишний beat,
 * из-за чего coherence/hrv начинают считать 30–60 % suspicious RR.
 */
function removeSplitArtifactPeaks(
  accepted: { diagnostic: FingerPeakDiagnostic; timestampMs: number }[],
  rejectedPeaks: FingerPeakDiagnostic[],
): number {
  if (accepted.length < 3) return 0;
  let removed = 0;
  let i = 1;
  while (i < accepted.length - 1) {
    const recentIntervals: number[] = [];
    for (let k = Math.max(1, i - 8); k < i; k += 1) {
      const rr = accepted[k]!.timestampMs - accepted[k - 1]!.timestampMs;
      if (rr >= 500 && rr <= 1_500) {
        recentIntervals.push(rr);
      }
    }
    if (recentIntervals.length === 0) {
      i += 1;
      continue;
    }
    const medianRrMs = medianOfIntervals(recentIntervals);
    const rrShort = accepted[i]!.timestampMs - accepted[i - 1]!.timestampMs;
    const rrLong = accepted[i + 1]!.timestampMs - accepted[i]!.timestampMs;
    const pairSum = rrShort + rrLong;
    const shortEnough = rrShort < medianRrMs * 0.72;
    const pairMatchesNormal = Math.abs(pairSum - medianRrMs) <= Math.max(140, medianRrMs * 0.22);
    if (medianRrMs > 0 && shortEnough && pairMatchesNormal) {
      rejectedPeaks.push({
        ...accepted[i]!.diagnostic,
        timestampMs: accepted[i]!.timestampMs,
        reasonCode: "split_artifact",
      });
      accepted.splice(i, 1);
      removed += 1;
      if (i > 1) i -= 1;
      continue;
    }
    i += 1;
  }
  return removed;
}

/**
 * Базовый детектор пиков. Не stateful — принимает массив сэмплов и сглаженных значений
 * и выдаёт три списка пиков (candidate / accepted / rejected) + список меток ударов.
 *
 * Фильтрация в 2 прохода:
 *   1) стандартный отбор (edge / height / prominence) + **адаптивный refractory** —
 *      минимальный интервал между принятыми пиками равен `max(refractoryStatic,
 *      DICROTIC_ADAPTIVE_REFRACTORY_FRAC × median(RR))`, где median(RR) считается
 *      по скользящему окну уже принятых пиков;
 *   2) **post-filter дикротических зубцов**: в парах соседних пиков с RR < 55%
 *      медианного RR удаляется пик с меньшей `prominence` (см. `removeDicroticPeaks`).
 *
 * Вместе эти шаги устраняют типичный артефакт «каждый удар засчитывается дважды»,
 * который в старой версии проявлялся как `rrBadFraction` 30–40% на чистом сигнале.
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
      refractoryMsStatic: 0,
      refractoryMsAdaptive: 0,
      medianRrMsInWindow: 0,
      dicroticRejectedCount: 0,
      splitArtifactRejectedCount: 0,
    };
  }

  const edgeMarginSamples = Math.max(2, Math.round((fps * PEAK_EDGE_MARGIN_MS) / 1000));
  const prominenceWindowSamples = Math.max(
    2,
    Math.round((fps * PEAK_PROMINENCE_WINDOW_MS) / 1000),
  );
  const refractoryMsStatic = Math.max(280, 60_000 / config.maxPulseBpm);
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
      refractoryMsStatic,
      refractoryMsAdaptive: 0,
      medianRrMsInWindow: 0,
      dicroticRejectedCount: 0,
      splitArtifactRejectedCount: 0,
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
    const recentMedianRr = computeRecentMedianRrMs(acceptedByWindow);
    const dynamicRefractoryMs =
      recentMedianRr > 0
        ? Math.max(refractoryMsStatic, recentMedianRr * DICROTIC_ADAPTIVE_REFRACTORY_FRAC)
        : refractoryMsStatic;
    if (lastAccepted && peak.timestampMs - lastAccepted.timestampMs < dynamicRefractoryMs) {
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

  // Post-filter: удалить дикротические зубцы, проскочившие через адаптивный refractory
  // (например, первые 2–3 удара окна, где median RR ещё не вычисляется).
  const medianRrMsInWindow = computeRecentMedianRrMs(acceptedByWindow, 12);
  const dicroticRejectedCount = removeDicroticPeaks(
    acceptedByWindow,
    rejectedPeaks,
    medianRrMsInWindow,
  );

  const refractoryMsAdaptive =
    medianRrMsInWindow > 0
      ? Math.max(refractoryMsStatic, medianRrMsInWindow * DICROTIC_ADAPTIVE_REFRACTORY_FRAC)
      : 0;

  const refinedAccepted: Array<{
    diagnostic: FingerPeakDiagnostic;
    timestampMs: number;
  }> = [];
  for (const item of acceptedByWindow) {
    const refinedMs = refinePeakTimestampMs(
      item.diagnostic.sampleIndex,
      detrendedValues,
      samples,
    );
    refinedAccepted.push({
      diagnostic: {
        ...item.diagnostic,
        timestampMs: refinedMs,
      },
      timestampMs: refinedMs,
    });
  }

  const splitArtifactRejectedCount = removeSplitArtifactPeaks(
    refinedAccepted,
    rejectedPeaks,
  );

  for (const item of refinedAccepted) {
    acceptedPeaks.push(item.diagnostic);
  }

  return {
    candidatePeaks,
    acceptedPeaks,
    rejectedPeaks,
    beatTimestampsMs: acceptedPeaks.map((peak) => peak.timestampMs),
    refractoryMsStatic,
    refractoryMsAdaptive,
    medianRrMsInWindow,
    dicroticRejectedCount,
    splitArtifactRejectedCount,
  };
}
