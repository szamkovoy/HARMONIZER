import {
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_BEAT_DEDUPE_MS,
  COHERENCE_ENTRY_THRESHOLD_PERCENT,
  COHERENCE_MASTER_RATIO,
  COHERENCE_MAX_INSUFFICIENT_SECONDS_FRAC,
  COHERENCE_MIN_VALID_SECONDS_FOR_METRICS,
  COHERENCE_STRETCH_EXPONENT,
  COHERENCE_WINDOW_MIN_COVERAGE_FRAC,
  ENTRY_STABILITY_SECONDS,
  PWIN_HALF_WIDTH_HZ,
  PWIN_SEARCH_MAX_HZ,
  PWIN_SEARCH_MIN_HZ,
  PRODUCTION_WINDOW_SECONDS,
  PRODUCTION_WINDOW_SKIP_SECONDS,
  PTOTAL_MAX_HZ,
  PTOTAL_MIN_HZ,
  RR_ARTIFACT_DEVIATION,
  RR_COHERENCE_HARD_WITHHOLD_FRACTION,
  RR_COHERENCE_WARN_FRACTION,
  RSA_CYCLE_MIN_BPM,
  SMOOTH_WINDOW_SECONDS,
  TACHO_SAMPLE_RATE_HZ,
  TEST120_WINDOW_SECONDS,
  TEST120_WINDOW_SKIP_SECONDS,
} from "@/modules/breath/core/coherence-constants";
import { fftRadix2, nextPow2, powerSpectrumMagnitudeSq } from "@/modules/breath/core/fft";
import {
  buildTachogramBpmSeries,
  cleanRrSequenceCoherence,
  type RrBeatEvent,
} from "@/modules/breath/core/tachogram-4hz";

export type BreathAnalysisMode = "production" | "test120s";

export interface CoherenceSessionInput {
  sessionStartedAtMs: number;
  sessionEndedAtMs: number;
  /** Абсолютные метки ударов: окно практики ± буфер QC перед logical start (см. bufferMsBeforeSession). */
  beatTimestampsMs: readonly number[];
  inhaleMs: number;
  exhaleMs: number;
  mode: BreathAnalysisMode;
  /** Включать метки до sessionStartedAtMs для тахограммы (буфер успешного QC, мс). */
  bufferMsBeforeSession?: number;
  /**
   * По секундам практики (индекс 0 = первая секунда после sessionStartedAtMs): true — принудительно BPM = 0
   * (нет контакта / слабый сигнал после порога). Длина ≥ ceil(session duration / 1 с).
   */
  secondBpmForcedZero?: readonly boolean[];
}

export interface CoherenceSecondCheckpoint {
  secondIndex: number;
  wallClockMs: number;
  windowStartMs: number;
  windowEndMs: number;
  windowSeconds: number;
  /** Длина тахограммы после строгой интерполяции (точки с реальными BPM). */
  tachogramSampleCount: number;
  /**
   * Доля окна, покрытая реальными тахограммными точками (0..1).
   * &lt; `COHERENCE_WINDOW_MIN_COVERAGE_FRAC` → окно помечается как insufficientCoverage и
   * coherenceMappedPercent = 0 (для честной агрегации и времени вхождения).
   */
  coverageFraction: number;
  insufficientCoverage: boolean;
  fftSize: number;
  /** До вычитания среднего. */
  bpmMean: number;
  pwin: number;
  ptotal: number;
  coherenceRatio: number;
  coherenceMappedPercent: number;
}

export interface CoherenceSessionResult {
  algorithmVersion: string;
  mode: BreathAnalysisMode;
  sessionDurationSec: number;
  practiceDurationSec: number;
  skipFirstSecondsForAggregate: number;
  windowSeconds: number;
  /** Оценочные метки (короткий тест / укороченное окно FFT). */
  metricsApproximate: boolean;
  /** Метки после фильтра границ сессии, до дедупликации (экспорт для сверки). */
  beatTimestampsMsBeforeDedupe: readonly number[];
  /** Метки, по которым построены RR и тахограмма (дедупликация COHERENCE_BEAT_DEDUPE_MS). */
  beatTimestampsMsAnalyzed: readonly number[];
  coherenceAveragePercent: number | null;
  coherenceMaxPercent: number | null;
  rsaAmplitudeBpm: number | null;
  /** rsaAmplitudeBpm / средний мгновенный пульс (fullTacho.bpm) × 100 %. */
  rsaNormalizedPercent: number | null;
  entryTimeSec: number | null;
  perSecond: CoherenceSecondCheckpoint[];
  perSecondSmoothed: { secondIndex: number; coherenceMappedPercent: number }[];
  rsaCycles: {
    cycleIndex: number;
    startMs: number;
    endMs: number;
    hrMax: number;
    hrMin: number;
    rsaBpm: number;
    inactive: boolean;
  }[];
  warnings: string[];
  /** Секунд практики, где max(BPM) на тахограмме &gt; 0 (после маски). */
  totalValidDataSeconds: number;
  /** Итоговые метрики (кроме длительности) не считаются: мало валидных секунд (test120s). */
  metricsWithheldDueToInsufficientData: boolean;
  exportMeta: Record<string, string | number | boolean | readonly string[]>;
}

/** Сортировка и слияние меток, ближе toleranceMs (жадно к ранней метке в паре). */
export function dedupeBeatTimestampsMs(values: readonly number[], toleranceMs: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! - out[out.length - 1]! > toleranceMs) {
      out.push(sorted[i]!);
    }
  }
  return out;
}

function beatsToEvents(beats: readonly number[]): RrBeatEvent[] {
  const sorted = [...beats].sort((a, b) => a - b);
  const out: RrBeatEvent[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const rr = sorted[i]! - sorted[i - 1]!;
    if (rr > 0) {
      out.push({
        timeMs: (sorted[i]! + sorted[i - 1]!) / 2,
        rrMs: rr,
      });
    }
  }
  return out;
}

function mapCoherenceRatioToPercent(ratio: number): number {
  const clamped = Math.min(1, ratio / COHERENCE_MASTER_RATIO);
  return Math.min(100, 100 * clamped ** COHERENCE_STRETCH_EXPONENT);
}

/** Медианный фильтр по окну `windowSeconds` секунд при частоте 1 выборка/с (п. 8 ТЗ). */
function medianFilter1HzWindowSeconds(values: readonly number[], windowSeconds: number): number[] {
  if (values.length === 0) {
    return [];
  }
  const w = Math.max(1, Math.round(windowSeconds));
  const half = Math.floor(w / 2);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const slice: number[] = [];
    for (let k = i - half; k <= i + half; k += 1) {
      if (k >= 0 && k < values.length) {
        slice.push(values[k]!);
      }
    }
    slice.sort((a, b) => a - b);
    const mid = Math.floor(slice.length / 2);
    out.push(
      slice.length % 2 === 0 ? (slice[mid - 1]! + slice[mid]!) / 2 : slice[mid]!,
    );
  }
  return out;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    return (s[mid - 1]! + s[mid]!) / 2;
  }
  return s[mid]!;
}

const BPM_ZERO_EPS = 0.5;

function applySecondBpmMask(
  timesMs: readonly number[],
  bpm: number[],
  sessionStartedAtMs: number,
  mask: readonly boolean[] | undefined,
): void {
  if (!mask || mask.length === 0) {
    return;
  }
  for (let i = 0; i < timesMs.length; i += 1) {
    const sec = Math.floor((timesMs[i]! - sessionStartedAtMs) / 1000);
    if (sec >= 0 && sec < mask.length && mask[sec]) {
      bpm[i] = 0;
    }
  }
}

/** По каждой секунде практики [sessionStartedAtMs + s*1000, …): есть ли ненулевой BPM после маски. */
function computeHasRealBpmPerSecond(
  timesMs: readonly number[],
  bpm: readonly number[],
  sessionStartedAtMs: number,
  practiceSeconds: number,
): boolean[] {
  const out: boolean[] = new Array(Math.max(0, practiceSeconds)).fill(false);
  for (let i = 0; i < timesMs.length; i += 1) {
    const t = timesMs[i]!;
    const s = Math.floor((t - sessionStartedAtMs) / 1000);
    if (s >= 0 && s < out.length && bpm[i]! > BPM_ZERO_EPS) {
      out[s] = true;
    }
  }
  return out;
}

function countValidDataSeconds(hasReal: readonly boolean[]): number {
  let n = 0;
  for (let i = 0; i < hasReal.length; i += 1) {
    if (hasReal[i]) {
      n += 1;
    }
  }
  return n;
}

function analyzeWindow(
  bpm: readonly number[],
  sampleRateHz: number,
): { pwin: number; ptotal: number; coherenceRatio: number; fftSize: number; bpmMean: number } {
  // Требуем хотя бы пару секунд данных (8 точек при 4 Гц) для формальной возможности FFT;
  // для достоверности 60-с окна дополнительно проверяется покрытие снаружи.
  if (bpm.length < 8) {
    return { pwin: 0, ptotal: 0, coherenceRatio: 0, fftSize: 0, bpmMean: 0 };
  }

  const mean = bpm.reduce((s, v) => s + v, 0) / bpm.length;
  const centered = bpm.map((v) => v - mean);
  const n = nextPow2(centered.length);
  const paddedRe = centered.concat(new Array(n - centered.length).fill(0));
  const { re, im } = fftRadix2(paddedRe, new Array(n).fill(0));
  const power = powerSpectrumMagnitudeSq(re, im);
  const halfBins = power.length;
  const fs = sampleRateHz;
  const hzPerBin = fs / n;

  let ptotal = 0;
  for (let k = 0; k < halfBins; k += 1) {
    const f = k * hzPerBin;
    if (f >= PTOTAL_MIN_HZ && f <= PTOTAL_MAX_HZ) {
      ptotal += power[k]!;
    }
  }

  const searchLo = Math.max(PWIN_SEARCH_MIN_HZ, PTOTAL_MIN_HZ);
  const searchHi = Math.min(PWIN_SEARCH_MAX_HZ, PTOTAL_MAX_HZ);

  let peakK = -1;
  let peakPow = -1;
  for (let k = 0; k < halfBins; k += 1) {
    const f = k * hzPerBin;
    if (f >= searchLo && f <= searchHi && power[k]! > peakPow) {
      peakPow = power[k]!;
      peakK = k;
    }
  }

  let pwin = 0;
  if (peakK >= 0) {
    const fPeak = peakK * hzPerBin;
    const fLo = fPeak - PWIN_HALF_WIDTH_HZ;
    const fHi = fPeak + PWIN_HALF_WIDTH_HZ;
    const bandLo = Math.max(fLo, PTOTAL_MIN_HZ);
    const bandHi = Math.min(fHi, PTOTAL_MAX_HZ);
    for (let k = 0; k < halfBins; k += 1) {
      const f = k * hzPerBin;
      if (f >= bandLo && f <= bandHi) {
        pwin += power[k]!;
      }
    }
  }

  const coherenceRatio = ptotal > 1e-12 ? Math.min(1, pwin / ptotal) : 0;
  return { pwin, ptotal, coherenceRatio, fftSize: n, bpmMean: mean };
}

export function runCoherenceSessionAnalysis(input: CoherenceSessionInput): CoherenceSessionResult {
  const warnings: string[] = [];
  const {
    sessionStartedAtMs,
    sessionEndedAtMs,
    beatTimestampsMs,
    inhaleMs,
    exhaleMs,
    mode,
    bufferMsBeforeSession = 0,
    secondBpmForcedZero,
  } = input;

  const windowSeconds =
    mode === "production" ? PRODUCTION_WINDOW_SECONDS : TEST120_WINDOW_SECONDS;
  const skipAggregateSec =
    mode === "production" ? PRODUCTION_WINDOW_SKIP_SECONDS : TEST120_WINDOW_SKIP_SECONDS;
  const metricsApproximate = false;

  const durationMs = Math.max(0, sessionEndedAtMs - sessionStartedAtMs);
  const practiceDurationSec = durationMs / 1000;

  const beatsInSession = beatTimestampsMs.filter(
    (t) => t >= sessionStartedAtMs - bufferMsBeforeSession - 1 && t <= sessionEndedAtMs + 1,
  );

  const beatsDeduped = dedupeBeatTimestampsMs(beatsInSession, COHERENCE_BEAT_DEDUPE_MS);

  const practiceOnlyBeats = beatsDeduped.filter(
    (t) => t >= sessionStartedAtMs - 1 && t <= sessionEndedAtMs + 1,
  );
  const practiceBeatSpanMs =
    practiceOnlyBeats.length >= 2
      ? Math.max(...practiceOnlyBeats) - Math.min(...practiceOnlyBeats)
      : 0;

  if (beatsDeduped.length < 2) {
    warnings.push(
      "Меньше двух отметок ударов за сессию — метрики когерентности и RSA недоступны (палец, калибровка, плагин кадров).",
    );
  }

  const events = beatsToEvents(beatsDeduped);
  const { cleaned, badFraction } = cleanRrSequenceCoherence(events, RR_ARTIFACT_DEVIATION);
  if (badFraction >= RR_COHERENCE_WARN_FRACTION) {
    warnings.push(
      `Доля подозрительных RR (замена по ${Math.round(RR_ARTIFACT_DEVIATION * 100)}% правилу, средний RR): ${(badFraction * 100).toFixed(1)}%`,
    );
  }

  const fullTacho = buildTachogramBpmSeries(
    cleaned,
    sessionStartedAtMs,
    sessionEndedAtMs,
    TACHO_SAMPLE_RATE_HZ,
  );

  const fullBpm = [...fullTacho.bpm];
  applySecondBpmMask(fullTacho.timesMs, fullBpm, sessionStartedAtMs, secondBpmForcedZero);

  const practiceSecondsInt = Math.floor(practiceDurationSec);
  const hasRealBpmSecond = computeHasRealBpmPerSecond(
    fullTacho.timesMs,
    fullBpm,
    sessionStartedAtMs,
    practiceSecondsInt,
  );
  const totalValidDataSeconds = countValidDataSeconds(hasRealBpmSecond);

  /**
   * Жёсткий withholding метрик — НЕ выводить на UI (кроме длительности),
   * потому что формулы спектра/RMSSD при рваном сигнале дают физически бессмысленные значения.
   * Причины:
   *   1) totalValidDataSeconds < COHERENCE_MIN_VALID_SECONDS_FOR_METRICS — тахограмма почти пустая.
   *   2) badFraction >= RR_COHERENCE_HARD_WITHHOLD_FRACTION — большинство RR заменены на среднее,
   *      т.е. исходный дыхательный ритм в спектре уже не виден.
   */
  const withholdReasons: string[] = [];
  if (mode === "test120s" && totalValidDataSeconds < COHERENCE_MIN_VALID_SECONDS_FOR_METRICS) {
    withholdReasons.push(
      `totalValidDataSeconds=${totalValidDataSeconds} < ${COHERENCE_MIN_VALID_SECONDS_FOR_METRICS}`,
    );
  }
  if (badFraction >= RR_COHERENCE_HARD_WITHHOLD_FRACTION) {
    withholdReasons.push(
      `rrBadFraction=${(badFraction * 100).toFixed(1)}% >= ${Math.round(RR_COHERENCE_HARD_WITHHOLD_FRACTION * 100)}%`,
    );
  }

  const perSecond: CoherenceSecondCheckpoint[] = [];
  const coherenceRawSeries: number[] = [];

  const expectedSamplesPerWindow = windowSeconds * TACHO_SAMPLE_RATE_HZ;
  const minSamplesForCoverage = Math.ceil(
    expectedSamplesPerWindow * COHERENCE_WINDOW_MIN_COVERAGE_FRAC,
  );

  const stepMs = 1000;
  for (let s = 1; s <= Math.floor(practiceDurationSec); s += 1) {
    const wallClockMs = sessionStartedAtMs + s * stepMs;
    const windowEndMs = wallClockMs;
    const windowStartMs = windowEndMs - windowSeconds * 1000;
    const { timesMs, bpm: bpmWin } = buildTachogramBpmSeries(
      cleaned,
      windowStartMs,
      windowEndMs,
      TACHO_SAMPLE_RATE_HZ,
    );
    const bpm = [...bpmWin];
    applySecondBpmMask(timesMs, bpm, sessionStartedAtMs, secondBpmForcedZero);
    const coverageFraction =
      expectedSamplesPerWindow > 0 ? bpm.length / expectedSamplesPerWindow : 0;
    const insufficientCoverage = bpm.length < minSamplesForCoverage;
    let pwin = 0;
    let ptotal = 0;
    let coherenceRatio = 0;
    let fftSize = 0;
    let bpmMean = 0;
    if (!insufficientCoverage) {
      const res = analyzeWindow(bpm, TACHO_SAMPLE_RATE_HZ);
      pwin = res.pwin;
      ptotal = res.ptotal;
      coherenceRatio = res.coherenceRatio;
      fftSize = res.fftSize;
      bpmMean = res.bpmMean;
    }
    const coherenceMappedPercent = insufficientCoverage
      ? 0
      : mapCoherenceRatioToPercent(coherenceRatio);
    coherenceRawSeries.push(coherenceMappedPercent);
    perSecond.push({
      secondIndex: s,
      wallClockMs,
      windowStartMs,
      windowEndMs,
      windowSeconds,
      tachogramSampleCount: bpm.length,
      coverageFraction,
      insufficientCoverage,
      fftSize,
      bpmMean,
      pwin,
      ptotal,
      coherenceRatio,
      coherenceMappedPercent,
    });
  }

  const smoothed = medianFilter1HzWindowSeconds(coherenceRawSeries, SMOOTH_WINDOW_SECONDS);
  const perSecondSmoothed = smoothed.map((v, i) => ({
    secondIndex: i + 1,
    coherenceMappedPercent: v,
  }));

  const secondsWithInsufficientCoverage = perSecond.filter((p) => p.insufficientCoverage).length;
  if (
    perSecond.length > 0 &&
    secondsWithInsufficientCoverage / perSecond.length >= COHERENCE_MAX_INSUFFICIENT_SECONDS_FRAC
  ) {
    withholdReasons.push(
      `insufficientCoverageFrac=${((secondsWithInsufficientCoverage / perSecond.length) * 100).toFixed(1)}% >= ${Math.round(COHERENCE_MAX_INSUFFICIENT_SECONDS_FRAC * 100)}%`,
    );
  }

  const metricsWithheldDueToInsufficientData = withholdReasons.length > 0;
  if (metricsWithheldDueToInsufficientData) {
    warnings.push(
      `Метрики не рассчитаны: сигнал был нестабилен (${withholdReasons.join("; ")}). Показана только длительность практики.`,
    );
  }

  const hasTachogramSignal =
    fullBpm.some((v) => v > BPM_ZERO_EPS) && perSecond.some((p) => p.tachogramSampleCount >= 8);

  const eligibleSeconds = smoothed
    .map((v, idx) => ({ v, sec: idx + 1 }))
    .filter((x) => x.sec > skipAggregateSec);
  let coherenceAveragePercent: number | null = null;
  let coherenceMaxPercent: number | null = null;
  if (!metricsWithheldDueToInsufficientData) {
    if (eligibleSeconds.length > 0 && hasTachogramSignal) {
      coherenceAveragePercent =
        eligibleSeconds.reduce((s, x) => s + x.v, 0) / eligibleSeconds.length;
      coherenceMaxPercent = Math.max(...eligibleSeconds.map((x) => x.v));
    } else if (eligibleSeconds.length === 0) {
      warnings.push("Недостаточно данных после окна прогрева для агрегатов когерентности.");
    } else if (!hasTachogramSignal) {
      warnings.push("Тахограмма не построена по RR — когерентность не считается (мало ударов в окнах).");
    }
  }

  const cycleMs = inhaleMs + exhaleMs;
  let rsaCycles: CoherenceSessionResult["rsaCycles"] = [];
  if (
    !metricsWithheldDueToInsufficientData &&
    fullBpm.length > 2 &&
    cycleMs > 0
  ) {
    /**
     * Для RSA берём цикл только если в его окне тахограмма покрыта реальными точками
     * хотя бы на 80 % (после исправления `buildTachogramBpmSeries` экстраполяций нет —
     * значит просто проверка длины). Иначе пики min/max HR искажены краями сессии.
     */
    const expectedSamplesPerCycle = Math.max(1, Math.round((cycleMs / 1000) * TACHO_SAMPLE_RATE_HZ));
    const minSamplesForRsaCycle = Math.ceil(expectedSamplesPerCycle * 0.8);

    let cycleIndex = 0;
    for (let t0 = sessionStartedAtMs; t0 + cycleMs <= sessionEndedAtMs + 1; t0 += cycleMs) {
      const t1 = t0 + cycleMs;
      const slice: number[] = [];
      for (let i = 0; i < fullTacho.timesMs.length; i += 1) {
        const tm = fullTacho.timesMs[i]!;
        if (tm >= t0 && tm <= t1) {
          slice.push(fullBpm[i]!);
        }
      }
      if (slice.length >= minSamplesForRsaCycle) {
        const hrMax = Math.max(...slice);
        const hrMin = Math.min(...slice);
        const rsaBpm = hrMax - hrMin;
        rsaCycles.push({
          cycleIndex,
          startMs: t0,
          endMs: t1,
          hrMax,
          hrMin,
          rsaBpm,
          inactive: rsaBpm < RSA_CYCLE_MIN_BPM,
        });
      }
      cycleIndex += 1;
    }
  }

  const activeRsa = rsaCycles.filter((c) => !c.inactive).map((c) => c.rsaBpm);
  let rsaAmplitudeBpm = activeRsa.length > 0 ? median(activeRsa) : null;

  /** Нормированная RSA: амплитуда RSA (уд/мин) / средний пульс по тахограмме практики (уд/мин) × 100 %. Не global max−min по 4 Гц — там размах завышен артефактами интерполяции. */
  let rsaNormalizedPercent: number | null = null;
  if (!metricsWithheldDueToInsufficientData && fullBpm.length > 0 && rsaAmplitudeBpm != null) {
    const hrMeanBpm = fullBpm.reduce((s, v) => s + v, 0) / fullBpm.length;
    if (hrMeanBpm > 0) {
      rsaNormalizedPercent = (rsaAmplitudeBpm / hrMeanBpm) * 100;
    }
  }

  if (metricsWithheldDueToInsufficientData) {
    rsaAmplitudeBpm = null;
    rsaNormalizedPercent = null;
    rsaCycles = [];
    warnings.push(
      `Итоговые метрики не рассчитаны: валидных секунд с пульсом (${totalValidDataSeconds}) меньше ${COHERENCE_MIN_VALID_SECONDS_FOR_METRICS} с.`,
    );
  }

  let entryTimeSec: number | null = null;
  const threshold = COHERENCE_ENTRY_THRESHOLD_PERCENT;
  let streak = 0;
  let maxConsecutiveSecondsAtOrAboveEntryThreshold = 0;
  if (!metricsWithheldDueToInsufficientData && hasTachogramSignal) {
    for (let i = 0; i < smoothed.length; i += 1) {
      const rawSec = perSecond[i]!;
      // Секунда невалидна, если тахограмма не покрыла FFT-окно или нет реального BPM.
      if (rawSec.insufficientCoverage || !hasRealBpmSecond[i]) {
        streak = 0;
        continue;
      }
      if (smoothed[i]! >= threshold) {
        streak += 1;
        if (streak > maxConsecutiveSecondsAtOrAboveEntryThreshold) {
          maxConsecutiveSecondsAtOrAboveEntryThreshold = streak;
        }
        if (streak >= ENTRY_STABILITY_SECONDS && entryTimeSec == null) {
          /** Первая секунда устойчивого 15-секундного окна (1-based), см. PDF п. 10. */
          entryTimeSec = rawSec.secondIndex - ENTRY_STABILITY_SECONDS + 1;
        }
      } else {
        streak = 0;
      }
    }
  }

  if (!metricsWithheldDueToInsufficientData && hasTachogramSignal && entryTimeSec == null) {
    warnings.push(
      `Время вхождения не определено: нужно ${ENTRY_STABILITY_SECONDS} с подряд с когерентностью ≥ ${threshold}% после медианного сглаживания; максимум подряд: ${maxConsecutiveSecondsAtOrAboveEntryThreshold} с.`,
    );
  }

  return {
    algorithmVersion: COHERENCE_ALGORITHM_VERSION,
    mode,
    sessionDurationSec: practiceDurationSec,
    practiceDurationSec,
    skipFirstSecondsForAggregate: skipAggregateSec,
    windowSeconds,
    metricsApproximate,
    beatTimestampsMsBeforeDedupe: beatsInSession,
    beatTimestampsMsAnalyzed: beatsDeduped,
    coherenceAveragePercent,
    coherenceMaxPercent,
    rsaAmplitudeBpm,
    rsaNormalizedPercent,
    entryTimeSec,
    perSecond,
    perSecondSmoothed,
    rsaCycles,
    warnings,
    totalValidDataSeconds,
    metricsWithheldDueToInsufficientData,
    exportMeta: {
      coherenceEntryThresholdPercent: threshold,
      entryStabilitySeconds: ENTRY_STABILITY_SECONDS,
      smoothWindowSeconds: SMOOTH_WINDOW_SECONDS,
      beatsAfterWindowFilter: beatsInSession.length,
      beatsAfterDedupe: beatsDeduped.length,
      beatDedupeToleranceMs: COHERENCE_BEAT_DEDUPE_MS,
      rrBadFraction: badFraction,
      rrCoherenceWarnFraction: RR_COHERENCE_WARN_FRACTION,
      totalValidDataSeconds,
      metricsWithheldDueToInsufficientData,
      ...(rsaNormalizedPercent != null ? { rsaNormalizedPercent } : {}),
      bufferMsBeforeSession,
      practiceBeatCount: practiceOnlyBeats.length,
      practiceBeatSpanMs,
      maxConsecutiveSecondsAtOrAboveEntryThreshold,
      coherenceMasterRatio: COHERENCE_MASTER_RATIO,
      coherenceStretchExponent: COHERENCE_STRETCH_EXPONENT,
      pwinSearchMinHz: PWIN_SEARCH_MIN_HZ,
      pwinSearchMaxHz: PWIN_SEARCH_MAX_HZ,
      pwinHalfWidthHz: PWIN_HALF_WIDTH_HZ,
      ptotalMinHz: PTOTAL_MIN_HZ,
      ptotalMaxHz: PTOTAL_MAX_HZ,
      windowCoverageMinFrac: COHERENCE_WINDOW_MIN_COVERAGE_FRAC,
      secondsWithInsufficientCoverage,
      withholdReasons,
      secondsCountedInAggregate: eligibleSeconds.length,
    },
  };
}

export type CoherenceSessionTimeBase = "cameraPresentationMs" | "unixEpochMs";

/** Журнал пульса/optical по времени (для отладки и сопоставления с RR). */
export type CoherencePulseLogEntry = {
  cameraTimestampMs: number;
  wallClockMs: number;
  pulseRateBpm: number;
  signalQuality: number;
  pulseReady: boolean;
  fingerDetected: boolean;
  pulseLockState: string;
  beatTimestampsCount: number;
};

export type CoherenceExportDebug = {
  fingerSessionKey: number;
  /** Шкала времени для границ сессии и beatTimestampsMs в анализе. */
  sessionTimeBase: CoherenceSessionTimeBase;
  /** Якорь начала практики по времени кадра камеры (нативный ППГ); null в Expo Go / симуляции. */
  practicePpgAnchorMs: number | null;
  /** Wall-clock при старте практики (для справки; метки ударов могут быть в другой шкале). */
  wallClockSessionStartMs: number | null;
  snapshotCallbacksTotal: number;
  snapshotsWhileRunning: number;
  lastSnapshotTimestampMs: number | null;
  lastSnapshotBeatCount: number;
  lastSnapshotDetectedBeatCount: number;
  lastSnapshotPulseLock: string;
  lastSnapshotFingerDetected: boolean;
  rawBeatArrayLengthBeforeFilter: number;
  /** Число меток после дедупликации (совпадает с result.beatTimestampsMsAnalyzed.length). */
  beatsAfterDedupeMs?: number;
  /** min/max по сырому merged-массиву до фильтра окна (диагностика масштаба времени). */
  rawBeatMinMs: number | null;
  rawBeatMaxMs: number | null;
  beatsAfterSessionWindowFilter: number;
  /** Границы, переданные в runCoherenceSessionAnalysis (согласованы с sessionTimeBase). */
  analysisSessionStartMs: number;
  analysisSessionEndMs: number;
  // ─── Диагностика ритма и QC (coherent-breath-rhythm-overhaul, апрель 2026) ─
  /** Ряд RR-интервалов после дедупликации, в миллисекундах. */
  rrSeriesMs?: readonly number[];
  /** Серия baseline BPM из planner-а, (tSinceSessionStartMs, bpm). */
  baselineBpmSeries?: readonly { tMs: number; bpm: number }[];
  /** Сводка по завершённым RSA-циклам: (hrInhale, hrExhale, rsaBpm, durationMs). */
  rsaCyclesSummary?: readonly {
    hrInhale: number;
    hrExhale: number;
    rsaBpm: number;
    durationMs: number;
  }[];
  /** История планов дыхания (цикл за циклом). */
  phaseDurationsHistory?: readonly {
    planIndex: number;
    cycleMs: number;
    plannedInhaleMs: number;
    plannedExhaleMs: number;
    baselineBpm: number;
    rsaBpm: number | null;
  }[];
  /** Исход QC: ok / user_chose_no_sensor / retry_failed. */
  qcOutcome?: "ok" | "user_chose_no_sensor" | "retry_failed" | null;
  /** Итоговый RMSSD по full-session HRV-накопителю практики. */
  practiceRmssdMs?: number | null;
  /** Итоговый индекс стресса по full-session HRV-накопителю практики. */
  practiceStressPercent?: number | null;
  /** Число валидных ударов в full-session HRV-накопителе. */
  practiceHrvBeatCount?: number;
  /** Диагностика детектора пиков (агрегированно за сессию). */
  peakDetector?: {
    dicroticRejectedTotal: number;
    splitArtifactRejectedTotal: number;
    peakWindowsObserved: number;
    lastRefractoryAdaptiveMs: number | null;
    lastMedianRrInPeakWindowMs: number | null;
  };
};

export function buildCoherenceExportJson(
  input: CoherenceSessionInput,
  result: CoherenceSessionResult,
  options?: {
    dataSource?: "fingerPpg" | "simulated";
    debug?: CoherenceExportDebug;
    /** ~2 Гц: пульс и контракт по кадрам (как ориентир рядом с RR). */
    pulseLog?: readonly CoherencePulseLogEntry[];
  },
) {
  return {
    schemaVersion: 2 as const,
    exportedAtMs: Date.now(),
    algorithmVersion: COHERENCE_ALGORITHM_VERSION,
    dataSource: options?.dataSource,
    debug: options?.debug,
    pulseLog: options?.pulseLog,
    session: {
      startedAtMs: input.sessionStartedAtMs,
      endedAtMs: input.sessionEndedAtMs,
      inhaleMs: input.inhaleMs,
      exhaleMs: input.exhaleMs,
      mode: input.mode,
      bufferMsBeforeSession: input.bufferMsBeforeSession ?? 0,
      beatCountWindowFiltered: result.beatTimestampsMsBeforeDedupe.length,
      beatCountAnalyzed: result.beatTimestampsMsAnalyzed.length,
    },
    beats: {
      timestampsMsWindowFiltered: [...result.beatTimestampsMsBeforeDedupe],
      /** Итоговые метки для RR/метрик (дедупликация). */
      timestampsMsAnalyzed: [...result.beatTimestampsMsAnalyzed],
    },
    result,
  };
}
