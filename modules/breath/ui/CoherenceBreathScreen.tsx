import Constants from "expo-constants";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { activateKeepAwakeAsync, useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  AppState,
  Easing as RNEasing,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Line, Polyline, Rect } from "react-native-svg";

import {
  getBatteryLevelPct,
  getNativeMemoryMb,
  getThermalState,
  isFingerFrameProcessorAvailable,
  subscribeThermalState,
  type ThermalState,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { getPracticeCatalogStrings } from "@/modules/practices/i18n/practices";

import { BiofeedbackProvider, useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { useBiofeedbackBus, useBiofeedbackChannel } from "@/modules/biofeedback/bus/react";
import { useBiofeedbackSnapshot } from "@/modules/biofeedback/bus/snapshot-adapter";
import {
  calculateBaevskyStressIndexRaw,
  computePracticeHrvMetricsFullSession,
  computeRmssdStandardFromRrIntervals,
  hampelFilterRrIntervals,
  mapBaevskyStressToPercent,
  type PracticeHrvMetricsResult,
} from "@/modules/biofeedback/core/metrics";
import type {
  BiofeedbackSignalTrustLevel,
  BiofeedbackSignalTrustSummary,
} from "@/modules/biofeedback/core/signal-trust";
import {
  FINGER_CAMERA_CAPTURE_CONFIG,
  WEARABLE_CAPTURE_CONFIG,
} from "@/modules/biofeedback/core/types";
import { EmulatedPulseSensorSource } from "@/modules/biofeedback/sensors/EmulatedPulseSensorSource";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { SimulatedSensorSource } from "@/modules/biofeedback/sensors/SimulatedSensorSource";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";
import { BleHeartRateSource } from "@/modules/biofeedback/wearables/BleHeartRateSource";
import { resolveWearableHeartRateBpm } from "@/modules/biofeedback/wearables/wearableRrQuality";
import {
  updateWearablePreferences,
  useWearablePreferences,
} from "@/modules/biofeedback/wearables/preferences";
import type {
  BreathSensorMode,
  WearableCapabilityTier,
  WearableDeviceProvider,
  WearableRuntimeSnapshot,
  WearableScanCandidate,
} from "@/modules/biofeedback/wearables/types";
import { WearablePickerDialog } from "@/modules/biofeedback/wearables/WearablePickerDialog";
import { peekHeldLivePacketAgeMs } from "@/modules/biofeedback/wearables/wearableConnectionHold";

import {
  COHERENCE_PREFLIGHT_BUFFER_MS,
  COHERENCE_PREP_TOTAL_MS,
  COHERENCE_QC_FAIL_LEAD_MS,
  COHERENCE_QUALITY_WINDOW_EARLY_SUCCESS_MS,
  COHERENCE_QUALITY_WINDOW_MS,
  COHERENCE_WARMUP_MS,
  QC_BPM_STDEV_MAX,
  QC_MIN_BEATS,
} from "@/modules/breath/core/coherence-constants";
import {
  BreathPhasePlanner,
  type BreathPhaseShape,
  type PlannedCycle,
} from "@/modules/breath/core/breath-phase-planner";
import { mergeHybridCoherenceSessionResults } from "@/modules/breath/core/coherence-hybrid-merge";
import {
  HybridMeasurementController,
  type HybridPhase,
} from "@/modules/breath/core/hybrid-measurement-controller";
import {
  BREATH_BLE_PREP_MIN_LIVE_PULSE_MS,
  BREATH_BLE_PREP_SPIN_MS,
  BREATH_CAMERA_EMULATED_FALLBACK_MS,
  BREATH_CAMERA_EMULATED_START_GRACE_MS,
  BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS,
  BREATH_OPTICAL_STALL_HARD_MS,
  BREATH_SESSION_SIGNAL_ABORT_MS,
} from "@/modules/breath/core/breath-session-signal-policy";
import {
  appendNewerBeatsForRrChart,
  buildGuidancePulseChartSeries,
  buildMeasuredPulseChartSeries,
  buildRrIntervalChartSeries,
  collectGuidancePulseHighlightIntervals,
  collectMeasuredPulseHighlightIntervals,
  collectNonLiveIntervalsFromLog,
  filterIsolatedMetricSpikes,
  filterOutlierMetricPoints,
  isPulseLogEntryLiveForMeasurement,
  prepareSeriesForDisplay,
  RSA_RESULTS_OUTLIER_BPM,
  sanitizeBreathGuidanceBpm,
  summarizePulseLockTransitions,
  WEARABLE_LIVE_RR_FRESH_MS,
  type BreathResultsSeriesPoint,
  splitPulseChartSeriesSegments,
  type NonLiveInterval,
} from "@/modules/breath/core/breath-results-series";
import {
  buildShapeForTempo,
  canStepTriangleTempo,
  formatTempoLabel,
  isDefaultTempoKey,
  isTriangleBreathPracticeId,
  LINEAR_OVERLAY_MAX_BEATS,
  LINEAR_OVERLAY_MIN_BEATS,
  parseTempoKey,
  resolveTempoKey,
  stepLinearTempoKey,
  stepTriangleTempoKey,
} from "@/modules/breath/core/breath-tempo";
import {
  getBreathTempoForPractice,
  updateBreathTempoPreference,
} from "@/modules/breath/core/breathTempoPreferences";
import {
  DEBUG_ACTIVATION_EXPORT_ENABLED,
  PERF_DIAGNOSTICS_ENABLED,
} from "@/modules/breath/config/debug-flags";
import { JankDetector } from "@/modules/breath/debug/jank-detector";
import {
  readJsHeapUsedBytes,
  SessionRuntimeDiagnostics,
} from "@/modules/breath/debug/session-runtime-diagnostics";
import {
  BREATH_PRACTICES,
  getBreathPracticeById,
  type BreathPracticeDescriptor,
} from "@/modules/breath/core/practices";
import { DEFAULT_COHERENCE_TEST_TIMING } from "@/modules/breath/core/types";
import {
  getCoherenceBreathStrings,
  type BreathLocale,
  type BreathPracticeId,
} from "@/modules/breath/i18n/coherence";
import type {
  CoherenceExportDebug,
  CoherencePulseLogEntry,
  CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";
import {
  outcomeToCommunicatorPayload,
  type BreathHybridBreakdown,
  type BreathPracticeOutcome,
  type BreathPracticeSummary,
} from "@/modules/breath/core/practice-io";
import { useAuth } from "@/modules/auth";
import { BreathBinduMandala } from "@/modules/breath/ui/BreathBinduMandala";
import {
  MandalaSoundProvider,
  SOUND_BED_NEURO_SYNC,
  useMandalaSoundFrame,
  useMandalaSoundSync,
  type SoundBedId,
} from "@/modules/mandala-sound";
import { BreathOverlayControlPanel } from "@/modules/breath/ui/BreathOverlayControlPanel";
import { PpgMiniChart } from "@/modules/breath/ui/PpgMiniChart";
import { AppButton } from "@/modules/ui/AppButton";
import { AppDialog } from "@/modules/ui/AppDialog";
import { AppText } from "@/modules/ui/AppText";
import { CountdownRing } from "@/modules/ui/CountdownRing";
import { FloatingCloseButton } from "@/modules/ui/FloatingCloseButton";
import { PracticeStopConfirmDialog } from "@/modules/ui/PracticeStopConfirmDialog";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { defaultTheme, ThemeProvider, useTheme } from "@/modules/ui/theme";
import { useImmersiveOverlayAutohide } from "@/modules/ui/useImmersiveOverlayAutohide";
import { fetchBreathPracticeInterpretation } from "@/services/breathPracticeInterpretation";
import { recordPracticeSession } from "@/services/practiceSessions";
import {
  getRuntimeDiagnosticsCurrentSeq,
  getRuntimeDiagnosticsEventsSince,
  logRuntimeEvent,
} from "@/services/runtimeDiagnostics";
import type { Json } from "@/services/supabase-types";
import {
  AffirmationBreathOverlay,
  type AffirmationBreathGate,
} from "@/modules/affirmations";

import { BreathPracticeShell, useBreathPhaseLabel } from "./BreathPracticeShell";

const TIMING = DEFAULT_COHERENCE_TEST_TIMING;

function trustLevelRank(level: BiofeedbackSignalTrustLevel): number {
  switch (level) {
    case "full_biometrics":
      return 0;
    case "guided_limited":
      return 1;
    case "pulse_only":
      return 2;
  }
}

function worstSignalTrust(
  ...summaries: Array<BiofeedbackSignalTrustSummary | null>
): BiofeedbackSignalTrustSummary | null {
  let worst: BiofeedbackSignalTrustSummary | null = null;
  for (const summary of summaries) {
    if (summary == null) continue;
    if (worst == null || trustLevelRank(summary.level) > trustLevelRank(worst.level)) {
      worst = summary;
    }
  }
  return worst;
}

function suppressPracticeHrvMetrics(result: PracticeHrvMetricsResult): PracticeHrvMetricsResult {
  return {
    ...result,
    showRmssd: false,
    showStress: false,
    rmssdApproximate: false,
    stressApproximate: false,
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
}

function suppressCoherenceMetrics(result: CoherenceSessionResult): CoherenceSessionResult {
  return {
    ...result,
    coherenceAveragePercent: null,
    coherenceMaxPercent: null,
    rsaAmplitudeBpm: null,
    rsaNormalizedPercent: null,
    entryTimeSec: null,
  };
}

/** Physiologic RR bounds (ms) for dense HRV windows: 300 ms = 200 bpm, 1500 ms = 40 bpm. */
const DENSE_HRV_RR_MIN_MS = 300;
const DENSE_HRV_RR_MAX_MS = 1500;
/**
 * Sequential-deviation гейт для dense-HRV RR (как в PulseBpmEngine для wearable, ratio 0.22).
 * Polar H10 при движении (отжимания, съём/надевание) шлёт зашумлённые RR — ошибки детекции
 * R-пика: ряд скачет 576↔717↔499↔691 мс при реальном ~730 мс. Эти значения проходят жёсткий
 * фильтр 300–1500 и не ловятся Hampel (они не одиночные, а bursts), поэтому RMSSD взлетала до
 * 56 мс, а индекс стресса падал к 0 (огромный MxDMn). Гейт режет RR, отклоняющиеся от бегущей
 * медианы контекста больше чем на max(110, med·0.22) — ровно то же правило, что фильтрует BPM.
 */
const DENSE_HRV_DEVIATION_RATIO = 0.22;
const DENSE_HRV_DEVIATION_MIN_DELTA_MS = 110;
const DENSE_HRV_DEVIATION_CONTEXT = 12;
// Min per-step RR change for the trend-aware escape hatch: each consecutive accepted RR
// must differ from its predecessor by at least this many ms in the SAME direction (and the
// candidate must continue the run) before a rejected RR is admitted as a real HR ramp
// rather than motion noise. 8 ms ≈ ~1 bpm at 75 bpm; small enough to admit a genuine ramp,
// large enough that a flat 730,730,730,730 baseline does NOT count as a trend (so a lone
// 576 among stable 730 is still rejected).
const DENSE_HRV_TREND_MIN_STEP_MS = 8;
/** Trailing window for per-second RMSSD (short-term HRV) and Baevsky stress index. */
const DENSE_RMSSD_WINDOW_MS = 30_000;
const DENSE_STRESS_WINDOW_MS = 60_000;
const DENSE_RMSSD_MIN_INTERVALS = 8;
const DENSE_STRESS_MIN_INTERVALS = 20;
/** Practice-plausible RMSSD ceiling (ms) — mirrors HRV_PRACTICE_RMSSD_ABS_MAX_MS in metrics. */
const DENSE_RMSSD_ABS_MAX_MS = 160;

/**
 * Builds dense (1 Hz) RMSSD and stress-index series from the analyzed beat stream.
 *
 * Why here and not from the live bus: the bus snapshots are throttled to one point every few
 * seconds, so the RMSSD result graph degenerated into a handful of straight segments. RSA is
 * already dense (per-second, from the tachogram), so RMSSD/stress looked broken by comparison.
 * This recomputes both per second over a trailing window that grows from t=0 (curve appears within
 * ~10–25 s instead of at 1:00) and skips any second inside a real signal-loss gap so the gaps line
 * up with the pulse gray bands and the coherence/RSA graphs.
 */
function buildDenseHrvSeriesFromBeats(
  beatTimestampsMs: readonly number[],
  sessionStartMs: number,
  practiceTotalMs: number,
  nonLiveIntervals: readonly NonLiveInterval[],
): { rmssdMs: BreathResultsSeriesPoint[]; stressPercent: BreathResultsSeriesPoint[] } {
  const rmssdMs: BreathResultsSeriesPoint[] = [];
  const stressPercent: BreathResultsSeriesPoint[] = [];
  if (beatTimestampsMs.length < 3) return { rmssdMs, stressPercent };

  const beats = [...beatTimestampsMs].sort((a, b) => a - b);
  // RR events tagged with the (offset) time of the closing beat, physiologic values only.
  const rrRaw: { tMs: number; rr: number }[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const d = beats[i]! - beats[i - 1]!;
    if (d >= DENSE_HRV_RR_MIN_MS && d <= DENSE_HRV_RR_MAX_MS) {
      rrRaw.push({ tMs: beats[i]! - sessionStartMs, rr: d });
    }
  }
  if (rrRaw.length < DENSE_RMSSD_MIN_INTERVALS) return { rmssdMs, stressPercent };

  // Sequential-deviation гейт: режет motion-зашумлённые RR Polar (отжимания/съём), которые
  // проходят жёсткий диапазон 300–1500, но дают огромные ΔRR → фейковый всплеск RMSSD и провал
  // стресса. Контекст — бегущая медиана последних принятых RR (см. константы выше).
  //
  // Trend-aware escape hatch: если RR отклоняется больше `allowed`, но последние четыре
  // принятых RR монотонно убывают/возрастают с реальным шагом (≥ DENSE_HRV_TREND_MIN_STEP_MS
  // на каждый переход) И новый RR продолжает этот тренд — принимаем. Это отличает реальный
  // подъём/спад HR (отжимания, бег — RR плавно 838→580 за 30 с) от motion-шума (одиночные
  // 576/499 среди стабильных 730). Без этой лазейки gate вырезал ВЕСЬ тренд восхождения HR,
  // окно RMSSD пустело <8 интервалов и на графике появлялись серые разрывы ровно там, где
  // пульс учащался (field test `1783158512492`: 63 окна с <8 RR → большие gaps в RMSSD/stress
  // при отжиманиях). С лазейкой — 0 таких окон, дикие одиночные выбросы всё равно режутся.
  const rr: { tMs: number; rr: number }[] = [];
  const ctx: number[] = [];
  const ctxMedian = (vals: number[]): number => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 === 1 ? s[(n - 1) >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
  };
  const continuesTrend = (last4: number[], candidate: number): boolean => {
    if (last4.length < 4) return false;
    const dec = last4[0]! - last4[1]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && last4[1]! - last4[2]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && last4[2]! - last4[3]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && last4[3]! - candidate >= DENSE_HRV_TREND_MIN_STEP_MS;
    if (dec) return true;
    const inc = last4[1]! - last4[0]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && last4[2]! - last4[1]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && last4[3]! - last4[2]! >= DENSE_HRV_TREND_MIN_STEP_MS
      && candidate - last4[3]! >= DENSE_HRV_TREND_MIN_STEP_MS;
    return inc;
  };
  for (const ev of rrRaw) {
    if (ctx.length >= 4) {
      const med = ctxMedian(ctx.slice(-DENSE_HRV_DEVIATION_CONTEXT));
      const allowed = Math.max(DENSE_HRV_DEVIATION_MIN_DELTA_MS, med * DENSE_HRV_DEVIATION_RATIO);
      if (Math.abs(ev.rr - med) > allowed) {
        const last4 = ctx.slice(-4);
        if (!continuesTrend(last4, ev.rr)) {
          continue;
        }
      }
    }
    rr.push(ev);
    ctx.push(ev.rr);
  }
  if (rr.length < DENSE_RMSSD_MIN_INTERVALS) return { rmssdMs, stressPercent };

  const insideGap = (tMs: number) =>
    nonLiveIntervals.some((iv) => tMs >= iv.startMs && tMs <= iv.endMs);

  // Drop RR whose closing beat lands inside a signal-loss gap up front: while a Polar strap is
  // off-body it still emits frozen/repeated RR (e.g. a constant 697 ms) and reconnect-transient
  // beats. If the trailing window reached back across the gap into that garbage, the very first
  // post-gap seconds inherited a huge fake ΔRR and RMSSD spiked to ~120 ms right after recovery.
  const liveRr = rr.filter((ev) => !insideGap(ev.tMs));

  const practiceSec = Math.floor(practiceTotalMs / 1000);
  for (let s = 1; s <= practiceSec; s += 1) {
    const tMs = s * 1000;
    if (insideGap(tMs)) continue;
    const rmssdWin: number[] = [];
    const stressWin: number[] = [];
    for (const ev of liveRr) {
      if (ev.tMs <= tMs && ev.tMs > tMs - DENSE_RMSSD_WINDOW_MS) rmssdWin.push(ev.rr);
      if (ev.tMs <= tMs && ev.tMs > tMs - DENSE_STRESS_WINDOW_MS) stressWin.push(ev.rr);
    }
    if (rmssdWin.length >= DENSE_RMSSD_MIN_INTERVALS) {
      // Hampel-clean the window first: a single missed/merged beat (a ~2× doubled RR, e.g. 946 ms
      // between 484/478) or a reconnect-transient short RR (376 ms) otherwise injects one huge ΔRR
      // and spikes RMSSD to 90–135 ms for exactly one window, then it snaps back — the artifact the
      // user flagged. Replacing those local outliers with the running median (same policy as the
      // final practice RMSSD) removes the spike while preserving real beat-to-beat variability.
      const cleaned = hampelFilterRrIntervals(rmssdWin);
      const v = Math.min(DENSE_RMSSD_ABS_MAX_MS, computeRmssdStandardFromRrIntervals(cleaned));
      if (v > 0) rmssdMs.push({ tMs, value: v });
    }
    if (stressWin.length >= DENSE_STRESS_MIN_INTERVALS) {
      const raw = calculateBaevskyStressIndexRaw(hampelFilterRrIntervals(stressWin));
      if (raw > 0) stressPercent.push({ tMs, value: mapBaevskyStressToPercent(raw) });
    }
  }
  return { rmssdMs, stressPercent };
}

function findRecoverableCoherenceTail(params: {
  pipeline: ReturnType<typeof useBiofeedbackPipeline>;
  coherenceEngine: ReturnType<ReturnType<typeof useBiofeedbackPipeline>["getCoherenceEngine"]>;
  sessionStartMs: number;
  sessionEndMs: number;
}): {
  result: CoherenceSessionResult;
  windowMs: number;
  trust: BiofeedbackSignalTrustSummary;
} | null {
  const { pipeline, coherenceEngine, sessionStartMs, sessionEndMs } = params;
  if (pipeline.getPulseSource() !== "fingerCamera") {
    return null;
  }

  const candidateWindowsMs = [180_000, 150_000, 120_000] as const;
  const minValidDataSeconds = 90;
  for (const windowMs of candidateWindowsMs) {
    if (sessionEndMs - sessionStartMs < windowMs) {
      continue;
    }
    const startMs = sessionEndMs - windowMs;
    const trust = pipeline.getSignalTrustSummary({ startMs, endMs: sessionEndMs });
    if (trust.level === "pulse_only") {
      continue;
    }
    if (trust.gapEventCount > 0 || trust.longestGapMs > 2_000) {
      continue;
    }
    const result = coherenceEngine.analyzeWindow(startMs, sessionEndMs);
    if (result.metricsWithheldDueToInsufficientData) {
      continue;
    }
    if (result.totalValidDataSeconds < minValidDataSeconds) {
      continue;
    }
    if (result.coherenceAveragePercent == null || result.rsaAmplitudeBpm == null) {
      continue;
    }
    return { result, windowMs, trust };
  }
  return null;
}
/** Начальный BPM для seed-а planner-а, пока не пришли реальные удары. */
const INITIAL_SEED_BPM = 60;
/**
 * Camera guidance-only: seed BPM для emulated-синтетики и для стартового seed-а
 * planner-а, когда когерентный baseline ещё не построен или недоступен. Это
 * безопасный ритм покоя, чтобы дыхательная практика не уходила в нереалистично
 * медленный/быстрый темп на шуме с оптического датчика. Значения используются
 * единообразно и для emulated-fallback, и для planner-seed на старте running.
 */
const CAMERA_EMULATED_SEED_DEFAULT_BPM = 65;
const CAMERA_EMULATED_SEED_MIN_BPM = 50;
const CAMERA_EMULATED_SEED_MAX_BPM = 90;
/** Максимум времени в прогреве + QC до отмены (защита от зависания). */
const COHERENCE_PROTOCOL_MAX_MS = 180_000;
const UI_TICK_MS = 500;
/**
 * Частота обновления baseline EMA в planner-е. Это НЕ частота пересчёта `phaseDurations`
 * — план цикла меняется только по границе (см. `BreathPracticeShell.onCycleEnd`).
 * 250 мс достаточно, чтобы EMA успевал отслеживать медленные изменения BPM.
 */
const PLANNER_BASELINE_TICK_MS = 250;
/** Панель управления: через сколько мс бездействия автоматически скрыть панель. */
const OVERLAY_AUTOHIDE_MS = 4_000;
/** Порог мягкого напоминания в camera guidance-only режиме. */
const CAMERA_GUIDANCE_REMINDER_TRIGGER_MS = 5000;
/** Совпадает с длительностью практики (`TIMING.totalMs`), иначе forceSecondBpmZero не покрывает хвост сессии. */
const PPG_SESSION_SECONDS = Math.round(TIMING.totalMs / 1000);
/**
 * Гибридный режим измерения активируется только для достаточно длинных
 * практик. Короче этого — нет смысла разбивать на три фазы: даже минимум
 * realStart (3 мин) + endWindow (4 мин) + буфер не помещаются.
 */
const MIN_TOTAL_MS_FOR_HYBRID = 10 * 60_000;
/**
 * Период tick'ов гибридного контроллера (сверка по времени + thermalState).
 * 1 Гц достаточно: переходы между фазами не требуют миллисекундной точности.
 */
const HYBRID_TICK_MS = 1_000;
/**
 * Длительность плавного перехода baselineBpm с реального значения на
 * frozen-значение при переходе в emulated. За 10 с индикатор дыхания
 * без рывков придёт к зафиксированной скорости.
 */
const HYBRID_BASELINE_RAMP_MS = 10_000;
const HYBRID_BASELINE_RAMP_STEP_MS = 500;
/**
 * Окно RR-истории для вычисления «стабильного» BPM в момент перехода
 * realStart → emulated. Последние 60 с реальных замеров дают достаточно
 * устойчивое значение, чтобы индикатор не прыгал при переходе.
 */
const HYBRID_STABLE_BPM_WINDOW_MS = 60_000;
/**
 * TAG_REMOVE_PERF_DIAGNOSTICS — периодическая телеметрия торможения / перегрева.
 * Удалить вместе с `session-runtime-diagnostics.ts`.
 */
const PERF_DIAG_SAMPLE_MS = 10_000;
// DEBUG_ACTIVATION_EXPORT_ENABLED и PERF_DIAGNOSTICS_ENABLED импортируются из
// `@/modules/breath/config/debug-flags` в блоке импортов сверху. Чтобы
// включить/выключить весь «тестовый режим», переключай `BREATH_TESTING_MODE`
// в этом файле — ничего другого править не нужно.
const CAMERA_RECOVERY_PROBE_EVERY_MS = 3_000;
const CAMERA_RECOVERY_PROBE_WINDOW_MS = 2_500;
const CAMERA_RECOVERY_PROBE_POLL_MS = 400;
const CAMERA_RECOVERY_PROBE_MAX_CONTINUOUS_MS = 12_000;
const CAMERA_RECOVERY_MIN_SIGNAL_QUALITY = 0.55;
const CAMERA_SIGNAL_RECOVERY_RESET_MS = 8_000;
const WEARABLE_EMULATED_FALLBACK_DELAY_MS = 3_000;
const WEARABLE_RECOVERY_RR_FRESH_MS = 4_000;

const isExpoGo = Constants.executionEnvironment === "storeClient";
const useSimulatedPpg = isExpoGo || !isFingerFrameProcessorAvailable();
const ENABLE_FINGER_CAMERA_ADVANCED_METRICS = false;
/** Keep measured + guidance pulse charts visible while validating signal policies. */
const SHOW_BOTH_PULSE_RESULT_GRAPHS = true;

const RSA_CYCLE_MAX_PLAUSIBLE_BPM = 120;

type Phase = "idle" | "warmup" | "qualityCheck" | "running" | "results";

type QcPulseSample = {
  cameraTimestampMs: number;
  bpm: number;
  rawBpm: number;
  rrCount: number;
  jitterMs: number;
  looksCoherent: boolean;
  signalQuality: number;
  lockState: "searching" | "tracking" | "holding";
};

function computeStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Медианный BPM по валидным RR-интервалам ряда beats. Устойчив к
 * пропущенным или ложным ударам (которые проявляются как очень длинные
 * или очень короткие RR). Используется для расчёта «стабильного» BPM
 * перед заморозкой baseline (переход realStart → emulated) и для
 * финальных метрик (средний пульс по окну начала/конца).
 */
function computeMedianBpmFromBeats(beats: readonly number[]): number | null {
  if (beats.length < 3) return null;
  const rrs: number[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const d = beats[i]! - beats[i - 1]!;
    if (d >= 300 && d <= 2000) rrs.push(d);
  }
  if (rrs.length < 2) return null;
  const sorted = rrs.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)]!;
  return med > 0 ? 60_000 / med : null;
}

/**
 * По рисунку практики и медианному RR-интервалу на старте вычисляет длительности
 * `inhaleMs`, `exhaleMs` и полную `cycleMs` для передачи в CoherenceSessionInput.
 * Сохраняем старые поля `inhaleMs`/`exhaleMs` для обратной совместимости, но
 * `cycleMs` теперь главный — он корректен и для практик с задержками.
 */
function computeCycleMsForAnalysis(
  shape: BreathPhaseShape,
  medianRrMs?: number,
): { inhaleMs: number; exhaleMs: number; cycleMs: number } {
  const fallbackRr = 1000; // 60 BPM если нет измерения
  const rrMs =
    medianRrMs != null && medianRrMs > 0 && Number.isFinite(medianRrMs)
      ? medianRrMs
      : fallbackRr;
  const phaseMsForKind = (kind: "inhale" | "exhale" | "hold") =>
    shape.phases
      .filter((p) => p.kind === kind)
      .reduce((acc, p) => acc + p.beats * rrMs, 0);
  const inhaleMs = Math.max(phaseMsForKind("inhale"), 1000);
  const exhaleMs = Math.max(phaseMsForKind("exhale"), 1000);
  const cycleMs = shape.phases.reduce((acc, p) => acc + p.beats * rrMs, 0);
  return { inhaleMs, exhaleMs, cycleMs };
}

function formatCoherencePercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return value >= 99.5 ? "≥99%" : `${Math.round(value)}%`;
}

type BreathResultsSeriesSummary = {
  unit: "bpm" | "percent" | "ms";
  sampleCount: number;
  startMean: number | null;
  midMean: number | null;
  endMean: number | null;
  min: number | null;
  max: number | null;
  endMinusStart: number | null;
  peakAtSec: number | null;
  troughAtSec: number | null;
};

type BreathResultsGraphsSnapshot = {
  measuredPulseBpm: BreathResultsSeriesPoint[];
  guidancePulseBpm: BreathResultsSeriesPoint[];
  measuredPulseHighlights: NonLiveInterval[];
  guidancePulseHighlights: NonLiveInterval[];
  /** Display-only tachogram from analyzed beats (not used by metric algorithms). */
  rrIntervalMs: BreathResultsSeriesPoint[];
  coherencePercent: BreathResultsSeriesPoint[];
  rmssdMs: BreathResultsSeriesPoint[];
  stressPercent: BreathResultsSeriesPoint[];
  rsaBpm: BreathResultsSeriesPoint[];
};

function formatMinutesSeconds(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.round(totalMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function decimateSeries(
  points: readonly BreathResultsSeriesPoint[],
  maxPoints: number,
): BreathResultsSeriesPoint[] {
  if (points.length <= maxPoints) return points.slice();
  const out: BreathResultsSeriesPoint[] = [];
  const step = (points.length - 1) / Math.max(1, maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.min(points.length - 1, Math.round(i * step));
    const point = points[idx];
    if (point == null) continue;
    const prev = out[out.length - 1];
    if (prev?.tMs === point.tMs && prev.value === point.value) continue;
    out.push(point);
  }
  return out;
}

/**
 * Window (мс) для header-значений «start → end» графиков результатов: среднее по первой и
 * последней минуте РЕАЛЬНО измерённых точек ряда (а не треть точек — на длинных сессиях треть
 * это ~3–4 мин, что не отражает «пульс на старте/финише»). 60 с — баланс между стабильностью
 * (один шумовый пик не перекосит) и локальностью (реально отражает начало/конец).
 */
const RESULTS_HEADER_WINDOW_MS = 60_000;

function summarizeSeries(
  points: readonly BreathResultsSeriesPoint[],
  unit: BreathResultsSeriesSummary["unit"],
): BreathResultsSeriesSummary | null {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const mean = (items: readonly number[]) =>
    items.length > 0 ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
  // Time-based start/end windows: первая и последняя минута измеренного ряда.
  const firstT = points[0]!.tMs;
  const lastT = points[points.length - 1]!.tMs;
  const startCutoff = firstT + RESULTS_HEADER_WINDOW_MS;
  const endCutoff = lastT - RESULTS_HEADER_WINDOW_MS;
  const startValues = points.filter((p) => p.tMs <= startCutoff).map((p) => p.value);
  const endValues = points.filter((p) => p.tMs >= endCutoff).map((p) => p.value);
  // Средняя треть по-прежнему для midMean (не в header, только служебное).
  const bucketSize = Math.max(1, Math.round(points.length / 3));
  const midStart = Math.max(0, Math.floor((points.length - bucketSize) / 2));
  const midValues = points.slice(midStart, midStart + bucketSize).map((point) => point.value);
  let peak = points[0]!;
  let trough = points[0]!;
  for (const point of points) {
    if (point.value > peak.value) peak = point;
    if (point.value < trough.value) trough = point;
  }
  const startMean = mean(startValues.length > 0 ? startValues : [points[0]!.value]);
  const endMean = mean(endValues.length > 0 ? endValues : [points[points.length - 1]!.value]);
  return {
    unit,
    sampleCount: points.length,
    startMean,
    midMean: mean(midValues),
    endMean,
    min: Math.min(...values),
    max: Math.max(...values),
    endMinusStart:
      startMean != null && endMean != null ? endMean - startMean : null,
    peakAtSec: Math.round(peak.tMs / 100) / 10,
    troughAtSec: Math.round(trough.tMs / 100) / 10,
  };
}

function seriesDifferMeaningfully(
  left: readonly BreathResultsSeriesPoint[],
  right: readonly BreathResultsSeriesPoint[],
): boolean {
  if (left.length !== right.length) return true;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a == null || b == null) return true;
    if (Math.abs(a.tMs - b.tMs) > 1) return true;
    if (Math.abs(a.value - b.value) > 0.5) return true;
  }
  return false;
}

function pushSeriesPoint(
  seriesRef: MutableRefObject<BreathResultsSeriesPoint[]>,
  point: BreathResultsSeriesPoint,
  options?: { minDeltaMs?: number; maxPoints?: number },
): void {
  const minDeltaMs = options?.minDeltaMs ?? 0;
  const maxPoints = options?.maxPoints ?? 1200;
  const prev = seriesRef.current[seriesRef.current.length - 1];
  if (prev != null && point.tMs - prev.tMs < minDeltaMs) {
    seriesRef.current[seriesRef.current.length - 1] = point;
  } else {
    seriesRef.current.push(point);
  }
  if (seriesRef.current.length > maxPoints) {
    seriesRef.current = seriesRef.current.slice(-maxPoints);
  }
}

function SyncedBreathBinduMandala({
  chakraPresetIndex,
  onRenderCommitted,
}: {
  chakraPresetIndex: number;
  onRenderCommitted?: () => void;
}) {
  const soundSync = useMandalaSoundSync();
  return (
    <BreathBinduMandala
      isActive
      chakraPresetIndex={chakraPresetIndex}
      onRenderCommitted={onRenderCommitted}
      externalSync={soundSync}
    />
  );
}

function SyncedPracticeFooter({ baseFooter }: { baseFooter: ReactNode }) {
  const soundFrame = useMandalaSoundFrame();
  if (!HARMONIZER_TEST_MODE) return <>{baseFooter}</>;

  return (
    <>
      {baseFooter}
      <View style={styles.opticalFooter}>
        <Text style={styles.opticalMetricsMuted}>
          Mandala Sound: {soundFrame.targetHz.toFixed(1)} Гц · {soundFrame.band} · cloud{" "}
          {(soundFrame.flickerIntensity * 100).toFixed(0)}%
        </Text>
      </View>
    </>
  );
}

/**
 * Условный keep-awake: монтируется только во время активной фазы практики
 * (warmup/qualityCheck/running). Использует `useKeepAwake` hook (а не ручной
 * `activateKeepAwakeAsync` в `useEffect`), потому что hook корректно переживает
 * React 18 Strict Mode double-invoke (dev-client) — manual cleanup с async
 * `deactivateKeepAwake` мог отменить активацию после повторного mount.
 * Когда фаза практики заканчивается — компонент unmount, keep-awake снимается.
 */
function PracticeKeepAwake({ tag }: { tag: string }) {
  useKeepAwake(tag);
  return null;
}

/**
 * Внутренний экран. Использует Bus + Pipeline через context (см. `BiofeedbackProvider`),
 * подписывается на каналы, вместо прямой работы со снимками FingerSignalAnalyzer.
 *
 * Принимает initial*-поля из публичных пропсов `CoherenceBreathScreen`:
 *   - `initialPracticeId` — стартовое значение локального state (пользователь
 *     всё ещё может сменить практику на idle-экране);
 *   - `durationMs`        — не даёт пользователю менять длительность в UI,
 *     но заменяет `TIMING.totalMs` для этой сессии; если не задано —
 *     используется `DEFAULT_COHERENCE_TEST_TIMING.totalMs`;
 *   - `chakra`            — 1..7; преобразуется в `chakraPresetIndex` (0..6)
 *     для `<BreathBinduMandala />`.
 *   - `launchSource`      — источник запуска для `practice_sessions.context`.
 */
function CoherenceBreathScreenInner({
  locale,
  initialPracticeId,
  durationMs,
  chakra,
  soundBed = SOUND_BED_NEURO_SYNC,
  initialTempoKey,
  launchSource,
  sensorMode,
  deviceId,
  deviceName,
  provider,
  capabilityTier,
  connectionHint,
  autoReconnect = true,
  usePulseSensor = true,
}: {
  locale: BreathLocale;
  initialPracticeId?: BreathPracticeId;
  durationMs?: number;
  chakra?: import("@/modules/breath/core/chakra").Chakra;
  soundBed?: SoundBedId;
  /** Tempo key from the practice card / launch (`6` or `4:4:4`). */
  initialTempoKey?: string;
  launchSource?: string;
  sensorMode?: BreathSensorMode;
  deviceId?: string;
  deviceName?: string;
  provider?: WearableDeviceProvider;
  capabilityTier?: string;
  connectionHint?: string;
  autoReconnect?: boolean;
  usePulseSensor?: boolean;
}) {
  /**
   * Важно: `useIsFocused()` может временно становиться `false` в iOS-сценариях
   * вроде системного оверлея/SMS (AppState `inactive`), хотя пользователь
   * объективно остаётся на экране практики и палец остаётся на сенсоре.
   *
   * Для ресурсов (камера/PPG) используем `useFocusEffect`: он отражает именно
   * blur/unmount маршрута — т.е. пользователь реально ушёл с экрана дыхания.
   */
  const [breathRouteVisible, setBreathRouteVisible] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setBreathRouteVisible(true);
      return () => setBreathRouteVisible(false);
    }, []),
  );
  const theme = useTheme();
  const str = useMemo(() => getCoherenceBreathStrings(locale), [locale]);
  const affirmationGateRef = useRef<AffirmationBreathGate | null>(null);
  /** Catalog / Day / assistant — leave breath screen without the legacy idle picker. */
  const returnToPracticeOrigin = useCallback(() => {
    const normalized = (launchSource ?? "").trim().toLowerCase();
    if (normalized === "assistant" || normalized === "day") {
      try {
        router.replace("/day");
        return;
      } catch {
        /* fall through */
      }
    }
    try {
      router.back();
    } catch {
      try {
        router.replace("/practices");
      } catch {
        try {
          router.replace("/");
        } catch {
          /* ignore */
        }
      }
    }
  }, [launchSource]);
  const pipeline = useBiofeedbackPipeline();
  const bus = useBiofeedbackBus();
  const wearablePreferences = useWearablePreferences();
  const resolvedSensorMode: BreathSensorMode =
    sensorMode === "ble" || sensorMode === "none" || sensorMode === "fingerCamera"
      ? sensorMode
      : usePulseSensor === false
        ? "none"
        : "fingerCamera";
  const isWearableMode = resolvedSensorMode === "ble";
  const isFingerCameraMode = resolvedSensorMode === "fingerCamera";
  const allowAdvancedMetrics =
    isWearableMode || (isFingerCameraMode && ENABLE_FINGER_CAMERA_ADVANCED_METRICS);
  const cameraGuidanceOnlyMode = isFingerCameraMode && !allowAdvancedMetrics;
  const initialCapabilityTierResolved: WearableCapabilityTier =
    capabilityTier === "fullMetrics" ||
    capabilityTier === "guidedOnly" ||
    capabilityTier === "unsupported" ||
    capabilityTier === "unknown"
      ? capabilityTier
      : wearablePreferences.lastCapabilityTier ?? "unknown";
  const [selectedWearableDevice, setSelectedWearableDevice] = useState<WearableScanCandidate | null>(
    resolvedSensorMode === "ble" && (deviceId || wearablePreferences.lastDeviceId)
      ? {
          id: deviceId ?? wearablePreferences.lastDeviceId ?? "",
          name: deviceName ?? wearablePreferences.lastDeviceName ?? "BLE HR",
          localName: deviceName ?? wearablePreferences.lastDeviceName,
          rssi: null,
          hasHeartRateService: true,
          isConnectable: true,
          provider:
            provider === "polar" ||
            provider === "magene" ||
            provider === "coospo" ||
            provider === "genericHrs" ||
            provider === "unknown"
              ? provider
              : wearablePreferences.lastProvider ?? "genericHrs",
          capabilityTier: initialCapabilityTierResolved,
          connectionHint: connectionHint ?? undefined,
        }
      : null,
  );
  const [wearableRuntime, setWearableRuntime] = useState<WearableRuntimeSnapshot>({ state: "idle" });
  const [wearableCapabilityTier, setWearableCapabilityTier] =
    useState<WearableCapabilityTier>(initialCapabilityTierResolved);
  const wearableRuntimeRef = useRef(wearableRuntime);
  wearableRuntimeRef.current = wearableRuntime;
  const wearableCapabilityTierRef = useRef(wearableCapabilityTier);
  wearableCapabilityTierRef.current = wearableCapabilityTier;
  const [showWearablePickerDialog, setShowWearablePickerDialog] = useState(false);
  const snapshot = useBiofeedbackSnapshot();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const pulseBpmLast = useBiofeedbackChannel("pulseBpm");
  // ПРИНЦИПИАЛЬНО: не подписываемся на "coherence"/"rmssd"/"stress" на уровне компонента —
  // любая подписка через `useBiofeedbackChannel` вызывает re-render всего
  // `CoherenceBreathScreenInner` (а с ним — мандалы, индикатора дыхания, всех useMemo).
  // Coherence/RMSSD/стресс нужны только для результатов и считаются в `finalize()`.
  // Единственный подписчик coherence-канала — отдельный эффект ниже (для `planner`).
  // Подписка держит провайдер в курсе источника (UI использует `finalPulseWasEmulated`,
  // но канал нужен, чтобы React перерендеривал компонент при смене источника и
  // snapshot-кэш канала оставался заполненным).
  useBiofeedbackChannel("pulseSource");
  const [useEmulatedPulseMode, setUseEmulatedPulseMode] = useState(false);
  /** When true, FingerPpg camera/torch must not mount (user chose no pulse sensor). */
  const [disableOpticalHardware, setDisableOpticalHardware] = useState(
    () => resolvedSensorMode === "none",
  );
  const [emulatedPulseSeedBpm, setEmulatedPulseSeedBpm] = useState<number | null>(null);
  const [emulatedFallbackSource, setEmulatedFallbackSource] =
    useState<"camera" | "wearable" | null>(null);
  const [cameraRecoveryProbeActive, setCameraRecoveryProbeActive] = useState(false);
  const useEmulatedPulseModeRef = useRef(false);
  const emulatedPulseSeedBpmRef = useRef<number | null>(null);
  const cameraRecoveryProbeStartedAtWallMsRef = useRef<number | null>(null);
  useEffect(() => {
    useEmulatedPulseModeRef.current = useEmulatedPulseMode;
  }, [useEmulatedPulseMode]);
  useEffect(() => {
    emulatedPulseSeedBpmRef.current = emulatedPulseSeedBpm;
  }, [emulatedPulseSeedBpm]);
  useEffect(() => {
    pipeline.setMetricsCapturePaused(!allowAdvancedMetrics);
  }, [allowAdvancedMetrics, pipeline]);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionStartWallMs, setSessionStartWallMs] = useState<number | null>(null);
  const [sessionStartLogicalMs, setSessionStartLogicalMs] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<CoherenceSessionResult | null>(null);
  const [exportDebug, setExportDebug] = useState<CoherenceExportDebug | null>(null);
  /** Финальные live-метрики (RMSSD, стресс), зафиксированные в момент завершения практики. */
  const [finalRmssdMs, setFinalRmssdMs] = useState<number | null>(null);
  const [finalStressPercent, setFinalStressPercent] = useState<number | null>(null);
  /**
   * Был ли пульс эмулированным на момент завершения сессии. Фиксируем, чтобы на экране
   * результатов не зависеть от живого канала `pulseSource` (он может переключиться при
   * следующей сессии раньше, чем пользователь уйдёт с results).
   */
  const [finalPulseWasEmulated, setFinalPulseWasEmulated] = useState(false);
  const [finalSignalTrust, setFinalSignalTrust] =
    useState<BiofeedbackSignalTrustSummary | null>(null);
  const [finalHrvRecoveredFromTail, setFinalHrvRecoveredFromTail] = useState(false);
  const [finalCoherenceRecoveredFromTail, setFinalCoherenceRecoveredFromTail] = useState(false);
  const [finalCoherenceTailWindowMs, setFinalCoherenceTailWindowMs] = useState<number | null>(null);

  // ─── Гибридный режим измерения ─────────────────────────────────────────
  //
  // ВАЖНО (апр 2026): обнаружилось, что переход в `emulated` фазу не даёт
  // ожидаемого облегчения тепла/памяти — замедление UI в последние 2 мин
  // практики наблюдается ОДИНАКОВО при наличии эмуляции и без неё (см.
  // тест 1776891125997: jsTimerLag ≈ 1000 мс с первых же секунд, UI fps
  // p5 падает до 11-15 в realEnd независимо от того, был ли emulated-
  // период). Следовательно, замыкание камеры в середине ничего не
  // экономит, но лишает пользователя живого RSA-индикатора (baseline
  // заморожен, реальных beats нет → план цикла замирает).
  //
  // Решение: `ENABLE_HYBRID_EMULATION = false` — PPG течёт всю практику,
  // индикатор синхронизируется с реальным пульсом через
  // `BreathPhasePlanner.planNextCycle()` (который уже умеет
  // полуволновую RSA-модуляцию длин фаз). HybridController **продолжает
  // работать** и размечает границы `rs` и `re` для dual-window merge
  // метрик в `mergeHybridCoherenceSessionResults` — т.е. отчёт по-прежнему
  // строится только по началу и концу практики, но данные accumulated
  // непрерывно.
  //
  // Чтобы вернуть прежнее поведение (если окажется, что thermal всё же
  // важен на слабых устройствах) — достаточно поставить флаг в `true`,
  // никакие другие места править не нужно.
  const ENABLE_HYBRID_EMULATION = false;
  const hybridMeasurementEnabled =
    allowAdvancedMetrics && !isWearableMode && !useSimulatedPpg;

  const hybridControllerRef = useRef<HybridMeasurementController>(new HybridMeasurementController());
  /**
   * Текущая фаза гибридного режима. Держим в `ref`, а не в `state`, чтобы
   * не вызывать перерендеры на границе фаз — UI во время `emulated` намеренно
   * выглядит идентично `realStart`, чтобы пользователь не заметил перехода.
   */
  const hybridPhaseRef = useRef<HybridPhase>("realStart");
  const thermalStateRef = useRef<ThermalState>("nominal");
  /**
   * `silent=true` → FingerPpgCameraSource держит камеру и фонарик активными,
   * но worklet не вызывает native-плагин. Включается на фазе emulated.
   */
  const [cameraSilent, setCameraSilent] = useState(false);
  /**
   * Границы окон реальных измерений в логической шкале времени
   * (camera-presentation ms). Держим в `ref`, чтобы не заставлять finalize-
   * эффект пере-регистрировать `setInterval` при смене фаз гибрида.
   */
  const realStartEndedAtMsRef = useRef<number | null>(null);
  const realEndStartedAtMsRef = useRef<number | null>(null);
  /**
   * Финальные dual-window метрики. На экране результатов показываются две
   * колонки: «начало» и «конец», без усреднения между ними.
   */
  const [finalStartHrv, setFinalStartHrv] = useState<PracticeHrvMetricsResult | null>(null);
  const [finalEndHrv, setFinalEndHrv] = useState<PracticeHrvMetricsResult | null>(null);
  const [finalStartAnalysis, setFinalStartAnalysis] = useState<CoherenceSessionResult | null>(null);
  const [finalEndAnalysis, setFinalEndAnalysis] = useState<CoherenceSessionResult | null>(null);
  const [finalStartAvgBpm, setFinalStartAvgBpm] = useState<number | null>(null);
  const [finalEndAvgBpm, setFinalEndAvgBpm] = useState<number | null>(null);
  const [finalStartWindowMs, setFinalStartWindowMs] = useState<number | null>(null);
  const [finalEndWindowMs, setFinalEndWindowMs] = useState<number | null>(null);
  const [resultsGraphs, setResultsGraphs] = useState<BreathResultsGraphsSnapshot | null>(null);

  /**
   * Рамп-таймер плавного перехода baselineBpm при переходе в emulated.
   * Живёт только во время 10-секундного ramp'а, очищается либо сам собой
   * при достижении target'а, либо при смене фазы / сбросе практики.
   */
  const baselineRampTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopBaselineRamp = useCallback(() => {
    if (baselineRampTimerRef.current) {
      clearInterval(baselineRampTimerRef.current);
      baselineRampTimerRef.current = null;
    }
  }, []);
  const startBaselineRampTo = useCallback(
    (targetBpm: number) => {
      stopBaselineRamp();
      const planner = plannerRef.current;
      const fromBpm = planner.getBaselineBpm();
      const startMs = Date.now();
      if (!(targetBpm > 0) || Math.abs(targetBpm - fromBpm) < 0.5) {
        // Нечего ramp'ить — просто фиксируем target.
        planner.seedBaseline(targetBpm > 0 ? targetBpm : fromBpm);
        return;
      }
      baselineRampTimerRef.current = setInterval(() => {
        const t = Math.min(1, (Date.now() - startMs) / HYBRID_BASELINE_RAMP_MS);
        const bpm = fromBpm + (targetBpm - fromBpm) * t;
        planner.seedBaseline(bpm);
        if (t >= 1) {
          stopBaselineRamp();
        }
      }, HYBRID_BASELINE_RAMP_STEP_MS);
    },
    [stopBaselineRamp],
  );

  /** TAG_REMOVE_PERF_DIAGNOSTICS — удалить вместе с `session-runtime-diagnostics.ts`. */
  const perfDiagnosticsRef = useRef(new SessionRuntimeDiagnostics());
  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — jank-детектор.
   *
   * Собирает UI FPS, frame-processor latency и JS-loop lag в скользящем окне
   * (~5 с). Hybrid-тикер читает `shouldTriggerEmulated()` каждую секунду —
   * если приложение уже заметно деградирует, уходим в emulated, не
   * дожидаясь iOS `thermalState`.
   */
  const jankDetectorRef = useRef(new JankDetector());
  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — последние прочитанные значения native
   * memory / battery / jank-snapshot. Обновляем периодически (1 Гц) из
   * main-тикера и читаем синхронно в `recordPerfDiagSample`.
   */
  const nativeMemoryMbRef = useRef<number | null>(null);
  const batteryLevelPctRef = useRef<number | null>(null);
  /** Причина последнего перехода фазы — помечается в текущем сэмпле и сбрасывается. */
  const pendingHybridTransitionReasonRef = useRef<
    "thermal" | "jank" | "timeCap" | "endWindow" | null
  >(null);
  /**
   * Колбэк, который FingerPpgCameraSource зовёт на каждый обработанный кадр.
   * Стабильная функция (useRef-обёртка на detector), чтобы не пересоздавать
   * worklet-мост в source'е (см. комментарий к React.memo в source'е).
   */
  const handleFrameStats = useCallback(
    ({ processingMs, receivedAtMs }: { processingMs: number; receivedAtMs: number }) => {
      jankDetectorRef.current.pushFrameProcLatency(receivedAtMs, processingMs);
    },
    [],
  );

  /**
   * Cycle-delayed playback: план каждого цикла фиксируется на его старте и меняется
   * только по `onCycleEnd`. Это устраняет дёрганье индикатора.
   *
   * Planner обновляет только свой baseline EMA (таймер 250 мс), сам план пересчитывается
   * планировщиком **только** при запросе `planNextCycle()` — на границе цикла.
   */
  const plannerRef = useRef<BreathPhasePlanner>(new BreathPhasePlanner());
  const [currentPlan, setCurrentPlan] = useState<PlannedCycle | null>(null);
  const currentPlanRef = useRef<PlannedCycle | null>(null);
  currentPlanRef.current = currentPlan;
  const [cycleStartMs, setCycleStartMs] = useState<number | null>(null);
  const cycleStartMsRef = useRef<number | null>(null);
  cycleStartMsRef.current = cycleStartMs;
  /**
   * История планов за сессию (для diagnostic export). Содержит и legacy-поля
   * `plannedInhaleMs/plannedExhaleMs` (для обратной совместимости), и полный
   * список фаз — чтобы корректно экспортировать треугольник/квадрат/нади.
   */
  type PhaseHistoryEntry = {
    planIndex: number;
    cycleMs: number;
    plannedInhaleMs: number;
    plannedExhaleMs: number;
    baselineBpm: number;
    rsaBpm: number | null;
    phases: {
      kind: "inhale" | "exhale" | "hold";
      channel: "both" | "left" | "right";
      beats: number;
      phaseMs: number;
      bpmForPhase: number;
    }[];
  };
  const phaseDurationsHistoryRef = useRef<PhaseHistoryEntry[]>([]);
  /**
   * Собрать запись истории дыхательных циклов из `PlannedCycle`. Логика в
   * одном месте, чтобы не дублировать маппинг `PlannedPhase[] → phases[]`
   * в трёх точках записи.
   */
  const planToHistoryEntry = useCallback(
    (plan: PlannedCycle, planIndex: number): PhaseHistoryEntry => ({
      planIndex,
      cycleMs: plan.cycleMs,
      plannedInhaleMs: plan.phases.find((p) => p.kind === "inhale")?.phaseMs ?? 0,
      plannedExhaleMs: plan.phases.find((p) => p.kind === "exhale")?.phaseMs ?? 0,
      baselineBpm: plan.baselineBpm,
      rsaBpm: plan.rsaInfo?.rsaBpm ?? null,
      phases: plan.phases.map((p) => ({
        kind: p.kind,
        channel: p.channel,
        beats: p.beats,
        phaseMs: Math.round(p.phaseMs),
        bpmForPhase: Math.round(p.bpmForPhase * 10) / 10,
      })),
    }),
    [],
  );
  /** baseline BPM в planner-е: (t_since_session_start_ms, bpm). */
  const baselineBpmSeriesRef = useRef<{ tMs: number; bpm: number }[]>([]);
  /** Сводка по завершённым RSA-циклам. */
  const rsaCyclesSummaryRef = useRef<
    { tMs: number; hrInhale: number; hrExhale: number; rsaBpm: number; durationMs: number }[]
  >([]);
  const rmssdSeriesRef = useRef<BreathResultsSeriesPoint[]>([]);
  const stressSeriesRef = useRef<BreathResultsSeriesPoint[]>([]);
  const [sourceKey, setSourceKey] = useState(0);
  /** Уникальный счётчик «сессий PPG» для legacy совместимости в debug-метаполях. */
  const fingerSessionKey = sourceKey;

  /**
   * Текущий выбор дыхательной практики (выбирается на idle-экране). При смене практики
   * на idle shape пересчитывается из дескриптора; в активной сессии пользователь
   * практику не меняет — только базовое число ударов.
   */
  const [practiceId, setPracticeId] = useState<BreathPracticeId>(
    initialPracticeId ?? "coherent",
  );
  /**
   * Фактическая длительность этой сессии. Берётся из пропа `durationMs`, если
   * задан; иначе — `TIMING.totalMs` (20 мин). Все места, где раньше читался
   * `TIMING.totalMs` как длительность — теперь читают `practiceTotalMs`.
   */
  const practiceTotalMs = useMemo(
    () =>
      typeof durationMs === "number" && durationMs > 0
        ? durationMs
        : TIMING.totalMs,
    [durationMs],
  );
  /** Индекс пресета для `<BreathBinduMandala />` (0..6). */
  const mandalaChakraIndex = useMemo(() => {
    const ch = chakra ?? 3;
    return Math.max(0, Math.min(6, ch - 1));
  }, [chakra]);
  const practice: BreathPracticeDescriptor = useMemo(
    () => getBreathPracticeById(practiceId),
    [practiceId],
  );

  /**
   * Темп практики: одно число (`6`) или тройка для треугольников (`4:8:16`).
   * Источник — launch/карточка; во время running меняется стрелками оверлея.
   */
  const [tempoKey, setTempoKey] = useState<string>(() =>
    resolveTempoKey(practice.id, initialTempoKey ?? getBreathTempoForPractice(practice.id)),
  );
  // Reset tempo when the practice (or launch tempo) changes.
  useEffect(() => {
    setTempoKey(
      resolveTempoKey(practice.id, initialTempoKey ?? getBreathTempoForPractice(practice.id)),
    );
  }, [practice.id, initialTempoKey]);

  const coherenceShape = useMemo(
    () => buildShapeForTempo(practice, tempoKey),
    [practice, tempoKey],
  );
  const isTriangleTempo = isTriangleBreathPracticeId(practice.id);
  const parsedTempo = parseTempoKey(tempoKey);
  const singleTempoBeats =
    parsedTempo?.mode === "single" ? parsedTempo.beats : practice.normalBaseBeats;
  const tripleTempoBeats =
    parsedTempo?.mode === "triple"
      ? ([parsedTempo.beats[0], parsedTempo.beats[1], parsedTempo.beats[2]] as [
          number,
          number,
          number,
        ])
      : ([practice.normalBaseBeats, practice.normalBaseBeats, practice.normalBaseBeats] as [
          number,
          number,
          number,
        ]);
  const coherenceShapeRef = useRef(coherenceShape);
  coherenceShapeRef.current = coherenceShape;
  /** Стабильный ref на текущий practice.id — чтобы читать его в finalize без пересоздания эффекта. */
  const practiceIdRef = useRef<BreathPracticeId>(practiceId);
  practiceIdRef.current = practiceId;
  /**
   * Shape, по которому построен **текущий** план в shell. Используется чтобы реагировать
   * на смену скорости на ближайшей границе фазы: если `lastAppliedShape !== coherenceShape`,
   * надо пересобрать план. Иначе — не трогаем текущий, он сам доиграет до cycle-end.
   */
  const lastAppliedShapeRef = useRef(coherenceShape);

  const warmupStartedAtMs = useRef<number | null>(null);
  const protocolStartedAtMs = useRef<number | null>(null);
  const qcStartLogicalMsRef = useRef<number | null>(null);
  const pulseLogRef = useRef<CoherencePulseLogEntry[]>([]);
  /**
   * Display-only beat timestamps for the camera guidance-only R–R chart.
   * Camera mode pauses HRV capture and never opens a coherence session, so
   * `beatTimestampsMsAnalyzed` stays empty; `mergedBeats` is also trimmed to
   * ~2 min. We append newer merged beats here across the full practice.
   */
  const displayRrBeatsRef = useRef<number[]>([]);
  const qcPulseSamplesRef = useRef<QcPulseSample[]>([]);
  const opticalPreviewBufferRef = useRef<RawOpticalSample[]>([]);
  const lastOpticalPreviewRefreshWallMsRef = useRef(0);
  const lastPulseLogWallClockRef = useRef(0);
  const lastLoggedMeasuredBpmRef = useRef(0);
  const lastLoggedGuidanceBpmRef = useRef(0);
  const lastFreshBeatSourceTsRef = useRef<number | null>(null);
  const lastFreshBeatWallClockRef = useRef<number | null>(null);
  /**
   * True once a trusted (coherent/bridging) beat has arrived DURING the `running` phase.
   * Until then, the emulated-fallback uses a short start-grace instead of the full 20 s:
   * on a marginal-PPG start the peak detector can lose lock in settle's tail (last beat
   * ~10 s before `running`), so staleness at t=0 is already ~10 s and the 20 s threshold
   * would leave ~10 s of gray non-pacing measurement at start. The product spec wants a
   * long loss to switch to a synthetic sine wave; at start there's no prior live running
   * beat to "recover" to, so the short grace is safe. Reset to false on each running start.
   */
  const runningLiveBeatSeenRef = useRef(false);
  const finalPulseLogExportRef = useRef<CoherencePulseLogEntry[] | null>(null);
  const snapshotCallbacksTotalRef = useRef(0);
  const snapshotsWhileRunningRef = useRef(0);
  const runtimeDiagnosticsStartSeqRef = useRef(0);

  /**
   * Счётчики активности для диагностики накопительного торможения.
   * Инкрементируются в соответствующих точках; сбрасываются в cleanup
   * при выходе из running. Все кумулятивные от начала сессии.
   * См. `PerfDiagSample.activityCounters`.
   */
  const renderCountInnerRef = useRef(0);
  const mandalaRenderCountRef = useRef(0);
  const rafTicksCumulativeRef = useRef(0);
  const hybridTickCountRef = useRef(0);
  const perfDiagTickCountRef = useRef(0);
  const nativeSamplerTickCountRef = useRef(0);

  // Инкрементируем счётчик ре-рендеров Inner-компонента.
  // Инкремент в теле функции безопасен для ref'ов и даёт честное число
  // коммитов, которые прошли React.
  renderCountInnerRef.current += 1;

  // Стабильный callback для BreathBinduMandala: идентичность не
  // меняется → memo(BreathBinduMandala) не получает лишних ре-рендеров
  // из-за изменения проп. При каждом коммите Skia-канваса мандалы
  // инкрементирует диагностический счётчик.
  const handleMandalaRender = useCallback(() => {
    mandalaRenderCountRef.current += 1;
  }, []);

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — зафиксировать один сэмпл телеметрии.
   *
   * Отражает «портрет» приложения в момент вызова: тепловое состояние,
   * фаза гибрида, jank-метрики (FPS/frame-proc latency/JS lag), память
   * (heap + native RSS) и состояние камеры/торча. Все поля nullable, чтобы
   * на платформе без нужных API / при `PERF_DIAGNOSTICS_ENABLED=false`
   * экспорт оставался валидным.
   */
  const recordPerfDiagSample = useCallback(() => {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (sessionStartWallMs == null) return;
    const now = Date.now();
    const jank = jankDetectorRef.current.getSnapshot();
    const phaseSnapshot = hybridPhaseRef.current;
    // Реальный Finger PPG: сессия активна и при silent (1 fps + torch у VC);
    // нативный torch-only режим снят — iOS гасил LED без capture-сессии.
    const cameraSessionActive = !useSimulatedPpg && !useEmulatedPulseMode;
    const torchHeldByNative = false;
    const collectionSizesFromPipeline = pipeline.getCollectionSizes();
    perfDiagnosticsRef.current.push({
      wallClockMs: now,
      sessionOffsetMs: now - sessionStartWallMs,
      thermalState: thermalStateRef.current,
      hybridPhase: phaseSnapshot,
      cameraSilent,
      cameraSessionActive,
      torchHeldByNative,
      opticalPaused: pipeline.isOpticalPaused(),
      hybridTransitionReason: pendingHybridTransitionReasonRef.current,
      uiFpsMedian: jank.uiFpsMedian,
      uiFpsP5: jank.uiFpsP5,
      frameProcLatencyMsAvg: jank.frameProcLatencyMsAvg,
      frameProcLatencyMsP95: jank.frameProcLatencyMsP95,
      cameraFrameIntervalMsAvg: jank.cameraFrameIntervalMsAvg,
      jsTimerLagMsAvg: jank.jsTimerLagMsAvg,
      usedJsHeapBytes: readJsHeapUsedBytes(),
      nativeMemoryMb: nativeMemoryMbRef.current,
      metricsCapturePaused: pipeline.isMetricsCapturePaused(),
      activityCounters: {
        renderCountInner: renderCountInnerRef.current,
        mandalaRenderCount: mandalaRenderCountRef.current,
        rafTicksCumulative: rafTicksCumulativeRef.current,
        hybridTickCount: hybridTickCountRef.current,
        perfDiagTickCount: perfDiagTickCountRef.current,
        nativeSamplerTickCount: nativeSamplerTickCountRef.current,
      },
      collectionSizes: {
        mergedBeats: collectionSizesFromPipeline.mergedBeats,
        sessionBeatsInCoherence: collectionSizesFromPipeline.sessionBeatsInCoherence,
        hrvAccumulatorBeats: collectionSizesFromPipeline.hrvAccumulatorBeats,
        baselineBpmSeries: baselineBpmSeriesRef.current.length,
        phaseDurationsHistory: phaseDurationsHistoryRef.current.length,
        rsaCyclesSummary: rsaCyclesSummaryRef.current.length,
        pulseLog: pulseLogRef.current.length,
        opticalPreviewBuffer: opticalPreviewBufferRef.current.length,
      },
      counters: {
        snapshotCallbacksTotal: snapshotCallbacksTotalRef.current,
        snapshotsWhileRunning: snapshotsWhileRunningRef.current,
        opticalPipelinePushes: pipeline.getPerfDiagnosticOpticalPushCount(),
      },
    });
    // transitionReason — one-shot: пометили последний сэмпл и сбросили.
    pendingHybridTransitionReasonRef.current = null;
  }, [sessionStartWallMs, cameraSilent, pipeline, useSimulatedPpg, useEmulatedPulseMode]);

  const [opticalPreviewSamples, setOpticalPreviewSamples] = useState<RawOpticalSample[]>([]);

  /** Маска секунд практики, в которые сигнал был некачественным → BPM=0 на тахограмме. */
  const qualityBadAccumMsRef = useRef(0);
  const fingerAbsentAccumMsRef = useRef(0);
  const lastSampleMsRef = useRef<number | null>(null);
  /** `getLastSourceTimestampMs` не продвигается — застой optical (накопление по 250 мс wall). */
  const opticalStallAccumMsRef = useRef(0);
  const lastCameraTsForStallRef = useRef<number | null>(null);
  const autoAbortAccumMsRef = useRef(0);
  /** Нет пальца: накопление по wall-clock (только foreground), мс. */
  const fingerAbsentWallMsRef = useRef(0);
  const fingerRecoveredWallMsRef = useRef(0);
  /** Время ухода в `background` во время running (для логики при возврате). */
  const practiceBackgroundEnteredAtRef = useRef<number | null>(null);
  const sessionAbortHandledRef = useRef(false);
  const applyHardPracticeExitRef = useRef<() => void>(() => {});
  const appStateRef = useRef(AppState.currentState);

  /** Обратный отсчёт окна QC (секунды по времени камеры); `null` — ждём первую метку. */
  const [qcSecondsLeft, setQcSecondsLeft] = useState<number | null>(null);
  /** Обратный отсчёт всего protocol-а прогрев+QC для кругового индикатора (сек). */
  const [prepSecondsLeft, setPrepSecondsLeft] = useState<number | null>(null);
  /** Показать диалог «QC не прошёл — продолжить без датчика / повторить». */
  const [showQcFailedDialog, setShowQcFailedDialog] = useState(false);
  /** Практика авто-прервана (потеря доверия к сигналу) — диалог на idle. */
  const [showAutoAbortDialog, setShowAutoAbortDialog] = useState(false);
  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS
   *
   * Последний вычисленный «снимок QC-окна» — детализированный срез
   * проверок активации пульсометра в момент принятия решения (успех /
   * failure). Хранит pulseSamples, stableSamples, stableFraction,
   * bpmStdev, meanSignalQuality и флаги, какие именно условия «ok»
   * прошли/не прошли. Используется `exportActivationDiagnostic` для
   * включения в JSON — чтобы разобрать ПРИЧИНУ, почему конкретная
   * попытка не была активирована, не только текущий snapshot.
   */
  /**
   * Ref-callback для ручного/автоматического экспорта диагностики активации.
   * `exportActivationDiagnostic` определён ниже через `useCallback`, но нам
   * нужно иногда вызывать его из других мест по файлу — через ref обходим
   * порядок объявления и избегаем stale closure.
   */
  const exportActivationDiagnosticRef = useRef<
    ((reason?: string) => Promise<void>) | null
  >(null);

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS
   *
   * Идентификатор и счётчик попыток активации пульсометра в рамках **одной
   * сессии выбора практики**. Пользователь выбрал пранаяму → sessionId
   * создаётся один раз и attemptNumber = 1. Нажал «Повторить» в диалоге
   * «Пульс не распознан» → attemptNumber увеличивается, sessionId тот же.
   * Вышел в idle (cancel / успешный вход в running) → сбрасывается, при
   * следующем запуске создастся новый sessionId.
   *
   * Нужно в бета-периоде для группировки отладочных JSON по реальным
   * «походам пользователя к практике», а в перспективе — для
   * автоматической телеметрии в облаке.
   */
  const activationSessionIdRef = useRef<string | null>(null);
  const activationAttemptNumberRef = useRef<number>(0);
  const qcLastEvaluationRef = useRef<{
    timestampMs: number;
    elapsedMs: number;
    isFinalCheck: boolean;
    beatsInWinCount: number;
    pulseSamplesCount: number;
    stableSamplesCount: number;
    stableFraction: number;
    bpmStdev: number;
    meanSignalQuality: number;
    snapSignalQuality: number;
    conditions: {
      signalQualityOk: boolean;
      beatsInWinOk: boolean;
      stableSamplesOk: boolean;
      stableFractionOk: boolean;
      bpmStdevOk: boolean;
      bpmAgreementOk: boolean;
    };
    bpmAgreement: {
      snapBpm: number;
      peakBpm: number;
      diffBpm: number | null;
    };
    pulseSamples: readonly QcPulseSample[];
  } | null>(null);
  /**
   * Исход QC для экспорта: `ok` | `user_chose_no_sensor` | `retry_failed` | `null`.
   * `retry_failed` выставляется если пользователь закрыл диалог в текущей реализации не будет
   * использовано (кнопка «Попробовать снова» сбрасывает в null и снова запускает warmup),
   * оставлено на будущее для статистики.
   */
  const qcOutcomeRef = useRef<"ok" | "user_chose_no_sensor" | "retry_failed" | null>(null);

  /**
   * Всплывающая снизу панель управления.
   *  - появляется при тапе по «чёрному» полотну экрана (мандала + индикатор);
   *  - если тап попал по самой панели / её контролам → таймер бездействия сбрасывается;
   *  - по истечении `OVERLAY_AUTOHIDE_MS` без касаний панель уезжает вниз.
   */
  const {
    overlayVisible,
    setOverlayVisible,
    clearOverlayTimer,
    scheduleOverlayHide,
    toggleOverlay,
  } = useImmersiveOverlayAutohide({ autoHideMs: OVERLAY_AUTOHIDE_MS, initialVisible: false });
  /** Диалог подтверждения досрочного выхода из практики (крестик на панели). */
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const autoStartedRef = useRef(false);

  /**
   * Переход между окном «Активация пульсометра» и экраном дыхания.
   *
   * Делаем «fade-to-black-and-back»: поверх всего появляется чёрная штора,
   * под ней sensor-UI аккуратно размонтируется и появляется running-UI, и только
   * после полного её исчезновения `isBreathTimingActive` становится `true`. Cross-fade
   * не годится — индикатор успевал «просачиваться» через затухающую sensor-UI.
   */
  const blackCurtainSv = useSharedValue(0);
  const [sensorUiMounted, setSensorUiMounted] = useState(false);
  const [runningUiRevealed, setRunningUiRevealed] = useState(false);
  const [isBreathTimingActive, setIsBreathTimingActive] = useState(false);

  /** UI banners. */
  const [ppgOverlayMessage, setPpgOverlayMessage] = useState<string | null>(null);
  const cameraGuidanceReminderShownRef = useRef(false);
  const prevFingerDetectedForBannerRef = useRef(true);
  const prevBadSignalForBannerRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const appendPulseLogMarker = useCallback((entry: {
    measuredPulseRateBpm: number;
    guidancePulseRateBpm: number;
    pulseReady: boolean;
    emulatedActive: boolean;
    pulseSource: "fingerCamera" | "wearable" | "emulated";
    wearableState?: string | null;
    wearableHeartRateBpm?: number | null;
    wearableLastRrAgeMs?: number | null;
    wearableSensorContactDetected?: boolean | null;
  }) => {
    if (phaseRef.current !== "running" || sessionStartLogicalMs == null || sessionStartWallMs == null) {
      return;
    }
    const wall = Date.now();
    const logTimestampMs = sessionStartLogicalMs + (wall - sessionStartWallMs);
    pulseLogRef.current.push({
      cameraTimestampMs: logTimestampMs,
      wallClockMs: wall,
      pulseRateBpm: entry.measuredPulseRateBpm,
      measuredPulseRateBpm: entry.measuredPulseRateBpm,
      guidancePulseRateBpm: entry.guidancePulseRateBpm,
      signalQuality: snapshotRef.current.signalQuality,
      pulseReady: entry.pulseReady,
      fingerDetected: snapshotRef.current.fingerDetected,
      pulseLockState: snapshotRef.current.pulseLockState,
      beatTimestampsCount: pipeline.getMergedBeats().length,
      lastBeatTimestampMs: lastFreshBeatSourceTsRef.current,
      lastBeatAgeMs:
        lastFreshBeatSourceTsRef.current != null
          ? Math.max(0, logTimestampMs - lastFreshBeatSourceTsRef.current)
          : null,
      pulseSource: entry.pulseSource,
      emulatedActive: entry.emulatedActive,
      wearableState: entry.wearableState ?? null,
      wearableCapabilityTier: isWearableMode ? wearableCapabilityTierRef.current : null,
      wearableHeartRateBpm: entry.wearableHeartRateBpm ?? null,
      wearableLastRrAgeMs: entry.wearableLastRrAgeMs ?? null,
      wearableSensorContactDetected: entry.wearableSensorContactDetected ?? null,
      wearablePacketCount: isWearableMode ? (wearableRuntimeRef.current.packetCount ?? null) : null,
      wearableRrPacketCount: isWearableMode ? (wearableRuntimeRef.current.rrPacketCount ?? null) : null,
    });
  }, [isWearableMode, pipeline, sessionStartLogicalMs, sessionStartWallMs]);

  const switchToEmulatedPulse = useCallback((source: "camera" | "wearable", reason: string) => {
    if (useSimulatedPpg || useEmulatedPulseModeRef.current) {
      return;
    }
    const stableRrMs = pipeline.getLastStableRrMs();
    const plausibleBpm = pipeline.getLastPlausibleBpm();
    const wearableBpm = wearableRuntime.lastHeartRateBpm ?? null;
    // Camera seed: prefer the last COHERENT baseline RR (only updated when the engine saw a
    // low-jitter window). If there is none yet (session lived entirely on marginal-PPG
    // tracking), fall back to the last PLAUSIBLE displayBpm (50–110, slew-limited — noise
    // ~46 bpm сюда не попадает) before the safe resting default. Do NOT seed from the current
    // noisy `pulseRateBpm` — that gave ~46 bpm synthetic pacing. Clamp to physiological range
    // so a bogus low/high outlier can't drive breathing absurdly slow or fast.
    const cameraSeedRaw =
      stableRrMs > 0
        ? 60_000 / stableRrMs
        : (plausibleBpm > 0 ? plausibleBpm : CAMERA_EMULATED_SEED_DEFAULT_BPM);
    const cameraSeedClamped = Math.max(
      CAMERA_EMULATED_SEED_MIN_BPM,
      Math.min(CAMERA_EMULATED_SEED_MAX_BPM, cameraSeedRaw),
    );
    const fallbackBpm =
      source === "wearable"
        ? (
            snapshotRef.current.pulseRateBpm
            ?? (stableRrMs > 0 ? 60_000 / stableRrMs : null)
            ?? wearableBpm
          )
        : cameraSeedClamped;
    const seedBpm = Number.isFinite(fallbackBpm) && fallbackBpm > 0
      ? Math.round(fallbackBpm)
      : null;
    setEmulatedPulseSeedBpm(seedBpm);
    setEmulatedFallbackSource(source);
    setCameraRecoveryProbeActive(false);
    cameraRecoveryProbeStartedAtWallMsRef.current = null;
    setUseEmulatedPulseMode(true);
    if (source === "camera") {
      pipeline.setOpticalPaused(true);
    }
    if (source === "camera") {
      cameraGuidanceReminderShownRef.current = true;
      setPpgOverlayMessage(str.ppgFingerLostMessage);
    } else {
      setPpgOverlayMessage(null);
    }
    autoAbortAccumMsRef.current = 0;
    fingerAbsentWallMsRef.current = 0;
    fingerRecoveredWallMsRef.current = 0;
    opticalStallAccumMsRef.current = 0;
    sessionAbortHandledRef.current = true;
    appendPulseLogMarker({
      measuredPulseRateBpm: 0,
      guidancePulseRateBpm: seedBpm ?? snapshotRef.current.pulseRateBpm,
      pulseReady: false,
      emulatedActive: true,
      pulseSource: "emulated",
      wearableState: source === "wearable" ? wearableRuntimeRef.current.state : null,
      wearableHeartRateBpm: source === "wearable" ? (wearableRuntimeRef.current.lastHeartRateBpm ?? null) : null,
      wearableLastRrAgeMs:
        source === "wearable" && wearableRuntimeRef.current.lastRrAtMs != null
          ? Math.max(0, Date.now() - wearableRuntimeRef.current.lastRrAtMs)
          : null,
      wearableSensorContactDetected:
        source === "wearable" ? (wearableRuntimeRef.current.sensorContactDetected ?? null) : null,
    });
    logRuntimeEvent("breath:session_emulated_fallback", { source, reason, seedBpm }, "info");
  }, [appendPulseLogMarker, pipeline, str.ppgFingerLostMessage, useSimulatedPpg, wearableRuntime.lastHeartRateBpm]);

  const switchBackToLivePulse = useCallback((
    source: "camera" | "wearable",
    targetBpm?: number | null,
  ) => {
    if (!useEmulatedPulseModeRef.current || emulatedFallbackSource !== source) {
      return;
    }
    const nextBpm = targetBpm != null && Number.isFinite(targetBpm) && targetBpm > 0
      ? targetBpm
      : null;
    pipeline.setPulseSource(source === "camera" ? "fingerCamera" : "wearable");
    if (source === "camera") {
      pipeline.setOpticalPaused(false);
    }
    setUseEmulatedPulseMode(false);
    setEmulatedPulseSeedBpm(null);
    setEmulatedFallbackSource(null);
    setCameraRecoveryProbeActive(false);
    cameraRecoveryProbeStartedAtWallMsRef.current = null;
    setPpgOverlayMessage(null);
    autoAbortAccumMsRef.current = 0;
    fingerAbsentWallMsRef.current = 0;
    fingerRecoveredWallMsRef.current = 0;
    opticalStallAccumMsRef.current = 0;
    sessionAbortHandledRef.current = false;
    if (nextBpm != null) {
      startBaselineRampTo(nextBpm);
    }
    appendPulseLogMarker({
      measuredPulseRateBpm:
        source === "wearable"
          ? (nextBpm ?? wearableRuntimeRef.current.lastHeartRateBpm ?? 0)
          : (nextBpm ?? snapshotRef.current.pulseRateBpm),
      guidancePulseRateBpm: nextBpm ?? snapshotRef.current.pulseRateBpm,
      pulseReady: true,
      emulatedActive: false,
      pulseSource: source === "camera" ? "fingerCamera" : "wearable",
      wearableState: source === "wearable" ? wearableRuntimeRef.current.state : null,
      wearableHeartRateBpm: source === "wearable" ? (wearableRuntimeRef.current.lastHeartRateBpm ?? null) : null,
      wearableLastRrAgeMs:
        source === "wearable" && wearableRuntimeRef.current.lastRrAtMs != null
          ? Math.max(0, Date.now() - wearableRuntimeRef.current.lastRrAtMs)
          : null,
      wearableSensorContactDetected:
        source === "wearable" ? (wearableRuntimeRef.current.sensorContactDetected ?? null) : null,
    });
    logRuntimeEvent("breath:session_real_signal_restored", { source, targetBpm: nextBpm }, "info");
  }, [appendPulseLogMarker, emulatedFallbackSource, pipeline, startBaselineRampTo]);

  useEffect(() => {
    if (
      phase !== "running" ||
      !cameraGuidanceOnlyMode ||
      !useEmulatedPulseMode ||
      emulatedFallbackSource !== "camera" ||
      useSimulatedPpg ||
      cameraRecoveryProbeActive
    ) {
      return;
    }
    const id = setTimeout(() => {
      if (phaseRef.current === "running" && useEmulatedPulseModeRef.current) {
        pipeline.setPulseSource("fingerCamera");
        pipeline.setOpticalPaused(false);
        cameraRecoveryProbeStartedAtWallMsRef.current = Date.now();
        setCameraRecoveryProbeActive(true);
      }
    }, CAMERA_RECOVERY_PROBE_EVERY_MS);
    return () => clearTimeout(id);
  }, [
    cameraGuidanceOnlyMode,
    cameraRecoveryProbeActive,
    emulatedFallbackSource,
    phase,
    pipeline,
    useEmulatedPulseMode,
    useSimulatedPpg,
  ]);

  useEffect(() => {
    if (
      phase !== "running" ||
      !cameraGuidanceOnlyMode ||
      !useEmulatedPulseMode ||
      emulatedFallbackSource !== "camera" ||
      !cameraRecoveryProbeActive
    ) {
      return;
    }
    let cancelled = false;
    const tryRestore = () => {
      const snap = snapshotRef.current;
      const probeStartedAtWallMs = cameraRecoveryProbeStartedAtWallMsRef.current;
      const freshBeatAfterProbe =
        probeStartedAtWallMs != null &&
        lastFreshBeatWallClockRef.current != null &&
        lastFreshBeatWallClockRef.current >= probeStartedAtWallMs;
      const looksRecovered =
        snap.fingerDetected &&
        snap.pulseLockState === "tracking" &&
        snap.signalQuality >= CAMERA_RECOVERY_MIN_SIGNAL_QUALITY &&
        freshBeatAfterProbe &&
        snap.pulseRateBpm > 0;
      if (looksRecovered) {
        switchBackToLivePulse("camera", snap.pulseRateBpm);
        return true;
      }
      return false;
    };
    if (tryRestore()) {
      return;
    }
    const shouldKeepProbeAlive = () => {
      const probeStartedAtWallMs = cameraRecoveryProbeStartedAtWallMsRef.current;
      if (probeStartedAtWallMs == null) {
        return false;
      }
      const probeAgeMs = Date.now() - probeStartedAtWallMs;
      if (probeAgeMs >= CAMERA_RECOVERY_PROBE_MAX_CONTINUOUS_MS) {
        return false;
      }
      const snap = snapshotRef.current;
      const optical = pipeline.getLastOpticalDiagnostic();
      const seeingFingerAgain =
        snap.fingerDetected ||
        snap.signalQuality >= CAMERA_RECOVERY_MIN_SIGNAL_QUALITY ||
        (optical?.fingerPresenceConfidence ?? 0) >= 0.68;
      const opticalFlowAlive =
        (optical?.fps ?? 0) >= 4.5 ||
        (optical?.amplitude ?? 0) >= 0.008;
      return seeingFingerAgain || opticalFlowAlive;
    };
    const id = setInterval(() => {
      if (cancelled) {
        return;
      }
      if (tryRestore()) {
        cancelled = true;
        clearInterval(id);
        return;
      }
      const probeStartedAtWallMs = cameraRecoveryProbeStartedAtWallMsRef.current;
      if (probeStartedAtWallMs == null) {
        return;
      }
      const probeAgeMs = Date.now() - probeStartedAtWallMs;
      if (
        probeAgeMs < CAMERA_RECOVERY_PROBE_WINDOW_MS ||
        shouldKeepProbeAlive()
      ) {
        return;
      }
      cancelled = true;
      clearInterval(id);
      pipeline.setOpticalPaused(true);
      cameraRecoveryProbeStartedAtWallMsRef.current = null;
      setCameraRecoveryProbeActive(false);
    }, CAMERA_RECOVERY_PROBE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    cameraRecoveryProbeActive,
    cameraGuidanceOnlyMode,
    emulatedFallbackSource,
    phase,
    pipeline,
    switchBackToLivePulse,
    useEmulatedPulseMode,
  ]);

  useEffect(() => {
    if (
      !isWearableMode ||
      phase !== "running" ||
      useSimulatedPpg ||
      useEmulatedPulseMode ||
      (
        wearableRuntime.state !== "signalLost" &&
        wearableRuntime.state !== "disconnected" &&
        wearableRuntime.state !== "failed"
      )
    ) {
      return;
    }
    const id = setTimeout(() => {
      if (
        phaseRef.current === "running" &&
        !useEmulatedPulseModeRef.current &&
        (
          wearableRuntime.state === "signalLost" ||
          wearableRuntime.state === "disconnected" ||
          wearableRuntime.state === "failed"
        )
      ) {
        switchToEmulatedPulse("wearable", "wearable_signal_lost");
      }
    }, WEARABLE_EMULATED_FALLBACK_DELAY_MS);
    return () => clearTimeout(id);
  }, [
    isWearableMode,
    phase,
    switchToEmulatedPulse,
    useEmulatedPulseMode,
    useSimulatedPpg,
    wearableRuntime.state,
  ]);

  useEffect(() => {
    if (
      !isWearableMode ||
      phase !== "running" ||
      useSimulatedPpg ||
      useEmulatedPulseMode ||
      wearableCapabilityTier !== "fullMetrics"
    ) {
      return;
    }
    const rrAgeMs =
      wearableRuntime.lastRrAtMs != null
        ? Math.max(0, Date.now() - wearableRuntime.lastRrAtMs)
        : Number.POSITIVE_INFINITY;
    if (rrAgeMs <= WEARABLE_LIVE_RR_FRESH_MS) return;
    const id = setTimeout(() => {
      if (phaseRef.current !== "running" || useEmulatedPulseModeRef.current) return;
      const runtime = wearableRuntimeRef.current;
      const staleMs =
        runtime.lastRrAtMs != null
          ? Math.max(0, Date.now() - runtime.lastRrAtMs)
          : Number.POSITIVE_INFINITY;
      if (staleMs > WEARABLE_LIVE_RR_FRESH_MS) {
        switchToEmulatedPulse("wearable", "wearable_rr_stale");
      }
    }, WEARABLE_EMULATED_FALLBACK_DELAY_MS);
    return () => clearTimeout(id);
  }, [
    isWearableMode,
    phase,
    switchToEmulatedPulse,
    useEmulatedPulseMode,
    useSimulatedPpg,
    wearableCapabilityTier,
    wearableRuntime.lastRrAtMs,
  ]);

  useEffect(() => {
    if (
      !isWearableMode ||
      phase !== "running" ||
      !useEmulatedPulseMode ||
      emulatedFallbackSource !== "wearable"
    ) {
      return;
    }
    const hadRr = (wearableRuntime.rrPacketCount ?? 0) > 0;
    const rrRecovered =
      wearableRuntime.state === "ready" &&
      wearableRuntime.sensorContactDetected !== false &&
      hadRr &&
      wearableRuntime.lastRrAtMs != null &&
      Date.now() - wearableRuntime.lastRrAtMs <= WEARABLE_RECOVERY_RR_FRESH_MS;
    const heartRateRecovered =
      wearableRuntime.state === "ready" &&
      wearableRuntime.sensorContactDetected !== false &&
      !hadRr &&
      (wearableRuntime.lastHeartRateBpm ?? 0) > 0;
    if (!rrRecovered && !heartRateRecovered) {
      return;
    }
    switchBackToLivePulse(
      "wearable",
      pulseBpmLast?.bpm ?? wearableRuntime.lastHeartRateBpm ?? null,
    );
  }, [
    emulatedFallbackSource,
    isWearableMode,
    phase,
    pulseBpmLast?.bpm,
    switchBackToLivePulse,
    useEmulatedPulseMode,
    wearableRuntime.lastHeartRateBpm,
    wearableRuntime.lastRrAtMs,
    wearableRuntime.rrPacketCount,
    wearableRuntime.sensorContactDetected,
    wearableRuntime.state,
  ]);

  useEffect(() => {
    if (!isWearableMode) return;
    if (selectedWearableDevice?.id) return;
    if (!wearablePreferences.lastDeviceId) return;
    setSelectedWearableDevice({
      id: wearablePreferences.lastDeviceId,
      name: wearablePreferences.lastDeviceName ?? "BLE HR",
      localName: wearablePreferences.lastDeviceName,
      rssi: null,
      hasHeartRateService: true,
      isConnectable: true,
      provider: wearablePreferences.lastProvider ?? "genericHrs",
      capabilityTier: wearablePreferences.lastCapabilityTier ?? "unknown",
    });
  }, [
    isWearableMode,
    selectedWearableDevice?.id,
    wearablePreferences.lastCapabilityTier,
    wearablePreferences.lastDeviceId,
    wearablePreferences.lastDeviceName,
    wearablePreferences.lastProvider,
  ]);

  const handleWearableSelected = useCallback((candidate: WearableScanCandidate) => {
    setSelectedWearableDevice(candidate);
    setWearableCapabilityTier(candidate.capabilityTier);
    setWearableRuntime({ state: "idle" });
    setShowWearablePickerDialog(false);
    setSourceKey((value) => value + 1);
    void updateWearablePreferences({
      preferredSensorMode: "ble",
      lastDeviceId: candidate.id,
      lastDeviceName: candidate.name,
      lastProvider: candidate.provider,
      lastCapabilityTier: candidate.capabilityTier === "unknown" ? null : candidate.capabilityTier,
    });
  }, []);

  const handleWearableDisconnected = useCallback(() => {
    setSelectedWearableDevice(null);
    setWearableCapabilityTier("unknown");
    setWearableRuntime({ state: "idle" });
    setShowWearablePickerDialog(false);
    setSourceKey((value) => value + 1);
    void updateWearablePreferences({
      preferredSensorMode: "fingerCamera",
      lastDeviceId: null,
      lastDeviceName: null,
      lastProvider: null,
      lastCapabilityTier: null,
    });
  }, []);

  const handleWearableRuntimeSnapshot = useCallback((runtime: WearableRuntimeSnapshot) => {
    setWearableRuntime(runtime);
  }, []);

  const handleWearableCapabilityResolved = useCallback((tier: WearableCapabilityTier, nextHint?: string) => {
    setWearableCapabilityTier(tier);
    if (selectedWearableDevice?.id) {
      void updateWearablePreferences({
        preferredSensorMode: "ble",
        lastDeviceId: selectedWearableDevice.id,
        lastDeviceName: selectedWearableDevice.name,
        lastProvider: selectedWearableDevice.provider,
        lastCapabilityTier: tier,
      });
    }
    setSelectedWearableDevice((prev) =>
      prev
        ? {
            ...prev,
            capabilityTier: tier,
            connectionHint: nextHint ?? prev.connectionHint,
          }
        : prev,
    );
  }, [selectedWearableDevice?.id, selectedWearableDevice?.name, selectedWearableDevice?.provider]);

  /** Для gating камеры: ре-рендер при смене AppState (ref одного мало). */
  const [practiceAppState, setPracticeAppState] = useState(AppState.currentState);

  /**
   * Блокируем автоматический переход экрана в сон, пока идёт пранаяма.
   *
   * Зачем: во время фазы `emulated` гибридного режима камера выключается и
   * на экране остаётся только анимированная мандала + индикатор дыхания —
   * пользователь не прикасается к дисплею, и iOS/Android через 30–120 с
   * (в зависимости от настроек) погружают устройство в сон. Это приводит к
   * сбросу torch, остановке JS-циклов и сбою ритма дыхания.
   *
   * Реализация: условный `<PracticeKeepAwake>` компонент (см. выше) монтируется
   * только во время `warmup|qualityCheck|running`. Он использует `useKeepAwake`
   * hook, который корректно переживает React 18 Strict Mode double-invoke
   * (dev-client) — в отличие от ручного `activateKeepAwakeAsync`+cleanup, где
   * async `deactivateKeepAwake` из первого cleanup мог выполниться после
   * повторного `activateKeepAwakeAsync` и снять блокировку (field test
   * `1783165022235`: телефон заснул через ~41 с после начала практики).
   *
   * Дополнительная страховка: при возврате из background (AppState "active")
   * ре-активируем keep-awake — iOS может сбросить idle timer при backgrounding.
   */
  const keepAwakeTag = "harmonizer-practice";
  const isPracticePhase =
    phase === "warmup" || phase === "qualityCheck" || phase === "running";

  useEffect(() => {
    if (!isPracticePhase) return;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void activateKeepAwakeAsync(keepAwakeTag).catch(() => {
          // best-effort re-activation; useKeepAwake already holds the tag
        });
      }
    });
    return () => sub.remove();
  }, [isPracticePhase, keepAwakeTag]);

  /**
   * Переход «sensor → running» через чёрную штору:
   *  - warmup/qualityCheck: штора прозрачна, sensor-UI виден.
   *  - успех QC (phase=running): штора закрывается в чёрное (600 мс), под ней sensor-UI
   *    размонтируется; затем штора открывается (600 мс), появляется running-UI.
   *  - дыхание стартует только после полного открытия шторы
   *    (cycleStartMs = Date.now() одновременно с `isBreathTimingActive = true`).
   */
  useEffect(() => {
    if (phase === "warmup" || phase === "qualityCheck") {
      blackCurtainSv.value = 0;
      setSensorUiMounted(true);
      setRunningUiRevealed(false);
      setIsBreathTimingActive(false);
      setCycleStartMs(null);
      return;
    }
    if (phase === "running") {
      const FADE_OUT_MS = 600;
      const FADE_IN_MS = 600;
      // Стартовое состояние: sensor-UI ещё смонтирован, running-UI НЕ смонтирован,
      // штора в текущем значении (как правило 0). Сразу начинаем закрывать чёрный занавес.
      setRunningUiRevealed(false);
      blackCurtainSv.value = withTiming(1, {
        duration: FADE_OUT_MS,
        easing: Easing.inOut(Easing.quad),
      });
      // Когда штора полностью закрыта → размонтируем sensor, монтируем running,
      // затем открываем штору (running проявляется из черноты).
      const midTimer = setTimeout(() => {
        setSensorUiMounted(false);
        setRunningUiRevealed(true);
        blackCurtainSv.value = withTiming(0, {
          duration: FADE_IN_MS,
          easing: Easing.inOut(Easing.quad),
        });
      }, FADE_OUT_MS + 50);
      // Дыхание стартует только после полного раскрытия running-UI.
      const breathTimer = setTimeout(() => {
        setCycleStartMs(Date.now());
        setIsBreathTimingActive(true);
      }, FADE_OUT_MS + 50 + FADE_IN_MS);
      return () => {
        clearTimeout(midTimer);
        clearTimeout(breathTimer);
      };
    }
    // idle
    if (phase === "idle") {
      blackCurtainSv.value = 0;
      setSensorUiMounted(false);
      setRunningUiRevealed(false);
      setIsBreathTimingActive(false);
      return undefined;
    }
    // results: проявляем экран результатов из черноты.
    // Практика заканчивается — штора моментально закрывается в чёрное, под ней
    // монтируется ResultsView, затем штора плавно открывается (результаты
    // проявляются из темноты, как и просил пользователь).
    if (phase === "results") {
      setSensorUiMounted(false);
      setRunningUiRevealed(false);
      setIsBreathTimingActive(false);
      blackCurtainSv.value = 1;
      const RESULTS_FADE_IN_MS = 600;
      const revealTimer = setTimeout(() => {
        blackCurtainSv.value = withTiming(0, {
          duration: RESULTS_FADE_IN_MS,
          easing: Easing.inOut(Easing.quad),
        });
      }, 60);
      return () => clearTimeout(revealTimer);
    }
    return undefined;
  }, [blackCurtainSv, isWearableMode, phase]);

  const blackCurtainStyle = useAnimatedStyle(() => ({ opacity: blackCurtainSv.value }));

  const clearPpgBannerUi = useCallback(() => {
    setPpgOverlayMessage(null);
    prevFingerDetectedForBannerRef.current = true;
    prevBadSignalForBannerRef.current = false;
  }, []);

  useEffect(() => {
    if (phase !== "running") {
      clearPpgBannerUi();
    }
  }, [phase, clearPpgBannerUi]);

  const instructionOpacity = useRef(new RNAnimated.Value(1)).current;
  const mandalaOpacity = useRef(new RNAnimated.Value(0)).current;

  // ─── Warmup → QC → Running переход ────────────────────────────────────────

  useEffect(() => {
    if (phase !== "warmup" || useSimulatedPpg || isWearableMode) return;
    const id = setInterval(() => {
      if (Date.now() - (warmupStartedAtMs.current ?? 0) >= COHERENCE_WARMUP_MS) {
        qcStartLogicalMsRef.current = null;
        setPhase("qualityCheck");
      }
    }, 200);
    return () => clearInterval(id);
  }, [isWearableMode, phase]);

  useEffect(() => {
    if ((phase !== "warmup" && phase !== "qualityCheck") || useSimulatedPpg || isWearableMode) return;
    const id = setInterval(() => {
      if (Date.now() - (protocolStartedAtMs.current ?? 0) > COHERENCE_PROTOCOL_MAX_MS) {
        Alert.alert(str.calibrationTitle, str.calibrationTimeout, [
          { text: "OK", onPress: () => returnToPracticeOrigin() },
        ]);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [
    isWearableMode,
    phase,
    returnToPracticeOrigin,
    str.calibrationTimeout,
    str.calibrationTitle,
    useSimulatedPpg,
  ]);

  // ─── Live optical preview для warmup/QC/running ───────────────────────────

  /**
   * Optical-превью нужно ТОЛЬКО в фазах `warmup`/`qualityCheck`, когда на экране
   * активации пульсометра крутится мини-график. В `running`/`idle`/`results` график
   * скрыт, а подписка оставалась активной — `setOpticalPreviewSamples([...72 элементов])`
   * каждые 120 мс перерендеривал весь экран ~8 раз в секунду и съедал JS-thread, из-за
   * чего мандала и индикатор начинали «подвисать» по мере практики.
   *
   * Поэтому подписка привязана к `phase`: активна только в окне активации пульсометра.
   */
  useEffect(() => {
    if (phase !== "warmup" && phase !== "qualityCheck") return;
    if (useSimulatedPpg || isWearableMode) return;
    // Буфер preview привязан ко ВРЕМЕНИ (≈6 сек), а не к фиксированному числу
    // сэмплов. Раньше стояло N=72, и при увеличении fps 15→25→30 окно
    // схлопывалось (72/30 = 2.4 с), диаграмма «неслась». Теперь размер окна
    // визуально стабилен независимо от capture rate: пользователь всегда
    // видит последние ~6 секунд пульсации.
    const PREVIEW_WINDOW_MS = 6_000;
    return bus.subscribe("optical", (sample) => {
      const buf = opticalPreviewBufferRef.current;
      buf.push(sample);
      const cutoff = sample.timestampMs - PREVIEW_WINDOW_MS;
      let drop = 0;
      while (drop < buf.length && buf[drop]!.timestampMs < cutoff) drop += 1;
      if (drop > 0) opticalPreviewBufferRef.current = buf.slice(drop);
      const now = Date.now();
      if (now - lastOpticalPreviewRefreshWallMsRef.current >= 120) {
        lastOpticalPreviewRefreshWallMsRef.current = now;
        setOpticalPreviewSamples([...opticalPreviewBufferRef.current]);
      }
    });
  }, [bus, phase, useSimulatedPpg]);

  // ─── Подписка на pulseBpm для QC, debug и pulseLog ────────────────────────

  useEffect(() => {
    // Подписка стабильная: читаем актуальное состояние snapshot через `snapshotRef`,
    // чтобы deps этого useEffect не зависели от часто меняющихся `signalQuality` /
    // `fingerDetected`. Иначе даже с учётом троттла snapshot-адаптера (4 Гц) мы
    // делали `unsubscribe + subscribe` 4 раза в секунду; за 20-минутную практику
    // это 4800 раз, и каждый unsubscribe делает `Set.delete` по хэшу. Плюс дорожнее
    // накопление временных объектов в V8/Hermes для GC.
    return bus.subscribe("pulseBpm", (event) => {
      snapshotCallbacksTotalRef.current += 1;
      const cameraTimestampMs = pipeline.getLastSourceTimestampMs();
      const mergedBeats = pipeline.getMergedBeats();
      const lastMergedBeatTs = mergedBeats[mergedBeats.length - 1] ?? null;
      const snap = snapshotRef.current;
      const wall = Date.now();
      // A "trusted fresh beat" must be COHERENT (or a bridge on a previously-coherent baseline),
      // not merely `tracking`. On marginal PPG (cold finger / weak perfusion) the peak detector
      // can flicker `tracking` on noise and produce bogus BPM (e.g. 44→77 climbing in 7 s) with
      // high jitter — `looksCoherent` is false there. Trusting those flickers reset the loss
      // clock and the emulated-fallback never fired, so the practice was paced by noise for
      // minutes. Requiring coherence makes noise accumulate staleness → emulated synthetic sine
      // takes over; real coherent pulse (stable BPM, low jitter) resets it as before. The brief
      // onset window before 5 RR accumulate is covered by the 20 s fallback threshold + bridge.
      const trustedFreshBeat =
        event.hasFreshBeat &&
        lastMergedBeatTs != null &&
        event.looksCoherent === true;
      if (trustedFreshBeat) {
        lastFreshBeatSourceTsRef.current = lastMergedBeatTs;
        lastFreshBeatWallClockRef.current = wall;
        if (phaseRef.current === "running") {
          runningLiveBeatSeenRef.current = true;
        }
      }
      // Camera guidance-only: accumulate display R–R beats while metrics stay paused.
      if (
        phaseRef.current === "running" &&
        pipeline.isMetricsCapturePaused() &&
        mergedBeats.length > 0
      ) {
        appendNewerBeatsForRrChart(displayRrBeatsRef.current, mergedBeats);
      }
      if (phaseRef.current === "warmup" || phaseRef.current === "qualityCheck") {
        qcPulseSamplesRef.current.push({
          cameraTimestampMs,
          bpm: event.bpm,
          rawBpm: event.rawBpm,
          rrCount: event.rrCount,
          jitterMs: event.jitterMs,
          looksCoherent: event.looksCoherent,
          signalQuality: snap.signalQuality,
          lockState: event.lockState,
        });
        qcPulseSamplesRef.current = qcPulseSamplesRef.current.filter(
          (sample) => sample.cameraTimestampMs >= cameraTimestampMs - COHERENCE_PREP_TOTAL_MS - 4_000,
        );
      }
      if (phaseRef.current === "running") {
        snapshotsWhileRunningRef.current += 1;
        if (wall - lastPulseLogWallClockRef.current >= 500) {
          lastPulseLogWallClockRef.current = wall;
          const wearableRuntimeNow = wearableRuntimeRef.current;
          const wearableLastRrAgeMs =
            isWearableMode && wearableRuntimeNow.lastRrAtMs != null
              ? Math.max(0, wall - wearableRuntimeNow.lastRrAtMs)
              : null;
          const useWallClockTimebaseForLog =
            !isWearableMode &&
            useEmulatedPulseModeRef.current &&
            sessionStartLogicalMs != null &&
            sessionStartWallMs != null;
          const logTimestampMs = useWallClockTimebaseForLog
            ? sessionStartLogicalMs + (wall - sessionStartWallMs)
            : cameraTimestampMs;
          const logLastBeatTimestampMs =
            useWallClockTimebaseForLog && lastFreshBeatWallClockRef.current != null
              ? sessionStartLogicalMs + (lastFreshBeatWallClockRef.current - sessionStartWallMs)
              : lastFreshBeatSourceTsRef.current;
          const beatAgeMs =
            logLastBeatTimestampMs != null
              ? Math.max(0, logTimestampMs - logLastBeatTimestampMs)
              : null;
          const wearableContactOk = wearableRuntimeNow.sensorContactDetected !== false;
          const wearableLinkOk =
            wearableRuntimeNow.state !== "signalLost" &&
            wearableRuntimeNow.state !== "disconnected" &&
            wearableRuntimeNow.state !== "failed";
          const hadWearableRr =
            (wearableRuntimeNow.rrPacketCount ?? 0) > 0 || wearableRuntimeNow.lastRrAtMs != null;
          const wearableRrFresh =
            !hadWearableRr ||
            (
              wearableLastRrAgeMs != null &&
              wearableLastRrAgeMs <= WEARABLE_LIVE_RR_FRESH_MS
            );
          const cameraReadyForLog =
            !isWearableMode &&
            !useEmulatedPulseModeRef.current &&
            (event.reacquiring !== true || event.bridgingShortGap === true) &&
            beatAgeMs != null &&
            // A bridged short gap is reconstructed pulse (interpolated on the last stable rate),
            // so it stays live even though the last REAL beat is older than the plain freshness
            // window. The engine already bounds the bridge, so we don't need the age cap here.
            (beatAgeMs <= BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS || event.bridgingShortGap === true) &&
            event.bpm > 0 &&
            (
              event.lockState === "tracking" ||
              event.bridgingShortGap === true ||
              event.looksCoherent === true
            );
          const wearableReadyForLog =
            isWearableMode
              ? (
                  wearableLinkOk &&
                  wearableContactOk &&
                  (wearableRuntimeNow.lastHeartRateBpm ?? 0) > 0 &&
                  wearableRrFresh
                )
              : cameraReadyForLog;
          const liveMeasurementNow = wearableReadyForLog;
          const wearableLiveBpm = isWearableMode
            ? (
                resolveWearableHeartRateBpm(
                  wearableRuntimeNow.lastHeartRateBpm,
                  wearableRrFresh ? event.bpm : null,
                ) ?? 0
              )
            : 0;
          const cameraHoldGuidance =
            !isWearableMode &&
            !useEmulatedPulseModeRef.current &&
            !liveMeasurementNow;
          // On the START hold (before any live beat), `lastLoggedGuidanceBpmRef` is 0 and the
          // fallback was `snapshot.pulseRateBpm` — which on a marginal-PPG start is a NOISY
          // warmup value (e.g. ~55 bpm while the user's real pulse is ~80). That painted a
          // bogus "floor" on the guidance graph for the first ~15-20 s. Prefer the coherent
          // baseline (`lastStableRrMs`) — it is only updated on low-jitter windows and holds
          // the user's true rate through the loss — so the hold shows the real ~80 bpm and
          // transitions seamlessly into live/emulated. Mid-session holds already have
          // `lastLoggedGuidanceBpmRef` set, so this baseline term only participates at start.
          const holdStableBpm = (() => {
            const rr = pipeline.getLastStableRrMs();
            if (rr > 0) return 60_000 / rr;
            const plausible = pipeline.getLastPlausibleBpm();
            return plausible > 0 ? plausible : 0;
          })();
          let guidancePulseRateBpm =
            cameraHoldGuidance
              ? (lastLoggedGuidanceBpmRef.current
                  || (holdStableBpm > 0 ? holdStableBpm : 0)
                  || CAMERA_EMULATED_SEED_DEFAULT_BPM)
              : event.bpm > 0
                ? event.bpm
                : (
                    useEmulatedPulseModeRef.current
                      ? (
                          emulatedPulseSeedBpmRef.current
                          ?? snapshotRef.current.pulseRateBpm
                          ?? lastLoggedGuidanceBpmRef.current
                          ?? 0
                        )
                      : (
                          isWearableMode
                            ? (snapshotRef.current.pulseRateBpm ?? event.bpm ?? lastLoggedGuidanceBpmRef.current ?? 0)
                            : (lastLoggedGuidanceBpmRef.current ?? event.bpm ?? 0)
                        )
                  );
          // Single source of truth for a live wearable: the RR-derived pipeline bpm (event.bpm)
          // that actually paces breathing. The integer strap HR field (`wearableLiveBpm`) is
          // quantized and update-lagged — using it for the measured graph while guidance used
          // event.bpm produced flat plateaus on "Пульс (измерение)" and divergence between the
          // two graphs outside gray zones. Now both graphs log the same number when live.
          const wearableUnifiedBpm =
            isWearableMode && liveMeasurementNow
              ? (event.bpm > 0 ? event.bpm : wearableLiveBpm)
              : 0;
          if (isWearableMode && liveMeasurementNow && wearableUnifiedBpm > 0) {
            guidancePulseRateBpm = wearableUnifiedBpm;
          }
          if (guidancePulseRateBpm > 0) {
            guidancePulseRateBpm = sanitizeBreathGuidanceBpm(
              guidancePulseRateBpm,
              lastLoggedGuidanceBpmRef.current,
            );
          }
          if (guidancePulseRateBpm > 0) {
            lastLoggedGuidanceBpmRef.current = guidancePulseRateBpm;
          }
          const measuredPulseRateBpm =
            liveMeasurementNow
              ? (
                  isWearableMode
                    ? wearableUnifiedBpm
                    : event.bpm
                )
              : 0;
          if (measuredPulseRateBpm > 0) {
            lastLoggedMeasuredBpmRef.current = measuredPulseRateBpm;
          }
          const loggedPulseSource = useEmulatedPulseModeRef.current
            ? "emulated"
            : pipeline.getPulseSource();
          const loggedLockState = useEmulatedPulseModeRef.current
            ? ("searching" as const)
            : event.lockState;
          const draftEntry: CoherencePulseLogEntry = {
            cameraTimestampMs: logTimestampMs,
            wallClockMs: wall,
            pulseRateBpm: measuredPulseRateBpm,
            measuredPulseRateBpm,
            guidancePulseRateBpm,
            signalQuality: snap.signalQuality,
            pulseReady: liveMeasurementNow,
            fingerDetected: snap.fingerDetected,
            pulseLockState: loggedLockState,
            beatTimestampsCount: mergedBeats.length,
            lastBeatTimestampMs: logLastBeatTimestampMs,
            lastBeatAgeMs: beatAgeMs,
            pulseSource: loggedPulseSource,
            emulatedActive: useEmulatedPulseModeRef.current,
            wearableState: isWearableMode ? wearableRuntimeNow.state : null,
            wearableCapabilityTier: isWearableMode ? wearableCapabilityTierRef.current : null,
            wearableHeartRateBpm: isWearableMode ? (wearableRuntimeNow.lastHeartRateBpm ?? null) : null,
            wearableLastRrAgeMs,
            wearableSensorContactDetected: isWearableMode ? (wearableRuntimeNow.sensorContactDetected ?? null) : null,
            wearablePacketCount: isWearableMode ? (wearableRuntimeNow.packetCount ?? null) : null,
            wearableRrPacketCount: isWearableMode ? (wearableRuntimeNow.rrPacketCount ?? null) : null,
            opticalRedMean: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.redMean ?? null),
            opticalGreenMean: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.greenMean ?? null),
            opticalBlueMean: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.blueMean ?? null),
            opticalLumaMean: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.lumaMean ?? null),
            opticalRedDominance: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.redDominance ?? null),
            opticalDarknessRatio: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.darknessRatio ?? null),
            opticalSaturationRatio: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.saturationRatio ?? null),
            opticalMotion: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.motion ?? null),
            opticalAmplitude: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.amplitude ?? null),
            opticalFps: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.fps ?? null),
            fingerPresenceConfidence: isWearableMode ? null : (pipeline.getLastOpticalDiagnostic()?.fingerPresenceConfidence ?? null),
          };
          draftEntry.bridgingShortGap =
            !isWearableMode && !useEmulatedPulseModeRef.current && event.bridgingShortGap === true;
          draftEntry.liveMeasurementActive = isPulseLogEntryLiveForMeasurement(draftEntry);
          draftEntry.interpolationHoldActive =
            !draftEntry.emulatedActive &&
            !draftEntry.liveMeasurementActive &&
            draftEntry.pulseSource !== "wearable";
          pulseLogRef.current.push(draftEntry);
          // Cap буфера на 60 минут × 2 записи/с = 7200. Длинные практики (60+ мин)
          // не должны съедать память; при экспорте всё равно попадут последние
          // 60 минут, а для анализа достаточно: RMSSD/coherence считаются по beats,
          // pulseLog нужен только для диагностики.
          if (pulseLogRef.current.length > 7200) {
            pulseLogRef.current = pulseLogRef.current.slice(-7200);
          }
        }
      }
    });
  }, [bus, isWearableMode, pipeline, sessionStartLogicalMs, sessionStartWallMs]);

  // ─── QC окно 10 с (camera time) — ОДНА попытка, затем диалог ──────────────

  useEffect(() => {
    if (phase !== "qualityCheck" || useSimulatedPpg || isWearableMode) return;
    const id = setInterval(() => {
      const camTs = pipeline.getLastSourceTimestampMs();
      // Without a camera clock the QC window cannot advance — hang watchdog
      // (wall clock) surfaces the retry dialog. Keep the countdown idle here.
      if (camTs <= 0) {
        setQcSecondsLeft(null);
        return;
      }
      if (qcStartLogicalMsRef.current == null) {
        qcStartLogicalMsRef.current = camTs;
        setQcSecondsLeft(Math.ceil(COHERENCE_QUALITY_WINDOW_MS / 1000));
        return;
      }
      const qcStart = qcStartLogicalMsRef.current;
      const elapsed = camTs - qcStart;
      const remainingMs = COHERENCE_QUALITY_WINDOW_MS - elapsed;
      setQcSecondsLeft(Math.max(0, Math.ceil(remainingMs / 1000)));

      // Wall clock drives the visible ring; fail a few seconds before «0» so the
      // dialog is not gated on lagging camera elapsed after the ring empties.
      const wallElapsed = Date.now() - (protocolStartedAtMs.current ?? Date.now());
      const wallForceFinal =
        wallElapsed >= COHERENCE_PREP_TOTAL_MS - COHERENCE_QC_FAIL_LEAD_MS;

      // Ранний успех: после 10 с QC-окна проверяем, достаточно ли устойчив сигнал.
      //  - если да → сразу в практику;
      //  - иначе ждём до camera-window ИЛИ wall fail-lead (чуть раньше «0» на кольце).
      const isEarlyCheck = elapsed < COHERENCE_QUALITY_WINDOW_MS && !wallForceFinal;
      const isFinalCheck = elapsed >= COHERENCE_QUALITY_WINDOW_MS || wallForceFinal;
      if (!isFinalCheck && elapsed < COHERENCE_QUALITY_WINDOW_EARLY_SUCCESS_MS) {
        return;
      }

      const probeEnd = Math.min(camTs, qcStart + COHERENCE_QUALITY_WINDOW_MS);
      const beatsInWin = pipeline
        .getCanonicalBeats()
        .filter((t) => t >= qcStart && t <= probeEnd);
      const snap = snapshotRef.current;

      // **Warm-up skip внутри QC-окна.** Пользовательское наблюдение (23 апр):
      // первые 3-5 с после прикладывания пальца на графике оптического потока
      // — чистый шум, peak detector ещё не набрал контекст. Ранее эта часть
      // попадала в `stableSamples` и тянула вниз `signalQualityOk`,
      // `stableFraction`, а также раздувала `bpmStdev`. Пропускаем первые
      // 5 с — это оставляет 15 с валидных сэмплов на final-check (20 с
      // окно) и 5 с на early-success (10 с минимальный порог), чего
      // достаточно для честной оценки.
      // Отбрасываем первые 10 с QC-окна: пользователь описал, что на этом
      // этапе "полная каша" — детектор пиков только выходит на режим,
      // сигнал не чистый, stdev по этому куску даёт ложные срабатывания
      // `bpmStdevOk`. Валидное окно остаётся ≥ 10 с (QC_WINDOW_MS = 20 с).
      const QC_WARMUP_SKIP_MS = 10_000;
      const pulseSamplesWindowStart = qcStart + QC_WARMUP_SKIP_MS;

      const pulseSamples = qcPulseSamplesRef.current.filter(
        (sample) =>
          sample.cameraTimestampMs >= pulseSamplesWindowStart &&
          sample.cameraTimestampMs <= probeEnd,
      );
      // Порог signalQuality для «стабильного сэмпла» — компромисс:
      //  - 0.54 (старый) был надёжен, но при тёплом телефоне и/или прохладных
      //    пальцах активация часто не проходила с первого раза;
      //  - 0.48 (экспериментальный) пропускал слабый сигнал, что приводило
      //    к скачкам пульса в основной практике (rrBadFraction > 15%);
      //  - 0.52 — середина эпохи компромиссов: всё ещё пропускало шумные
      //    сэмплы, пользователь видел слабый/рваный график.
      //  - **0.54 — возврат к исходному строгому порогу**. После поднятия
      //    fps 15→25, stride 6→4 и torch running 0.35→0.40 / activation
      //    0.45→0.55 сам сигнал стал чище, поэтому можно (и нужно) вернуть
      //    исходные пороги, чтобы в RR-детектор не попадали слабые сэмплы.
      const stableSamples = pulseSamples.filter(
        (sample) =>
          sample.signalQuality >= 0.54 &&
          sample.rrCount >= 4 &&
          (sample.looksCoherent || sample.lockState !== "searching") &&
          (sample.bpm > 0 || sample.rawBpm > 0),
      );
      // Для `bpmStdev` берём НЕ все стабильные сэмплы за окно, а только
      // последние 10 секунд. Причина — разбор тестов 22 апр 2026 (файлы
      // breath-activation-diagnostic-17768862*): peak-detector в первые
      // 5-8 сек окна «раскачивается» и выдаёт bpm≈46 (пропускает каждый
      // второй удар), потом медиана RR устаканивается и bpm становится
      // корректным (77-89). Если считать stdev по всему окну, эти два
      // режима дают ~15 BPM stdev и блокируют активацию, хотя
      // **последние 10 секунд сигнал уже идеально стабильный**.
      // 10 секунд — это больше, чем 2 стандартных дыхательных цикла,
      // так что RSA-вариабельность (обычно 2-5 BPM) измеряется честно,
      // и одновременно шум раскачки не попадает в расчёт.
      const BPM_STDEV_WINDOW_MS = 10_000;
      const bpmStdevWindowStart = probeEnd - BPM_STDEV_WINDOW_MS;
      const stableSamplesForStdev = stableSamples.filter(
        (s) => s.cameraTimestampMs >= bpmStdevWindowStart,
      );
      // Фолбэк на весь буфер, если за последние 10 сек набралось <3
      // сэмплов (короткое окно QC, маленькая частота обновления Engine).
      const stdevSource =
        stableSamplesForStdev.length >= 3 ? stableSamplesForStdev : stableSamples;
      const bpmValues = stdevSource
        .map((sample) => (sample.bpm > 0 ? sample.bpm : sample.rawBpm))
        .filter((value) => value > 0);
      const bpmStdev = computeStdDev(bpmValues);
      const stableFraction =
        pulseSamples.length > 0 ? stableSamples.length / pulseSamples.length : 0;
      // Среднее качество за всё окно — устойчивее к мгновенным просадкам (частое явление,
      // когда живой `snap.signalQuality` скачет ниже 0.7, хотя график явно идёт ровно).
      const meanSignalQuality =
        pulseSamples.length > 0
          ? pulseSamples.reduce((acc, s) => acc + s.signalQuality, 0) / pulseSamples.length
          : 0;

      // Пороги активации — калибровка эпох:
      //  1. **Исходные (строгие, возврат к ним)**: sq≥0.70 || mean≥0.60,
      //     stableSamples≥3, stableFraction≥0.55. На ранних тестах казалось,
      //     что они слишком строгие и активация не проходит при прохладных
      //     пальцах. Но причина была не в порогах: сигнал сам по себе был
      //     слабым из-за fps 15 Hz, stride 6 и torch 0.45 на активации.
      //  2. Первая смягчённая версия: sq≥0.65 || mean≥0.55, stableSamples≥2,
      //     stableFraction≥0.45 — пропускала шумный сигнал, rrBadFraction в
      //     практике подскакивал до 18% (тест 1776859284667).
      //  3. Промежуточный компромисс: sq≥0.68 || mean≥0.58, stableSamples≥3,
      //     stableFraction≥0.5. Всё ещё не давал чистого графика.
      //  4. **Сейчас — возврат к строгим порогам (1)**, но уже с ощутимо
      //     лучшим сигналом (fps 25, stride 4, torch 0.40/0.55). Теперь
      //     активация проходит не «случайно», а по действительно чистому
      //     сигналу, и RR-детектор в running не получает шум.
      // **Согласованность между оценщиками BPM.** Защита от ложно-низких
      // значений (user report 22 апр: активация прошла с «пульс 53», потом
      // в практике корректно 85 → это было 2:1 deletion внутри peak-
      // detector'а в последние секунды QC). В тестовых файлах
      // breath-activation-diagnostic-17768897* видно, что:
      //   - snap.pulseRateBpm давал одно значение (68 / 87),
      //   - peakDetector.lastMedianRrInPeakWindow давал другое (77 / 75),
      //   - расхождения 12-20 BPM → сигнал нестабильный.
      // Если расхождение между живым snap и медианой peak-detector'а
      // велико (> 8 BPM) — пульс ненадёжный, активацию не пропускаем.
      // 8 BPM — это больше естественной RSA-вариабельности (обычно 2-5),
      // но меньше типичного артефакта удвоения/деления пополам (30-45).
      const peakDiag = pipeline.getPeakDetectorDiagnostics();
      const peakMedianRrMs = peakDiag.lastMedianRrInPeakWindowMs;
      const peakBpm = peakMedianRrMs > 0 ? 60_000 / peakMedianRrMs : 0;
      // For QC agreement we must compare the peak-detector window against the *current* pulse
      // estimate from that same live window, not against `snapshot.pulseRateBpm` which is the
      // UI-friendly held/display BPM. After short-gap interpolation the display value may
      // intentionally lag the current optical window for a moment; using it here can falsely fail
      // activation even when the present signal is already clean.
      const latestStablePulseSample =
        [...stdevSource]
          .reverse()
          .find((sample) => (sample.rawBpm > 0 || sample.bpm > 0)) ?? null;
      const snapBpm = latestStablePulseSample != null
        ? (latestStablePulseSample.rawBpm > 0
            ? latestStablePulseSample.rawBpm
            : latestStablePulseSample.bpm)
        : (snap.pulseRateBpm > 0 ? snap.pulseRateBpm : 0);
      const bpmDiff = peakBpm > 0 && snapBpm > 0 ? Math.abs(peakBpm - snapBpm) : 0;
      const bpmAgreement = peakBpm > 0 && snapBpm > 0 ? bpmDiff : null;
      const BPM_AGREEMENT_MAX = 8;

      const conditions = {
        signalQualityOk: snap.signalQuality >= 0.7 || meanSignalQuality >= 0.6,
        beatsInWinOk: beatsInWin.length >= QC_MIN_BEATS,
        stableSamplesOk: stableSamples.length >= 3,
        stableFractionOk: stableFraction >= 0.55,
        bpmStdevOk: bpmStdev <= QC_BPM_STDEV_MAX,
        // Если любая из двух оценок BPM отсутствует (=0) — пропускаем
        // условие (не блокируем на отсутствии данных), но в норме обе
        // должны быть. Это фолбэк для первых секунд после старта.
        bpmAgreementOk: bpmAgreement == null ? true : bpmAgreement <= BPM_AGREEMENT_MAX,
      };
      const ok =
        conditions.signalQualityOk &&
        conditions.beatsInWinOk &&
        conditions.stableSamplesOk &&
        conditions.stableFractionOk &&
        conditions.bpmStdevOk &&
        conditions.bpmAgreementOk;

      // TAG_REMOVE_PERF_DIAGNOSTICS — фиксируем срез проверки в ref, чтобы
      // `exportActivationDiagnostic()` (ручной или авто при failure) мог
      // включить в JSON причины "не прошёл QC".
      qcLastEvaluationRef.current = {
        timestampMs: camTs,
        elapsedMs: elapsed,
        isFinalCheck,
        beatsInWinCount: beatsInWin.length,
        pulseSamplesCount: pulseSamples.length,
        stableSamplesCount: stableSamples.length,
        stableFraction,
        bpmStdev,
        meanSignalQuality,
        snapSignalQuality: snap.signalQuality,
        conditions,
        bpmAgreement: {
          snapBpm,
          peakBpm,
          diffBpm: bpmAgreement,
        },
        pulseSamples: [...pulseSamples],
      };

      if (ok) {
        qcOutcomeRef.current = "ok";
        const anchor = probeEnd;
        // Камера в guidance-only режиме НЕ считает coherence/RSA/HRV — практика ведётся
        // только по BPM. Не открываем сессию coherence вовсе: иначе pipeline на каждом
        // кадре гоняет тяжёлый signal-trust/сглаживание ради неиспользуемого результата
        // (это и есть источник прогрессирующего перегрева на длинных камерных практиках).
        if (!cameraGuidanceOnlyMode) {
          const estCycleMs = computeCycleMsForAnalysis(
            coherenceShapeRef.current,
            pulseBpmLast?.medianRrMs,
          );
          pipeline.getCoherenceEngine().startSession({
            sessionStartedAtMs: anchor,
            inhaleMs: estCycleMs.inhaleMs,
            exhaleMs: estCycleMs.exhaleMs,
            cycleMs: estCycleMs.cycleMs,
            mode: "test120s",
            preflightBeats: beatsInWin,
            bufferMsBeforeSession: COHERENCE_PREFLIGHT_BUFFER_MS,
          });
        }
        qualityBadAccumMsRef.current = 0;
        fingerAbsentAccumMsRef.current = 0;
        lastSampleMsRef.current = anchor;
        clearPpgBannerUi();
        setSessionStartWallMs(Date.now());
        setSessionStartLogicalMs(anchor);
        setElapsedMs(0);
        setPhase("running");
      } else if (isFinalCheck) {
        // Camera window done OR wall fail-lead (~3 s before ring «0»).
        // Важно: НЕ вызываем здесь автоматический экспорт JSON, потому что
        // `setInterval(…, 250)` продолжает тикать пока диалог не закрыт, и
        // авто-вызов начинал бы всплывать Share-диалог на каждом тике (баг
        // «airdrop-спам» 22 апр). Сохраняем срез в ref — пользователь
        // нажимает кнопку «Отправить отчёт» в диалоге, когда сочтёт нужным.
        qcOutcomeRef.current = "retry_failed";
        setShowQcFailedDialog(true);
      } else if (isEarlyCheck) {
        // Ранний чек не прошёл — ждём дальше до полного окна.
        return;
      }
    }, 250);
    return () => {
      clearInterval(id);
      setQcSecondsLeft(null);
    };
  }, [cameraGuidanceOnlyMode, clearPpgBannerUi, isWearableMode, phase, pipeline]);

  useEffect(() => {
    if (!isWearableMode) return;
    if (phase === "warmup" && selectedWearableDevice?.id && wearableRuntime.state !== "idle") {
      setPhase("qualityCheck");
      return;
    }
    if (phase !== "qualityCheck") return;
    if (
      wearableCapabilityTier !== "fullMetrics" &&
      wearableCapabilityTier !== "guidedOnly"
    ) {
      if (wearableRuntime.state === "failed" || wearableRuntime.state === "disconnected" || wearableRuntime.state === "signalLost") {
        setShowQcFailedDialog(true);
      }
      return;
    }
    // Require a live ready stream — not a half-open GATT waiting on an ignored OS prompt.
    if (wearableRuntime.state !== "ready") {
      return;
    }
    const heartRateReady = (wearableRuntime.lastHeartRateBpm ?? 0) > 0;
    const prepStartedAt = protocolStartedAtMs.current ?? Date.now();
    const prepElapsedMs = Date.now() - prepStartedAt;
    // Android catalog already verified live HR — enter as soon as practice runtime
    // sees the first packet (avoid multi-second black qualityCheck wall).
    const heldWarmAndroid =
      Platform.OS === "android" &&
      (() => {
        const ageMs = peekHeldLivePacketAgeMs();
        return ageMs != null && ageMs < 30_000;
      })();
    const rrFresh =
      heldWarmAndroid ||
      wearableCapabilityTier !== "fullMetrics" ||
      (
        wearableRuntime.lastRrAtMs != null &&
        Date.now() - wearableRuntime.lastRrAtMs <= WEARABLE_LIVE_RR_FRESH_MS
      );
    const packetReady = heldWarmAndroid
      ? (wearableRuntime.packetCount ?? 0) >= 1 || heartRateReady
      : (wearableRuntime.packetCount ?? 0) >= 3;
    const minLivePulseMs = heldWarmAndroid ? 0 : BREATH_BLE_PREP_MIN_LIVE_PULSE_MS;
    if (!heartRateReady || !rrFresh || !packetReady || prepElapsedMs < minLivePulseMs) {
      return;
    }
    const minSpinMs =
      Platform.OS === "ios" || heldWarmAndroid ? 0 : BREATH_BLE_PREP_SPIN_MS;
    if (prepElapsedMs < minSpinMs) {
      return;
    }
    const anchor = Date.now();
    const estCycleMs = computeCycleMsForAnalysis(
      coherenceShapeRef.current,
      pulseBpmLast?.medianRrMs,
    );
    const preflightBeats = pipeline
      .getCanonicalBeats()
      .filter((timestampMs) => timestampMs >= anchor - COHERENCE_QUALITY_WINDOW_MS);
    pipeline.getCoherenceEngine().startSession({
      sessionStartedAtMs: anchor,
      inhaleMs: estCycleMs.inhaleMs,
      exhaleMs: estCycleMs.exhaleMs,
      cycleMs: estCycleMs.cycleMs,
      mode: "test120s",
      preflightBeats,
      bufferMsBeforeSession: COHERENCE_PREFLIGHT_BUFFER_MS,
    });
    qualityBadAccumMsRef.current = 0;
    fingerAbsentAccumMsRef.current = 0;
    lastSampleMsRef.current = anchor;
    clearPpgBannerUi();
    setSessionStartWallMs(Date.now());
    setSessionStartLogicalMs(anchor);
    setElapsedMs(0);
    lastLoggedMeasuredBpmRef.current = 0;
    lastLoggedGuidanceBpmRef.current = 0;
    setPhase("running");
  }, [
    clearPpgBannerUi,
    isWearableMode,
    phase,
    pipeline,
    pulseBpmLast?.medianRrMs,
    selectedWearableDevice?.id,
    wearableCapabilityTier,
    wearableRuntime.lastHeartRateBpm,
    wearableRuntime.lastRrAtMs,
    wearableRuntime.packetCount,
    wearableRuntime.state,
  ]);

  // BLE prep hang watchdog — interval so a stuck "connecting" state still surfaces a dialog.
  useEffect(() => {
    if (!isWearableMode) return;
    if (phase !== "warmup" && phase !== "qualityCheck") return;
    const hangLimitMs = Platform.OS === "ios" ? 20_000 : 45_000;
    const id = setInterval(() => {
      if (showQcFailedDialog) return;
      const prepStartedAt = protocolStartedAtMs.current ?? Date.now();
      if (Date.now() - prepStartedAt <= hangLimitMs) return;
      const state = wearableRuntime.state;
      const tierReady =
        wearableCapabilityTier === "fullMetrics" || wearableCapabilityTier === "guidedOnly";
      const heartRateReady = (wearableRuntime.lastHeartRateBpm ?? 0) > 0;
      const liveReady = tierReady && state === "ready" && heartRateReady;
      if (liveReady) return;
      setShowQcFailedDialog(true);
    }, 500);
    return () => clearInterval(id);
  }, [
    isWearableMode,
    phase,
    showQcFailedDialog,
    wearableCapabilityTier,
    wearableRuntime.lastHeartRateBpm,
    wearableRuntime.state,
  ]);

  /**
   * Camera activation hang watchdog.
   *
   * QC progress is gated on `pipeline.getLastSourceTimestampMs()` (camera clock).
   * If optical frames never arrive (permission / frame-processor / torch / dead
   * capture session), that clock stays 0, the QC window never starts, and the UI
   * could sit forever on «Ожидание устойчивого сигнала…» with an empty preview —
   * the same screen Audrone reported. Wall-clock failsafe opens the same
   * retry / continue-without-sensor dialog that a failed QC would show.
   */
  useEffect(() => {
    if (isWearableMode || useSimulatedPpg) return;
    if (phase !== "warmup" && phase !== "qualityCheck") return;
    const hangLimitMs = COHERENCE_PREP_TOTAL_MS + 2_000;
    const id = setInterval(() => {
      if (showQcFailedDialog) return;
      const prepStartedAt = protocolStartedAtMs.current ?? Date.now();
      if (Date.now() - prepStartedAt <= hangLimitMs) return;
      qcOutcomeRef.current = "retry_failed";
      setShowQcFailedDialog(true);
    }, 500);
    return () => clearInterval(id);
  }, [isWearableMode, phase, showQcFailedDialog, useSimulatedPpg]);

  // ─── Круговой обратный отсчёт прогрев+QC (warmup 10 с + QC 10 с = 20 с) ───

  useEffect(() => {
    if (phase !== "warmup" && phase !== "qualityCheck") {
      setPrepSecondsLeft(null);
      return;
    }
    if (useSimulatedPpg && !isWearableMode) {
      setPrepSecondsLeft(null);
      return;
    }
    const startedAt = protocolStartedAtMs.current ?? Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, Math.ceil((COHERENCE_PREP_TOTAL_MS - elapsed) / 1000));
      setPrepSecondsLeft(left);
    }, 200);
    return () => clearInterval(id);
  }, [isWearableMode, phase]);

  useEffect(() => {
    if (phase !== "running") return;
    sessionAbortHandledRef.current = false;
    autoAbortAccumMsRef.current = 0;
    opticalStallAccumMsRef.current = 0;
    lastCameraTsForStallRef.current = null;
    fingerAbsentWallMsRef.current = 0;
    fingerRecoveredWallMsRef.current = 0;
    practiceBackgroundEnteredAtRef.current = null;
  }, [phase]);

  useEffect(() => {
    if (!isWearableMode) {
      setShowWearablePickerDialog(false);
      return;
    }
    if (phase !== "running") return;
    if (!selectedWearableDevice?.id) {
      setShowWearablePickerDialog(true);
      return;
    }
    if (wearableCapabilityTier === "fullMetrics" || wearableCapabilityTier === "guidedOnly") {
      setShowWearablePickerDialog(false);
      return;
    }
    if (wearableRuntime.state === "failed" || wearableRuntime.state === "disconnected") {
      setShowWearablePickerDialog(true);
      return;
    }
    if (
      wearableRuntime.state !== "connecting" &&
      wearableRuntime.state !== "reconnecting" &&
      wearableRuntime.state !== "probing" &&
      wearableRuntime.state !== "idle"
    ) {
      return;
    }
    const timeoutId = setTimeout(() => {
      if (
        phaseRef.current === "running" &&
        (wearableCapabilityTier === "unknown" || wearableCapabilityTier === "unsupported")
      ) {
        setShowWearablePickerDialog(true);
      }
    }, 2500);
    return () => clearTimeout(timeoutId);
  }, [
    isWearableMode,
    phase,
    selectedWearableDevice?.id,
    wearableCapabilityTier,
    wearableRuntime.state,
  ]);

  useEffect(() => {
    if (!isWearableMode || phase !== "running" || !selectedWearableDevice?.id) return;
    const timeoutId = setTimeout(() => {
      if (phaseRef.current !== "running") return;
      const canonicalBeatCount = pipeline.getCanonicalBeats().length;
      const liveBpm = pulseBpmLast?.bpm ?? 0;
      const deviceBpm = wearableRuntime.lastHeartRateBpm ?? 0;
      const rrPackets = wearableRuntime.rrPacketCount ?? 0;
      const packets = wearableRuntime.packetCount ?? 0;
      const looksBroken =
        (deviceBpm > 0 && liveBpm <= 0) ||
        canonicalBeatCount < 6 ||
        (packets >= 4 && rrPackets === 0);
      if (looksBroken) {
        setShowWearablePickerDialog(true);
      }
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [
    isWearableMode,
    phase,
    pipeline,
    pulseBpmLast?.bpm,
    selectedWearableDevice?.id,
    wearableRuntime.lastHeartRateBpm,
    wearableRuntime.packetCount,
    wearableRuntime.rrPacketCount,
  ]);

  // ─── Running: добавляем удары в CoherenceEngine + ведём баннеры качества ─

  useEffect(() => {
    if (phase !== "running" || useSimulatedPpg || isWearableMode) return;
    // ВАЖНО: читаем поля `snapshot` через `snapshotRef`, а не из замыкания,
    // чтобы deps этого useEffect были стабильными. Иначе каждые 250 мс (темп
    // обновления snapshot-адаптера) мы пересоздавали setInterval — это и есть
    // «копится и множится в процессе дыхания»: за 20-минутную практику 4800
    // циклов clearInterval+setInterval, каждый из которых отписывает/подписывает
    // таймер в event loop и создаёт новые closure-объекты для GC.
    const id = setInterval(() => {
      const sourceTs = pipeline.getLastSourceTimestampMs();
      const opticalLive = sourceTs > 0;
      // NB: раньше здесь был `coherenceEngine.appendBeats(canonicalBeats)`
      // на каждые 250 мс. Это дубликат: `BiofeedbackPipeline.pushOpticalSample`
      // сам вызывает `appendBeats` при `mergedChanged`, а других источников
      // новых ударов не существует. Убрали, чтобы за 20 мин практики не
      // делать 4800 пустых проходов по `canonicalBeats` (~140 элементов
      // каждый) — лишнее давление на JS-поток и GC.

      let now: number;
      let advance: number;
      if (opticalLive) {
        now = sourceTs;
        const lastSample = lastSampleMsRef.current ?? now;
        const delta = Math.max(0, now - lastSample);
        advance = delta > 2 ? delta : 250;
        lastSampleMsRef.current = now;

        if (lastCameraTsForStallRef.current != null && Math.abs(now - lastCameraTsForStallRef.current) < 1.5) {
          opticalStallAccumMsRef.current += 250;
        } else {
          opticalStallAccumMsRef.current = 0;
        }
        lastCameraTsForStallRef.current = now;
      } else {
        // После resume / сброса буфера `timestampMs` может быть 0 несколько сотен мс.
        // Ранний `return` блокировал `fingerAbsentWallMsRef` и авто-аборт («палец убран»).
        advance = 250;
        // Пока optical пуст, не крутим stall — иначе за ~2 с + устаревший finger=true → ложный abort.
        opticalStallAccumMsRef.current = 0;
        lastCameraTsForStallRef.current = null;
        now = lastSampleMsRef.current ?? 0;
      }

      const snap = snapshotRef.current;
      const fingerOk = snap.fingerDetected;
      const badSignal =
        snap.pulseLockState === "searching" || snap.signalQuality < 0.5;
      const lastLiveBeatTs = lastFreshBeatSourceTsRef.current;
      const liveBeatStaleMs =
        lastLiveBeatTs != null ? Math.max(0, now - lastLiveBeatTs) : Number.POSITIVE_INFINITY;
      const wallBeatAgeMs =
        lastFreshBeatWallClockRef.current != null
          ? Math.max(0, Date.now() - lastFreshBeatWallClockRef.current)
          : Number.POSITIVE_INFINITY;
      const lockTracking = snap.pulseLockState === "tracking";

      if (!fingerOk) {
        fingerAbsentAccumMsRef.current += advance;
        qualityBadAccumMsRef.current = 0;
      } else {
        fingerAbsentAccumMsRef.current = 0;
        if (badSignal) qualityBadAccumMsRef.current += advance;
        else qualityBadAccumMsRef.current = 0;
      }
      prevFingerDetectedForBannerRef.current = fingerOk;
      prevBadSignalForBannerRef.current = badSignal;

      const qualitySustainedBad =
        fingerOk &&
        qualityBadAccumMsRef.current >= CAMERA_GUIDANCE_REMINDER_TRIGGER_MS &&
        badSignal;

      if (opticalLive && sessionStartLogicalMs != null) {
        const practiceTotalSec = Math.max(1, Math.round(practiceTotalMs / 1000));
        const sec = Math.min(
          practiceTotalSec - 1,
          Math.max(0, Math.floor((now - sessionStartLogicalMs) / 1000)),
        );
        if (!fingerOk || qualitySustainedBad) {
          pipeline.getCoherenceEngine().forceSecondBpmZero(sec, practiceTotalSec);
        }
      }

      const sustainedLivePulseLoss = liveBeatStaleMs >= CAMERA_GUIDANCE_REMINDER_TRIGGER_MS;

      const shouldShowCameraGuidanceReminder =
        cameraGuidanceOnlyMode &&
        !cameraGuidanceReminderShownRef.current &&
        (
          fingerAbsentAccumMsRef.current >= CAMERA_GUIDANCE_REMINDER_TRIGGER_MS ||
          qualityBadAccumMsRef.current >= CAMERA_GUIDANCE_REMINDER_TRIGGER_MS ||
          sustainedLivePulseLoss
        );
      if (shouldShowCameraGuidanceReminder) {
        cameraGuidanceReminderShownRef.current = true;
        setPpgOverlayMessage(str.ppgFingerLostMessage);
      } else if (
        cameraGuidanceOnlyMode &&
        !sustainedLivePulseLoss &&
        fingerOk &&
        !badSignal
      ) {
        setPpgOverlayMessage((prev) => (prev === str.ppgFingerLostMessage ? null : prev));
      }

      const hybridEmulated =
        hybridPhaseRef.current === "emulated" && pipeline.isOpticalPaused();
      const appStateNow = appStateRef.current;
      const stallHard = opticalStallAccumMsRef.current >= BREATH_OPTICAL_STALL_HARD_MS;
      const fg = appStateNow === "active" || appStateNow === "inactive";
      /** В фоне накапливаем только «палец убран»; stall по кадрам в фоне даёт ложные срабатывания. */
      const fingerWallTick =
        appStateNow === "active" || appStateNow === "inactive" || appStateNow === "background";

      const liveCameraRecovered = fingerOk && !badSignal && lockTracking;
      if (fingerWallTick && !fingerOk) {
        fingerAbsentWallMsRef.current += 250;
        fingerRecoveredWallMsRef.current = 0;
      } else if (fg && liveCameraRecovered) {
        fingerRecoveredWallMsRef.current += 250;
        if (fingerRecoveredWallMsRef.current >= CAMERA_SIGNAL_RECOVERY_RESET_MS) {
          fingerAbsentWallMsRef.current = 0;
          fingerRecoveredWallMsRef.current = 0;
        }
      } else if (fg && fingerOk) {
        fingerRecoveredWallMsRef.current = 0;
      }

      let abortStress = false;
      if (!hybridEmulated && !useSimulatedPpg && !useEmulatedPulseModeRef.current) {
        const fingerAbortReady =
          !fingerOk && fingerAbsentWallMsRef.current >= BREATH_CAMERA_EMULATED_FALLBACK_MS;
        // Beat-staleness fallback fires on its OWN, regardless of finger presence. A finger can
        // be firmly detected (high presence confidence) yet produce NO usable beats for minutes
        // — cold finger / weak perfusion / marginal PPG amplitude — and that is exactly the
        // "палец есть, пульс не считывается" case the product spec says must switch to a
        // synthetic sine wave so the practice keeps breathing. The old `(!fingerOk || absent≥3s)`
        // guard blocked this path forever when the finger stayed detected, stranding the practice
        // on a stale held BPM. Brief hiccups are already absorbed upstream: the engine bridges
        // gaps ≤ ~8 s and holds BPM through reacquire, and BREATH_CAMERA_EMULATED_FALLBACK_MS
        // (20 s) is well past that, so pure staleness at this threshold is an unambiguous real
        // loss. The wall-clock variant is gated by finger absence to stay immune to bg/fg jumps.
        //
        // START-of-running grace: until a trusted beat has arrived IN `running`
        // (`runningLiveBeatSeenRef`), use the shorter `BREATH_CAMERA_EMULATED_START_GRACE_MS`.
        // On a marginal-PPG start the peak detector can lose lock in settle's tail (last beat
        // ~10 s before `running`), so staleness at t=0 is already ~10 s and the 20 s threshold
        // would leave ~10 s of gray non-pacing measurement at start — the product spec wants a
        // long loss to switch to a synthetic sine wave, and at start there's no prior live
        // running beat to recover to. Once a trusted beat arrives, the full 20 s threshold
        // resumes (mid-session brief losses stay on bridge/hold).
        const emulatedFallbackMs = runningLiveBeatSeenRef.current
          ? BREATH_CAMERA_EMULATED_FALLBACK_MS
          : BREATH_CAMERA_EMULATED_START_GRACE_MS;
        const liveBeatAbortReady =
          liveBeatStaleMs >= emulatedFallbackMs ||
          (wallBeatAgeMs >= BREATH_CAMERA_EMULATED_FALLBACK_MS &&
            (!fingerOk || fingerAbsentWallMsRef.current >= 3_000));
        if (fingerAbortReady || liveBeatAbortReady) {
          abortStress = true;
        } else if (fg && fingerOk && stallHard && !lockTracking) {
          abortStress = true;
        }
      }

      if (cameraGuidanceOnlyMode && abortStress && phaseRef.current === "running") {
        switchToEmulatedPulse("camera", "camera_signal_lost");
        autoAbortAccumMsRef.current = 0;
        return;
      }

      if (abortStress) {
        autoAbortAccumMsRef.current += 250;
      } else {
        autoAbortAccumMsRef.current = 0;
      }

      if (
        !sessionAbortHandledRef.current &&
        autoAbortAccumMsRef.current >= BREATH_CAMERA_EMULATED_FALLBACK_MS &&
        phaseRef.current === "running"
      ) {
        if (cameraGuidanceOnlyMode) {
          switchToEmulatedPulse("camera", "camera_signal_lost");
        } else {
          sessionAbortHandledRef.current = true;
          logRuntimeEvent(
            "breath:session_auto_abort",
            {
              appState: appStateNow,
              stallMs: opticalStallAccumMsRef.current,
              fingerOk,
              lockState: snap.pulseLockState,
              hybridEmulated,
            },
            "info",
          );
          setTimeout(() => {
            applyHardPracticeExitRef.current();
            setPhase("idle");
            setShowAutoAbortDialog(true);
          }, 0);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, [
    cameraGuidanceOnlyMode,
    isWearableMode,
    phase,
    pipeline,
    sessionStartLogicalMs,
    str.ppgFingerLostMessage,
    switchToEmulatedPulse,
  ]);

  useEffect(() => {
    if (!isWearableMode || phase !== "running") return;
    let message: string | null = null;
    if (
      wearableRuntime.state === "reconnecting" &&
      (wearableRuntime.disconnectCount ?? 0) > 0
    ) {
      message = str.wearableRunningReconnect;
    } else if (wearableRuntime.state === "failed" || wearableRuntime.state === "disconnected" || wearableRuntime.state === "signalLost") {
      message = str.wearableRunningDisconnected;
    }
    setPpgOverlayMessage(message);
  }, [
    isWearableMode,
    phase,
    str.wearableRunningDisconnected,
    str.wearableRunningReconnect,
    wearableRuntime.disconnectCount,
    wearableRuntime.state,
  ]);

  // ─── Thermal state: подписка на native event + первичный опрос ──────────
  //
  // На iOS `ProcessInfo.thermalState` приходит в JS через нативный модуль.
  // Обновляем `thermalStateRef.current`, чтобы hybrid-тикер мог принимать
  // решение о переходе realStart → emulated заранее, ДО наступления сильного
  // троттлинга (уровень `fair`).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getThermalState();
        if (!cancelled) thermalStateRef.current = s;
      } catch {
        // игнорируем: в Expo Go / симуляторе getThermalState может отсутствовать
      }
    })();
    const sub = subscribeThermalState((s) => {
      thermalStateRef.current = s;
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // ─── Гибридный тик: смена фаз measurement/emulation/measurement ─────────
  //
  // Работает только для длительных практик (≥ `MIN_TOTAL_MS_FOR_HYBRID`). В
  // короткой практике (≤ 10 мин) трёхфазный режим не имеет смысла: там нет
  // перегрева, и дуальное окно финала съест половину сессии.
  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null || sessionStartLogicalMs == null) {
      return;
    }
    if (!hybridMeasurementEnabled || practiceTotalMs < MIN_TOTAL_MS_FOR_HYBRID) return;

    const controller = hybridControllerRef.current;
    const pipelineLocal = pipeline;
    const id = setInterval(() => {
      hybridTickCountRef.current += 1;
      const now = Date.now();
      // Независимый jank-триггер: смотрим на реальные проявления деградации
      // (UI FPS обвалился / frame-proc latency скаканул / JS-loop отстаёт).
      // Это более надёжный сигнал, чем iOS `thermalState`, который на части
      // устройств остаётся `nominal` даже при явном торможении приложения.
      const jankTriggered = jankDetectorRef.current.shouldTriggerEmulated();
      const out = controller.tick({
        nowMs: now,
        practiceStartMs: sessionStartWallMs,
        practiceTotalMs,
        thermalState: thermalStateRef.current,
        jankTriggered,
      });
      if (!out.changed) return;
      hybridPhaseRef.current = out.phase;
      pendingHybridTransitionReasonRef.current = out.transitionReason;
      recordPerfDiagSample();

      if (out.phase === "emulated") {
        // realStart → emulated.
        // При `ENABLE_HYBRID_EMULATION=false` эта ветка **только размечает
        // границу окна** для dual-window merge метрик, но НЕ глушит камеру,
        // НЕ замораживает baseline, НЕ ставит optical на паузу. В итоге
        // RSA-индикатор продолжает жить реальным пульсом всю практику, а
        // отчёт строится по двум окнам (начало + конец).
        realStartEndedAtMsRef.current = sessionStartLogicalMs + (now - sessionStartWallMs);

        // Batch-пауза: перестаём аккумулировать beats в HrvAccumulator и
        // считать HRV/стресс каждые 10 с. Coherence.appendBeats + tickLive
        // продолжают работать (нужны для RSA индикатора). Это даёт самое
        // большое «облегчение» середины практики без потери синхронизации.
        pipelineLocal.setMetricsCapturePaused(true);

        if (ENABLE_HYBRID_EMULATION) {
          // 1) Стабильный BPM по последним 60с beats.
          const beats = pipelineLocal.getHrvAccumulator().getBeats();
          const cutoff =
            sessionStartLogicalMs + (now - sessionStartWallMs) - HYBRID_STABLE_BPM_WINDOW_MS;
          const recent = beats.filter((t) => t >= cutoff);
          const stableBpm = computeMedianBpmFromBeats(recent.length >= 3 ? recent : beats);
          const fallbackBpm = plannerRef.current.getBaselineBpm();
          const targetBpm = stableBpm != null && stableBpm > 0 ? stableBpm : fallbackBpm;
          // 2) Плавный ramp к стабильному BPM в течение ~10с.
          startBaselineRampTo(targetBpm);
          // 3) Замораживаем baseline.
          plannerRef.current.freezeBaseline();
          // 4) Глушим optical-путь и frame-processor (камера остаётся активной).
          pipelineLocal.setOpticalPaused(true);
          setCameraSilent(true);
        }
      } else if (out.phase === "realEnd") {
        // emulated → realEnd (или `realStart → realEnd` при отключённой
        // эмуляции, если controller всё равно перевёл по endWindow).
        realEndStartedAtMsRef.current = sessionStartLogicalMs + (now - sessionStartWallMs);

        // Снимаем batch-паузу: HrvAccumulator снова начинает копить
        // beats для окна `realEnd`. `markCalibrationComplete` уже был
        // вызван в самом начале (после ready), так что просто возобновление.
        pipelineLocal.setMetricsCapturePaused(false);

        if (ENABLE_HYBRID_EMULATION) {
          stopBaselineRamp();
          plannerRef.current.unfreezeBaseline();
          pipelineLocal.setOpticalPaused(false);
          setCameraSilent(false);
        }
      }
    }, HYBRID_TICK_MS);
    return () => clearInterval(id);
  }, [
    hybridMeasurementEnabled,
    phase,
    sessionStartWallMs,
    sessionStartLogicalMs,
    pipeline,
    startBaselineRampTo,
    stopBaselineRamp,
    recordPerfDiagSample,
  ]);

  // TAG_REMOVE_PERF_DIAGNOSTICS — периодические снимки нагрузки / thermal / фаза.
  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null) return;
    recordPerfDiagSample();
    const id = setInterval(() => {
      perfDiagTickCountRef.current += 1;
      recordPerfDiagSample();
    }, PERF_DIAG_SAMPLE_MS);
    return () => clearInterval(id);
  }, [phase, sessionStartWallMs, recordPerfDiagSample]);

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — быстрый 1 Гц тикер:
   *   • опрашивает native RSS / battery (async, кэшируем в ref);
   *   • кормит JankDetector сигналом «как живёт JS-loop» — реальное
   *     dt между тиками минус номинальные 1000 мс;
   *   • кормит UI-FPS proxy (на JS-потоке Date.now()-аппроксимация
   *     частоты кадров, которую UI реально успевает обработать).
   *
   * Всё в одном тикере, чтобы не плодить setInterval'ов.
   */
  useEffect(() => {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (phase !== "running") return;
    const EXPECTED_INTERVAL_MS = 1_000;
    let lastTickMs = Date.now();
    const id = setInterval(() => {
      nativeSamplerTickCountRef.current += 1;
      const now = Date.now();
      const elapsed = now - lastTickMs;
      lastTickMs = now;
      // Лаг таймера = сколько «украли» тяжёлые задачи на JS-loop.
      // Передаём фактический `EXPECTED_INTERVAL_MS` — иначе JankDetector
      // посчитает «лагом» весь номинальный интервал и загрязнит среднее.
      jankDetectorRef.current.onJsTimerTick(now, elapsed, EXPECTED_INTERVAL_MS);
      // Async чтение native-диагностики.
      void getNativeMemoryMb().then((mb) => {
        nativeMemoryMbRef.current = mb;
      });
      void getBatteryLevelPct().then((pct) => {
        batteryLevelPctRef.current = pct;
      });
    }, 1_000);
    return () => clearInterval(id);
  }, [phase]);

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — JankDetector UI-frame signal.
   *
   * Reanimated's `useFrameCallback` здесь использовать сложно (он
   * в shell'е — см. `BreathPracticeShell.onBreathFrame`); вместо
   * этого эмитим «viewFrame» через requestAnimationFrame. На JS-потоке
   * это не точная UI FPS, но отлично показывает, когда JS-loop начинает
   * пропускать кадры: в норме rAF-колбэк приходит каждые ~16 мс, при
   * лагаx — каждые 30–50 мс.
   */
  useEffect(() => {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (phase !== "running") return;
    let cancelled = false;
    // Decimation: в `emulated` пушим JankDetector только каждый 4-й rAF-кадр
    // (~15 Hz вместо 60 Hz), передавая в `onUiFrame` коэффициент, чтобы
    // метрика uiFps осталась корректной (detector делит dt на N).
    //
    // Обоснование decimation:
    //  - в emulated jank-триггер уже отработал, избыточная точность метрики
    //    не нужна;
    //  - Ring.push + shift × 60 Hz × 10–15 мин — часть накопительной
    //    нагрузки, снижаем её в 4 раза;
    //  - при этом uiFps остаётся честной оценкой истинного UI FPS, т.к.
    //    detector нормализует dt; мы видим и «всё ещё 60», и «упал до 7».
    // В realStart/realEnd — без decimation: метрика максимально точна,
    // чтобы успеть поймать начало деградации до триггера.
    const EMULATED_DECIM = 4;
    let decim = 0;
    const loop = () => {
      if (cancelled) return;
      rafTicksCumulativeRef.current += 1;
      const inEmulated = hybridPhaseRef.current === "emulated";
      if (inEmulated) {
        if (decim % EMULATED_DECIM === 0) {
          jankDetectorRef.current.onUiFrame(Date.now(), EMULATED_DECIM);
        }
      } else {
        jankDetectorRef.current.onUiFrame(Date.now(), 1);
      }
      decim = (decim + 1) & 0x3fffffff;
      requestAnimationFrame(loop);
    };
    const handle = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [phase]);

  // ─── UI таймер сессии + анимации ─────────────────────────────────────────

  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null || sessionStartLogicalMs == null) return;
    const id = setInterval(() => {
      const e = Date.now() - sessionStartWallMs;
      setElapsedMs(Math.min(e, practiceTotalMs));
      if (e < practiceTotalMs) return;
      clearInterval(id);
      // TAG_REMOVE_PERF_DIAGNOSTICS — последняя точка перед finalize-export.
      recordPerfDiagSample();

      const analysisEndLogicalMs = sessionStartLogicalMs + practiceTotalMs;
      const coherenceEngine = pipeline.getCoherenceEngine();
      const rs = realStartEndedAtMsRef.current;
      const re = realEndStartedAtMsRef.current;
      const isHybridSession =
        hybridMeasurementEnabled &&
        !useSimulatedPpg &&
        rs != null &&
        re != null &&
        practiceTotalMs >= MIN_TOTAL_MS_FOR_HYBRID;

      let finalResult: CoherenceSessionResult;
      let practiceHrv: PracticeHrvMetricsResult;
      let finalTrust: BiofeedbackSignalTrustSummary | null = null;
      let recoveredHrvFromTail = false;
      let recoveredCoherenceFromTail = false;
      let recoveredCoherenceTailWindowMs: number | null = null;
      let startTrust: BiofeedbackSignalTrustSummary | null = null;
      let endTrust: BiofeedbackSignalTrustSummary | null = null;
      // Диагностика распределения beats по двум окнам гибрида (см.
      // CoherenceExportDebug.hybridWindowStats). Заполняется только в
      // hybrid-режиме, иначе null.
      let hybridWindowStats: CoherenceExportDebug["hybridWindowStats"] = null;
      finalPulseLogExportRef.current = pulseLogRef.current
        .filter((p) => p.wallClockMs >= sessionStartWallMs)
        .map((p) => ({ ...p }));

      if (cameraGuidanceOnlyMode) {
        // Камера в guidance-only режиме НЕ открывает coherence-сессию (перф/нагрев),
        // поэтому engine здесь неактивен и finalize() бросил бы исключение. Берём
        // пустой результат через side-effect-free analyzeWindow (sessionBeats пуст).
        const cameraBaseResult = coherenceEngine.isActive()
          ? coherenceEngine.finalize(analysisEndLogicalMs)
          : coherenceEngine.analyzeWindow(sessionStartLogicalMs, analysisEndLogicalMs);
        finalResult = {
          ...suppressCoherenceMetrics(cameraBaseResult),
          warnings: [],
        };
        practiceHrv = suppressPracticeHrvMetrics(
          computePracticeHrvMetricsFullSession([]),
        );
        setFinalStartAnalysis(null);
        setFinalEndAnalysis(null);
        setFinalStartHrv(null);
        setFinalEndHrv(null);
        setFinalStartAvgBpm(null);
        setFinalEndAvgBpm(null);
        setFinalStartWindowMs(null);
        setFinalEndWindowMs(null);
      } else if (isHybridSession) {
        const startR = coherenceEngine.analyzeWindow(sessionStartLogicalMs, rs);
        const endR = coherenceEngine.analyzeWindow(re, analysisEndLogicalMs);
        const startBeats = pipeline.getMetricBeatTimestampsInRange(sessionStartLogicalMs, rs);
        const endBeats = pipeline.getMetricBeatTimestampsInRange(re, analysisEndLogicalMs);
        startTrust = pipeline.getSignalTrustSummary({
          startMs: sessionStartLogicalMs,
          endMs: rs,
          applyInitialGraceWindow: true,
        });
        endTrust = pipeline.getSignalTrustSummary({
          startMs: re,
          endMs: analysisEndLogicalMs,
          applyInitialGraceWindow: true,
        });
        hybridWindowStats = {
          allBeatsCount: pipeline.getHrvAccumulator().getBeats().length,
          startWindowBeatsCount: startBeats.length,
          endWindowBeatsCount: endBeats.length,
          startWindowMs: rs - sessionStartLogicalMs,
          endWindowMs: analysisEndLogicalMs - re,
        };
        const gatedStartAnalysis =
          startTrust.level === "full_biometrics" ? startR : suppressCoherenceMetrics(startR);
        const gatedEndAnalysis =
          endTrust.level === "full_biometrics" ? endR : suppressCoherenceMetrics(endR);
        const startHrvRaw = computePracticeHrvMetricsFullSession(startBeats);
        const endHrvRaw = computePracticeHrvMetricsFullSession(endBeats);
        const gatedStartHrv =
          startTrust.level === "pulse_only" ? suppressPracticeHrvMetrics(startHrvRaw) : startHrvRaw;
        const gatedEndHrv =
          endTrust.level === "pulse_only" ? suppressPracticeHrvMetrics(endHrvRaw) : endHrvRaw;
        finalResult = mergeHybridCoherenceSessionResults(gatedStartAnalysis, gatedEndAnalysis);
        coherenceEngine.finalizePrecomputed(finalResult);

        setFinalStartAnalysis(gatedStartAnalysis);
        setFinalEndAnalysis(gatedEndAnalysis);
        setFinalStartHrv(gatedStartHrv);
        setFinalEndHrv(gatedEndHrv);
        setFinalStartAvgBpm(computeMedianBpmFromBeats(startBeats));
        setFinalEndAvgBpm(computeMedianBpmFromBeats(endBeats));
        setFinalStartWindowMs(rs - sessionStartLogicalMs);
        setFinalEndWindowMs(analysisEndLogicalMs - re);

        const hybridHrvBeats = [...startBeats, ...endBeats].sort((a, b) => a - b);
        practiceHrv = computePracticeHrvMetricsFullSession(hybridHrvBeats);
        finalTrust = worstSignalTrust(startTrust, endTrust);
      } else {
        finalResult = coherenceEngine.finalize(analysisEndLogicalMs);
        const metricBeats = pipeline.getMetricBeatTimestamps();
        practiceHrv = computePracticeHrvMetricsFullSession(metricBeats);
        finalTrust = pipeline.getSignalTrustSummary({
          startMs: sessionStartLogicalMs,
          endMs: analysisEndLogicalMs,
          applyInitialGraceWindow: true,
        });
        setFinalStartAnalysis(null);
        setFinalEndAnalysis(null);
        setFinalStartHrv(null);
        setFinalEndHrv(null);
        setFinalStartAvgBpm(null);
        setFinalEndAvgBpm(null);
        setFinalStartWindowMs(null);
        setFinalEndWindowMs(null);
      }

      if (!cameraGuidanceOnlyMode && finalTrust == null) {
        finalTrust = pipeline.getSignalTrustSummary();
      }

      if (!cameraGuidanceOnlyMode && finalTrust != null && finalTrust.level !== "full_biometrics") {
        const recoveredCoherenceTail =
          !isHybridSession
            ? findRecoverableCoherenceTail({
                pipeline,
                coherenceEngine,
                sessionStartMs: sessionStartLogicalMs,
                sessionEndMs: analysisEndLogicalMs,
              })
            : null;
        if (recoveredCoherenceTail != null) {
          finalResult = {
            ...recoveredCoherenceTail.result,
            metricsApproximate: true,
            warnings: [
              ...recoveredCoherenceTail.result.warnings,
              str.recoveredTailCoherenceResultsNote(
                Math.floor(recoveredCoherenceTail.windowMs / 60_000),
                Math.round((recoveredCoherenceTail.windowMs % 60_000) / 1000),
              ),
            ],
          };
          recoveredCoherenceFromTail = true;
          recoveredCoherenceTailWindowMs = recoveredCoherenceTail.windowMs;
        } else {
          finalResult = suppressCoherenceMetrics(finalResult);
        }
      }
      if (!cameraGuidanceOnlyMode && finalTrust != null && finalTrust.level === "pulse_only") {
        const fallbackMetricBeats = !isHybridSession ? pipeline.getRecentReliableMetricBeats() : null;
        if (fallbackMetricBeats != null) {
          const recovered = computePracticeHrvMetricsFullSession(fallbackMetricBeats);
          practiceHrv = {
            ...recovered,
            rmssdApproximate: true,
            stressApproximate: true,
          };
          recoveredHrvFromTail = true;
        } else {
          practiceHrv = suppressPracticeHrvMetrics(practiceHrv);
        }
      }

      const finalRes = useSimulatedPpg
        ? { ...finalResult, warnings: [...finalResult.warnings, str.simulatedMetricsNote] }
        : finalResult;

      const sessionBeats = pipeline.getCoherenceEngine().getSessionBeats();
      const analyzedBeats = finalRes.beatTimestampsMsAnalyzed;
      const rrSeriesMs: number[] = [];
      for (let i = 1; i < analyzedBeats.length; i += 1) {
        const rr = analyzedBeats[i]! - analyzedBeats[i - 1]!;
        if (rr > 0) rrSeriesMs.push(Math.round(rr));
      }
      const peakDiag = pipeline.getPeakDetectorDiagnostics?.() ?? null;
      const debug: CoherenceExportDebug = {
        fingerSessionKey,
        sessionTimeBase:
          useSimulatedPpg || isWearableMode ? "unixEpochMs" : "cameraPresentationMs",
        practicePpgAnchorMs: useSimulatedPpg || isWearableMode ? null : sessionStartLogicalMs,
        wallClockSessionStartMs: sessionStartWallMs,
        snapshotCallbacksTotal: snapshotCallbacksTotalRef.current,
        snapshotsWhileRunning: snapshotsWhileRunningRef.current,
        lastSnapshotTimestampMs: pipeline.getLastSourceTimestampMs(),
        lastSnapshotBeatCount: pipeline.getMergedBeats().length,
        lastSnapshotDetectedBeatCount: pipeline.getMergedBeats().length,
        lastSnapshotPulseLock: pipeline.getLockState(),
        lastSnapshotFingerDetected: snapshotRef.current.fingerDetected,
        rawBeatArrayLengthBeforeFilter: sessionBeats.length,
        beatsAfterDedupeMs: finalRes.beatTimestampsMsAnalyzed.length,
        rawBeatMinMs: sessionBeats[0] ?? null,
        rawBeatMaxMs: sessionBeats[sessionBeats.length - 1] ?? null,
        beatsAfterSessionWindowFilter: finalRes.beatTimestampsMsBeforeDedupe.length,
        analysisSessionStartMs: sessionStartLogicalMs,
        analysisSessionEndMs: analysisEndLogicalMs,
        rrSeriesMs,
        baselineBpmSeries: baselineBpmSeriesRef.current.slice(),
        baselineBpmSummary: (() => {
          const series = baselineBpmSeriesRef.current;
          if (series.length === 0) {
            return {
              startBpm: null,
              endBpm: null,
              minBpm: null,
              maxBpm: null,
              meanBpm: null,
              sampleCount: 0,
            };
          }
          let min = Infinity;
          let max = -Infinity;
          let sum = 0;
          for (const s of series) {
            if (s.bpm < min) min = s.bpm;
            if (s.bpm > max) max = s.bpm;
            sum += s.bpm;
          }
          // start/end — медиана первых/последних 10 точек (сглаживаем шум EMA).
          const headCount = Math.min(10, series.length);
          const tailCount = Math.min(10, series.length);
          const headBpms = series.slice(0, headCount).map((s) => s.bpm).sort((a, b) => a - b);
          const tailBpms = series.slice(-tailCount).map((s) => s.bpm).sort((a, b) => a - b);
          const headMed = headBpms[Math.floor(headBpms.length / 2)] ?? null;
          const tailMed = tailBpms[Math.floor(tailBpms.length / 2)] ?? null;
          return {
            startBpm: headMed != null ? Math.round(headMed * 10) / 10 : null,
            endBpm: tailMed != null ? Math.round(tailMed * 10) / 10 : null,
            minBpm: Math.round(min * 10) / 10,
            maxBpm: Math.round(max * 10) / 10,
            meanBpm: Math.round((sum / series.length) * 10) / 10,
            sampleCount: series.length,
          };
        })(),
        rsaCyclesSummary: rsaCyclesSummaryRef.current.slice(),
        phaseDurationsHistory: phaseDurationsHistoryRef.current.slice(),
        breathPracticeId: practiceIdRef.current,
        breathShape: {
          baseIndex: coherenceShapeRef.current.baseIndex,
          phases: coherenceShapeRef.current.phases.map((p) => ({
            kind: p.kind,
            beats: p.beats,
            channel: p.channel ?? "both",
          })),
        },
        qcOutcome: qcOutcomeRef.current,
        signalTrust: finalTrust ?? undefined,
        practiceRmssdMs: practiceHrv.showRmssd ? practiceHrv.rmssdMs : null,
        practiceStressPercent: practiceHrv.showStress ? practiceHrv.stressPercent : null,
        practiceHrvBeatCount: practiceHrv.validBeatCount,
        peakDetector: peakDiag,
        // `.getSeries()` отдаёт внутренний массив по ссылке — копируем,
        // чтобы последующая очистка `perfDiagnosticsRef` (см. useEffect
        // на phase==="results") не повлияла на уже отданный экспорт.
        runtimeDiagnostics: perfDiagnosticsRef.current.getSeries().slice(),
        runtimeEvents: getRuntimeDiagnosticsEventsSince(runtimeDiagnosticsStartSeqRef.current),
        hybridWindowStats,
      };
      setExportDebug(debug);
      setAnalysis(finalRes);
      setFinalRmssdMs(practiceHrv.showRmssd ? practiceHrv.rmssdMs : null);
      setFinalStressPercent(practiceHrv.showStress ? practiceHrv.stressPercent : null);
      setFinalPulseWasEmulated(pipeline.isPulseEmulated());
      setFinalSignalTrust(finalTrust);
      setFinalHrvRecoveredFromTail(recoveredHrvFromTail);
      setFinalCoherenceRecoveredFromTail(recoveredCoherenceFromTail);
      setFinalCoherenceTailWindowMs(recoveredCoherenceTailWindowMs);
      const pulseLogForGraphs = finalPulseLogExportRef.current ?? [];
      const nonLiveIntervals = collectNonLiveIntervalsFromLog(pulseLogForGraphs, sessionStartWallMs);
      const measuredPulseHighlights = collectMeasuredPulseHighlightIntervals(
        pulseLogForGraphs,
        sessionStartWallMs,
      );
      const guidancePulseHighlights = collectGuidancePulseHighlightIntervals(
        pulseLogForGraphs,
        sessionStartWallMs,
      );
      const measuredPulseSeries = buildMeasuredPulseChartSeries(
        pulseLogForGraphs,
        sessionStartWallMs,
        practiceTotalMs,
      );
      const guidancePulseSeries = buildGuidancePulseChartSeries(
        pulseLogForGraphs,
        sessionStartWallMs,
        practiceTotalMs,
      );
      const metricInsideGap = (tMs: number) =>
        nonLiveIntervals.some((iv) => tMs >= iv.startMs && tMs <= iv.endMs);
      const coherenceSeries = (finalRes.perSecondSmoothed ?? []).filter((point) => {
        // `perSecond` is 0-indexed but `secondIndex` is 1-based (perSecond[0].secondIndex === 1),
        // so the matching coverage checkpoint is at `secondIndex - 1`. Using `secondIndex`
        // directly looked one second ahead and mislabeled boundary seconds as (in)sufficient.
        const rawPoint = finalRes.perSecond[point.secondIndex - 1];
        return (
          rawPoint != null &&
          !rawPoint.insufficientCoverage &&
          !metricInsideGap(point.secondIndex * 1000)
        );
      }).map((point) => ({
        tMs: point.secondIndex * 1000,
        value: point.coherenceMappedPercent,
      }));
      // Metric series are NOT bridged across signal-loss gaps anymore. Bridging drew a straight
      // line across regions where the metric genuinely could not be computed (sensor off,
      // insufficient coherence coverage), which read as fake flat data. Instead we keep the real
      // (gapped) points and let the chart break the line across the gap (see
      // splitPulseChartSeriesSegments). This is the "graphs must honestly show what was computed"
      // requirement.
      // Dense per-second RMSSD & stress from the analyzed beat stream — NOT the sparse
      // (~1 pt / 5–10 s) live-bus snapshots that made RMSSD "ломаной из 3 отрезков". Both use a
      // trailing window that GROWS from t=0 (so the curve starts within ~10–25 s, not at 1:00) and
      // are gated to the same signal-loss gaps as the pulse graph (nonLiveIntervals) so every
      // metric graph breaks at exactly the gray bands, never at a different place.
      const denseHrv = buildDenseHrvSeriesFromBeats(
        finalRes.beatTimestampsMsAnalyzed,
        sessionStartLogicalMs,
        practiceTotalMs,
        nonLiveIntervals,
      );
      const rmssdSeries =
        denseHrv.rmssdMs.length >= 2
          ? filterIsolatedMetricSpikes(denseHrv.rmssdMs)
          : filterIsolatedMetricSpikes(rmssdSeriesRef.current.slice());
      const stressSeries =
        denseHrv.stressPercent.length >= 2
          ? filterIsolatedMetricSpikes(denseHrv.stressPercent)
          : filterIsolatedMetricSpikes(stressSeriesRef.current.slice());
      // RSA amplitude is now a DENSE per-second series from the final analysis (max−min BPM over
      // one breath window), not the sparse per-cycle summary (~1 point / 10 s → the "ломаная из
      // 5 отрезков"). Falls back to the per-cycle summary only if per-second is unavailable.
      const rsaPerSecond = (finalRes.perSecond ?? [])
        .filter((point) => point.rsaAmplitudeBpm != null)
        // Gate RSA to the SAME signal-loss gaps as the pulse/RMSSD/stress graphs. RSA is derived
        // from the analyzed beat stream, which still contains the sporadic buffered beats a Polar
        // strap emits while off-body — so without this it drew a (garbage) RSA point inside the gray
        // band. Gating makes every metric graph break at exactly the gray bands, never beside them.
        .filter((point) => !metricInsideGap(point.secondIndex * 1000))
        .map((point) => ({ tMs: point.secondIndex * 1000, value: point.rsaAmplitudeBpm as number }));
      const rsaSource =
        rsaPerSecond.length >= 2
          ? rsaPerSecond
          : rsaCyclesSummaryRef.current.map((point) => ({ tMs: point.tMs, value: point.rsaBpm }));
      const rsaSeries = filterIsolatedMetricSpikes(
        filterOutlierMetricPoints(rsaSource, RSA_RESULTS_OUTLIER_BPM),
      );
      // Display-only R–R tachogram — does not feed RMSSD/stress/coherence builders.
      // Camera guidance-only leaves beatTimestampsMsAnalyzed empty (no coherence session /
      // paused HRV accumulator); use the live-collected display beat stream instead.
      if (pipeline.isMetricsCapturePaused()) {
        appendNewerBeatsForRrChart(displayRrBeatsRef.current, pipeline.getMergedBeats());
      }
      const rrBeatSource =
        finalRes.beatTimestampsMsAnalyzed.length >= 2
          ? finalRes.beatTimestampsMsAnalyzed
          : displayRrBeatsRef.current.length >= 2
            ? displayRrBeatsRef.current
            : pipeline.getMergedBeats();
      const rrIntervalSeries = buildRrIntervalChartSeries(
        rrBeatSource,
        sessionStartLogicalMs,
        practiceTotalMs,
        nonLiveIntervals,
      );
      setResultsGraphs({
        measuredPulseBpm: decimateSeries(measuredPulseSeries, 240),
        guidancePulseBpm: decimateSeries(guidancePulseSeries, 240),
        measuredPulseHighlights: measuredPulseHighlights,
        guidancePulseHighlights: guidancePulseHighlights,
        rrIntervalMs: decimateSeries(rrIntervalSeries, 360),
        coherencePercent: decimateSeries(coherenceSeries, 240),
        rmssdMs: decimateSeries(rmssdSeries, 120),
        stressPercent: decimateSeries(stressSeries, 120),
        rsaBpm: decimateSeries(rsaSeries, 120),
      });

      // Affirmation finale audio must finish before results; day bump is best-effort.
      void (async () => {
        try {
          await affirmationGateRef.current?.waitForFinaleAudio();
        } catch {
          /* ignore */
        }
        affirmationGateRef.current?.notifyPracticeComplete();
        setPhase("results");
      })();
    }, UI_TICK_MS);
    return () => clearInterval(id);
  }, [
    cameraGuidanceOnlyMode,
    phase,
    sessionStartWallMs,
    sessionStartLogicalMs,
    fingerSessionKey,
    hybridMeasurementEnabled,
    pipeline,
    str.simulatedMetricsNote,
  ]);

  /**
   * Инициализация планировщика при переходе в "running": seed BPM + первый план цикла.
   * Дальнейшее — через `handlePhaseChange` (границы фаз от shell) и `updateBaseline`
   * из подписки на `pulseBpm`.
   */
  useEffect(() => {
    if (phase !== "running") return;
    // Reset the start-grace flag: until a trusted beat arrives IN running, the emulated
    // fallback uses BREATH_CAMERA_EMULATED_START_GRACE_MS (not the full 20 s) so a
    // marginal-PPG start doesn't sit on a gray non-pacing graph for ~10 s.
    runningLiveBeatSeenRef.current = false;
    const planner = plannerRef.current;
    // Seed the planner from the last COHERENT baseline RR when available, NOT from
    // `snapshot.pulseRateBpm`. On a marginal-PPG start (cold finger / weak perfusion) the
    // peak detector can flicker `tracking` on noise during warmup and leave
    // `snapshot.pulseRateBpm` pinned at a bogus value (e.g. ~55 bpm while the user's real
    // pulse is ~80). Seeding the planner from that noise paced the first ~15-20 s of
    // breathing far too slowly until live signal arrived. The coherent baseline
    // (`lastStableRrMs`, only updated on low-jitter windows) reflects the user's true rate;
    // clamp to the physiological camera-seed range so a stale outlier can't run away. For
    // wearable we trust the strap's `pulseRateBpm` directly (it is not noise-polluted).
    const stableRrMs = pipeline.getLastStableRrMs();
    const stableBpm = stableRrMs > 0 ? 60_000 / stableRrMs : 0;
    const plausibleBpm = pipeline.getLastPlausibleBpm();
    const seedBpm = isWearableMode
      ? (snapshot.pulseRateBpm > 0 ? snapshot.pulseRateBpm : (stableBpm > 0 ? stableBpm : INITIAL_SEED_BPM))
      : Math.max(
          CAMERA_EMULATED_SEED_MIN_BPM,
          Math.min(
            CAMERA_EMULATED_SEED_MAX_BPM,
            stableBpm > 0
              ? stableBpm
              : (plausibleBpm > 0
                  ? plausibleBpm
                  : (snapshot.pulseRateBpm > 0 ? snapshot.pulseRateBpm : CAMERA_EMULATED_SEED_DEFAULT_BPM)),
          ),
        );
    planner.seedBaseline(seedBpm);
    const firstPlan = planner.planNextCycle(coherenceShapeRef.current);
    setCurrentPlan(firstPlan);
    lastAppliedShapeRef.current = coherenceShapeRef.current;
    // cycleStartMs специально НЕ задаётся здесь — его выставит «штора»-эффект
    // одновременно с `isBreathTimingActive = true` уже после полного появления practice-UI.
    phaseDurationsHistoryRef.current = [planToHistoryEntry(firstPlan, 0)];
    // next effects: subscribe to pulseBpm to keep baseline EMA fresh.
  }, [phase]);

  /** Подписка на pulseBpm → planner.updateBaseline. Обновления идут ~2 Гц. */
  useEffect(() => {
    if (phase !== "running") return;
    const planner = plannerRef.current;
    return bus.subscribe("pulseBpm", (event) => {
      if (allowAdvancedMetrics && pipeline.getSignalTrustSummary().level !== "full_biometrics") {
        planner.clearLastRsaCycle();
      }
      if (
        cameraGuidanceOnlyMode &&
        !useEmulatedPulseModeRef.current &&
        !isWearableMode
      ) {
        const nowSourceMs = pipeline.getLastSourceTimestampMs();
        const lastFreshBeatMs = lastFreshBeatSourceTsRef.current;
        const liveBeatAgeMs =
          lastFreshBeatMs != null
            ? Math.max(0, nowSourceMs - lastFreshBeatMs)
            : Number.POSITIVE_INFINITY;
        const cameraLiveForGuidance =
          event.hasFreshBeat &&
          event.reacquiring !== true &&
          event.bpm > 0 &&
          liveBeatAgeMs <= BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS;
        if (!cameraLiveForGuidance) {
          return;
        }
      }
      const medianRr = event.medianRrMs;
      const instantBpm = medianRr > 0 && (event.looksCoherent || event.rrCount >= 4)
        ? 60_000 / medianRr
        : event.bpm;
      const bpm = sanitizeBreathGuidanceBpm(
        instantBpm,
        lastLoggedGuidanceBpmRef.current,
      );
      if (bpm > 0) {
        const now = Date.now();
        planner.updateBaseline(now, bpm);
        if (sessionStartWallMs != null) {
          // Decimation: на практике канал `pulseBpm` обновляется ~2 Гц.
          // Для экспорта достаточно 1 точки в 2 с (≈ 600 точек на 20 мин).
          // Это радикально уменьшает размер massива и объём JSON.
          const dt = baselineBpmSeriesRef.current.length > 0
            ? (now - sessionStartWallMs) -
              baselineBpmSeriesRef.current[baselineBpmSeriesRef.current.length - 1]!.tMs
            : Infinity;
          if (dt >= 2_000) {
            baselineBpmSeriesRef.current.push({ tMs: now - sessionStartWallMs, bpm });
            // Мягкий ring-buffer: 3000 точек ≈ 100 мин практики при 2 с/шаг.
            // Если когда-нибудь практика выйдет за этот лимит, самые старые
            // записи выбросятся; финальный анализ использует `start/end window`,
            // а не всю серию целиком, поэтому потери не критичны.
            if (baselineBpmSeriesRef.current.length > 3000) {
              baselineBpmSeriesRef.current = baselineBpmSeriesRef.current.slice(-3000);
            }
          }
        }
      }
    });
  }, [
    allowAdvancedMetrics,
    cameraGuidanceOnlyMode,
    isWearableMode,
    phase,
    bus,
    pipeline,
    sessionStartWallMs,
  ]);

  /** Подписка на coherence → подавать planner последний завершённый RSA-цикл. */
  useEffect(() => {
    if (phase !== "running" || !allowAdvancedMetrics) return;
    const planner = plannerRef.current;
    let lastCycleKey = "";
    return bus.subscribe("coherence", (event) => {
      if (useEmulatedPulseModeRef.current) {
        return;
      }
      if (pipeline.getSignalTrustSummary().level !== "full_biometrics") {
        planner.clearLastRsaCycle();
        return;
      }
      const cycle = event.lastCompletedRsaCycle;
      if (!cycle) return;
      if (
        cycle.rsaBpm > RSA_RESULTS_OUTLIER_BPM ||
        cycle.hrInhale > RSA_CYCLE_MAX_PLAUSIBLE_BPM ||
        cycle.hrExhale > RSA_CYCLE_MAX_PLAUSIBLE_BPM ||
        cycle.hrInhale <= 0 ||
        cycle.hrExhale <= 0
      ) {
        return;
      }
      if (isWearableMode) {
        const runtime = wearableRuntimeRef.current;
        const rrAgeMs =
          runtime.lastRrAtMs != null
            ? Math.max(0, Date.now() - runtime.lastRrAtMs)
            : Number.POSITIVE_INFINITY;
        const wearableLive =
          runtime.state !== "signalLost" &&
          runtime.state !== "disconnected" &&
          runtime.state !== "failed" &&
          runtime.sensorContactDetected !== false &&
          (
            wearableCapabilityTierRef.current !== "fullMetrics" ||
            rrAgeMs <= WEARABLE_LIVE_RR_FRESH_MS
          );
        if (!wearableLive) return;
      }
      planner.ingestCompletedRsaCycle(cycle);
      const key = `${cycle.durationMs.toFixed(0)}|${cycle.hrInhale.toFixed(2)}|${cycle.hrExhale.toFixed(2)}`;
      if (key !== lastCycleKey) {
        lastCycleKey = key;
        rsaCyclesSummaryRef.current.push({
          tMs: sessionStartWallMs != null ? Math.max(0, Date.now() - sessionStartWallMs) : 0,
          hrInhale: cycle.hrInhale,
          hrExhale: cycle.hrExhale,
          rsaBpm: cycle.rsaBpm,
          durationMs: cycle.durationMs,
        });
        // Кап на 2000 циклов (~8 часов практики при 15 с/цикл).
        if (rsaCyclesSummaryRef.current.length > 2000) {
          rsaCyclesSummaryRef.current = rsaCyclesSummaryRef.current.slice(-2000);
        }
      }
    });
  }, [allowAdvancedMetrics, phase, bus, pipeline, sessionStartWallMs]);

  useEffect(() => {
    if (phase !== "running" || !allowAdvancedMetrics || sessionStartWallMs == null) return;
    return bus.subscribe("rmssd", (event) => {
      if (useEmulatedPulseModeRef.current) return;
      if (isWearableMode) {
        const runtime = wearableRuntimeRef.current;
        const rrAgeMs =
          runtime.lastRrAtMs != null
            ? Math.max(0, Date.now() - runtime.lastRrAtMs)
            : Number.POSITIVE_INFINITY;
        const wearableLive =
          runtime.state !== "signalLost" &&
          runtime.state !== "disconnected" &&
          runtime.state !== "failed" &&
          runtime.sensorContactDetected !== false &&
          (
            wearableCapabilityTierRef.current !== "fullMetrics" ||
            rrAgeMs <= WEARABLE_LIVE_RR_FRESH_MS
          );
        if (!wearableLive) return;
      }
      if (!(event.rmssdMs > 0)) return;
      pushSeriesPoint(
        rmssdSeriesRef,
        {
          tMs: Math.max(0, Date.now() - sessionStartWallMs),
          value: event.rmssdMs,
        },
        { minDeltaMs: 5_000, maxPoints: 720 },
      );
    });
  }, [allowAdvancedMetrics, bus, isWearableMode, phase, sessionStartWallMs]);

  useEffect(() => {
    if (phase !== "running" || !allowAdvancedMetrics || sessionStartWallMs == null) return;
    return bus.subscribe("stress", (event) => {
      if (useEmulatedPulseModeRef.current) return;
      if (isWearableMode) {
        const runtime = wearableRuntimeRef.current;
        const rrAgeMs =
          runtime.lastRrAtMs != null
            ? Math.max(0, Date.now() - runtime.lastRrAtMs)
            : Number.POSITIVE_INFINITY;
        const wearableLive =
          runtime.state !== "signalLost" &&
          runtime.state !== "disconnected" &&
          runtime.state !== "failed" &&
          runtime.sensorContactDetected !== false &&
          (
            wearableCapabilityTierRef.current !== "fullMetrics" ||
            rrAgeMs <= WEARABLE_LIVE_RR_FRESH_MS
          );
        if (!wearableLive) return;
      }
      if (!(event.percent >= 0)) return;
      if (stressSeriesRef.current.length === 0 && event.percent === 0) return;
      pushSeriesPoint(
        stressSeriesRef,
        {
          tMs: Math.max(0, Date.now() - sessionStartWallMs),
          value: event.percent,
        },
        { minDeltaMs: 5_000, maxPoints: 720 },
      );
    });
  }, [allowAdvancedMetrics, bus, isWearableMode, phase, sessionStartWallMs]);

  /**
   * Вызывается shell-ом на каждой границе фаз.
   *  - `nextPhaseIndex === 0` → конец цикла: строим полный новый план (как раньше).
   *  - `nextPhaseIndex > 0` и shape изменился → применяем новое `baseBeats` сейчас:
   *    строим новый план и сдвигаем `cycleStartMs` так, чтобы блик оказался ровно в
   *    начале фазы `nextPhaseIndex` в новом плане. Позиция индикатора не прыгает.
   *  - `nextPhaseIndex > 0` и shape не изменился → ничего не делаем, текущий план доиграет.
   *
   * Это не нарушает ни скользящее окно пульса, ни подсчёт RSA / coherence: аналитика
   * смотрит только на поток beats и внешний `cycleMs`, независимо от того, в какие
   * моменты обновляется UI-план.
   */
  const handlePhaseChange = useCallback((nextPhaseIndex: number) => {
    const prevPlan = currentPlanRef.current;
    const prevStart = cycleStartMsRef.current;
    if (!prevPlan || prevStart == null) return;
    const planner = plannerRef.current;
    const shapeNow = coherenceShapeRef.current;
    const shapeChanged = lastAppliedShapeRef.current !== shapeNow;

    if (nextPhaseIndex === 0) {
      // Конец цикла — строим следующий цикл как обычно.
      const nextPlan = planner.planNextCycle(shapeNow);
      const nextStart = prevStart + prevPlan.cycleMs;
      setCurrentPlan(nextPlan);
      setCycleStartMs(nextStart);
      lastAppliedShapeRef.current = shapeNow;
      phaseDurationsHistoryRef.current.push(
        planToHistoryEntry(nextPlan, phaseDurationsHistoryRef.current.length),
      );
      // Кап на 4000 циклов (~16 часов практики при 15 с/цикл).
      if (phaseDurationsHistoryRef.current.length > 4000) {
        phaseDurationsHistoryRef.current = phaseDurationsHistoryRef.current.slice(-4000);
      }
      return;
    }

    if (!shapeChanged) return; // shape тот же — текущий план продолжает работать.

    // Смена базового числа ударов в середине цикла: перепланируем с тем же shape
    // (не ротируем — рисунок практики в целом не меняется), а cycleStartMs сдвигаем
    // так, чтобы индикатор продолжил с начала фазы `nextPhaseIndex` нового плана.
    const nextPlan = planner.planNextCycle(shapeNow);
    const prevPhaseEnd = prevPlan.phases[nextPhaseIndex - 1]?.endMsInCycle ?? 0;
    const newPhaseStart = nextPlan.phases[nextPhaseIndex]?.startMsInCycle ?? 0;
    const nextStart = prevStart + prevPhaseEnd - newPhaseStart;
    setCurrentPlan(nextPlan);
    setCycleStartMs(nextStart);
    lastAppliedShapeRef.current = shapeNow;
    phaseDurationsHistoryRef.current.push(
      planToHistoryEntry(nextPlan, phaseDurationsHistoryRef.current.length),
    );
  }, [planToHistoryEntry]);

  /**
   * Плавный переход «текст инструкции» → «мандала» на старте практики.
   *
   * Было: каждый тик `elapsedMs` (~500 мс) вручную пересчитывался opacity
   * линейно от 1→0 и 0→1 на окне 1500 мс. Поскольку `elapsedMs` обновляется
   * дискретно, opacity прыгал ступенями ~33 % → текст «растворялся рывками»
   * и мандала появлялась «скачками», что пользователь и заметил.
   *
   * Стало: при достижении порога `fadeStart` ОДИН раз запускаем
   * `RNAnimated.timing` на нативном драйвере — анимация идёт плавно на UI
   * thread (60 fps), без участия JS-thread'а и без дёрганых пересчётов.
   *
   * Дополнительно:
   *  - увеличили длительность фейда с 1500 до 2200 мс — переход ощущается
   *    более «дышащим», в духе самой практики;
   *  - начинаем растворять текст на 300 мс раньше (fadeStart сдвинут назад),
   *    чтобы мандала успевала «проявиться» до того, как человек переведёт
   *    взгляд;
   *  - `easing: Easing.inOut(Easing.sin)` даёт S-образную кривую, которая
   *    плавно стартует и плавно завершается — без резкого начала/конца.
   */
  const FADE_TEXT_TO_MANDALA_MS = 2_200;
  const fadeStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null) {
      fadeStartedRef.current = false;
      instructionOpacity.setValue(1);
      mandalaOpacity.setValue(0);
      return;
    }
    const fadeStart = TIMING.instructionPhaseMs - FADE_TEXT_TO_MANDALA_MS;
    if (elapsedMs < fadeStart) {
      if (fadeStartedRef.current) {
        fadeStartedRef.current = false;
        instructionOpacity.setValue(1);
        mandalaOpacity.setValue(0);
      }
      return;
    }
    if (elapsedMs >= TIMING.instructionPhaseMs) {
      instructionOpacity.setValue(0);
      mandalaOpacity.setValue(1);
      return;
    }
    if (fadeStartedRef.current) return;
    fadeStartedRef.current = true;
    // Сколько ещё осталось до конца фейда — если сессия стартует почти на
    // границе, запускаем анимацию на остаток, чтобы не «щёлкнула» в конце.
    const remainingMs = Math.max(
      300,
      TIMING.instructionPhaseMs - elapsedMs,
    );
    RNAnimated.parallel([
      RNAnimated.timing(instructionOpacity, {
        toValue: 0,
        duration: remainingMs,
        easing: RNEasing.inOut(RNEasing.sin),
        useNativeDriver: true,
      }),
      RNAnimated.timing(mandalaOpacity, {
        toValue: 1,
        duration: remainingMs,
        easing: RNEasing.inOut(RNEasing.sin),
        useNativeDriver: true,
      }),
    ]).start();
  }, [elapsedMs, instructionOpacity, mandalaOpacity, phase, sessionStartWallMs]);

  const { isInhale } = useBreathPhaseLabel(elapsedMs, currentPlan);

  const dimOpacity =
    phase === "running" && elapsedMs > practiceTotalMs - TIMING.dimBeforeEndMs
      ? Math.min(
          1,
          (elapsedMs - (practiceTotalMs - TIMING.dimBeforeEndMs)) / TIMING.dimBeforeEndMs,
        )
      : 0;

  // ─── Панель управления: auto-hide, тап-по-экрану, клик мимо панели ────────

  /**
   * Полный сброс пайплайна/гибрида после выхода из running (ручной стоп или авто-аборт).
   * Не меняет `phase` — вызывающий обязан перевести экран в `idle` / иначе.
   */
  const applyHardPracticeExit = useCallback(() => {
    clearPpgBannerUi();
    cameraGuidanceReminderShownRef.current = false;
    lastFreshBeatSourceTsRef.current = null;
    lastFreshBeatWallClockRef.current = null;
    runningLiveBeatSeenRef.current = false;
    displayRrBeatsRef.current = [];
    finalPulseLogExportRef.current = null;
    clearOverlayTimer();
    setOverlayVisible(false);
    setShowStopConfirm(false);
    pipeline.softReset();
    pipeline.getCoherenceEngine().reset();
    plannerRef.current.reset();
    pipeline.setOpticalPaused(false);
    pipeline.setMetricsCapturePaused(!allowAdvancedMetrics);
    hybridControllerRef.current.reset();
    realStartEndedAtMsRef.current = null;
    realEndStartedAtMsRef.current = null;
    stopBaselineRamp();
    hybridPhaseRef.current = "realStart";
    setCameraSilent(false);
    setFinalStartAnalysis(null);
    setFinalEndAnalysis(null);
    setFinalStartHrv(null);
    setFinalEndHrv(null);
    setFinalStartAvgBpm(null);
    setFinalEndAvgBpm(null);
    setFinalStartWindowMs(null);
    setFinalEndWindowMs(null);
    setSessionStartWallMs(null);
    setSessionStartLogicalMs(null);
    setAnalysis(null);
    setExportDebug(null);
    setResultsGraphs(null);
    setFinalRmssdMs(null);
    setFinalStressPercent(null);
    setFinalPulseWasEmulated(false);
    setFinalSignalTrust(null);
    setFinalHrvRecoveredFromTail(false);
    setFinalCoherenceRecoveredFromTail(false);
    setFinalCoherenceTailWindowMs(null);
    setFinalSignalTrust(null);
    setElapsedMs(0);
    setCurrentPlan(null);
    setCycleStartMs(null);
    setEmulatedPulseSeedBpm(null);
    setEmulatedFallbackSource(null);
    setCameraRecoveryProbeActive(false);
    setUseEmulatedPulseMode(false);
    rmssdSeriesRef.current = [];
    stressSeriesRef.current = [];
    opticalStallAccumMsRef.current = 0;
    lastCameraTsForStallRef.current = null;
    autoAbortAccumMsRef.current = 0;
    fingerAbsentWallMsRef.current = 0;
    fingerRecoveredWallMsRef.current = 0;
    practiceBackgroundEnteredAtRef.current = null;
  }, [allowAdvancedMetrics, clearPpgBannerUi, clearOverlayTimer, pipeline, stopBaselineRamp]);

  useEffect(() => {
    applyHardPracticeExitRef.current = applyHardPracticeExit;
  }, [applyHardPracticeExit]);

  /**
   * AppState: синхронизация для gating камеры + авто-аборт при возврате из фона,
   * если в фоне JS-таймеры не крутились, а палец уже не на сенсоре.
   */
  useEffect(() => {
    const syncInit = () => {
      const s = AppState.currentState;
      appStateRef.current = s;
      setPracticeAppState(s);
    };
    syncInit();

    const sub = AppState.addEventListener("change", (next) => {
      const prev = appStateRef.current;
      logRuntimeEvent("breath:practice_app_state_changed", { prev, next, phase: phaseRef.current }, "debug");

      const hybridEmulated =
        hybridPhaseRef.current === "emulated" && pipeline.isOpticalPaused();
      const realPpgRunning =
        phaseRef.current === "running" &&
        !useSimulatedPpg &&
        !useEmulatedPulseModeRef.current &&
        !hybridEmulated;

      if (prev !== "background" && next === "background" && realPpgRunning) {
        practiceBackgroundEnteredAtRef.current = Date.now();
        logRuntimeEvent(
          "breath:practice_background_entered",
          { phase: phaseRef.current, pulseLockState: snapshotRef.current.pulseLockState },
          "info",
        );
      }

      if (prev === "background" && next === "active") {
        const t0 = practiceBackgroundEnteredAtRef.current;
        practiceBackgroundEnteredAtRef.current = null;
        logRuntimeEvent(
          "breath:practice_background_resumed",
          {
            phase: phaseRef.current,
            backgroundMs: t0 != null ? Date.now() - t0 : null,
            pulseLockState: snapshotRef.current.pulseLockState,
          },
          "info",
        );
        if (
          t0 != null &&
          !sessionAbortHandledRef.current &&
          phaseRef.current === "running" &&
          realPpgRunning
        ) {
          if (isWearableMode) {
            logRuntimeEvent(
              "breath:wearable_background_resume_ignored",
              {
                backgroundMs: Date.now() - t0,
                wearableState: wearableRuntimeRef.current.state,
                lastHeartRateBpm: wearableRuntimeRef.current.lastHeartRateBpm ?? null,
                lastRrAgeMs:
                  wearableRuntimeRef.current.lastRrAtMs != null
                    ? Math.max(0, Date.now() - wearableRuntimeRef.current.lastRrAtMs)
                    : null,
              },
              "info",
            );
          } else {
          const snap = snapshotRef.current;
          if (!snap.fingerDetected) {
            if (cameraGuidanceOnlyMode) {
              switchToEmulatedPulse("camera", "resume_from_background_no_finger");
            } else {
              sessionAbortHandledRef.current = true;
              logRuntimeEvent(
                "breath:session_auto_abort",
                {
                  reason: "resume_from_background_no_finger",
                  backgroundMs: Date.now() - t0,
                  lockState: snap.pulseLockState,
                },
                "info",
              );
              setTimeout(() => {
                applyHardPracticeExitRef.current();
                setPhase("idle");
                setShowAutoAbortDialog(true);
              }, 0);
            }
          }
          }
        }
      }

      appStateRef.current = next;
      setPracticeAppState(next);
    });

    return () => sub.remove();
  }, [cameraGuidanceOnlyMode, pipeline, switchToEmulatedPulse]);

  const handleScreenTap = useCallback(() => {
    if (showStopConfirm) return;
    toggleOverlay();
  }, [showStopConfirm, toggleOverlay]);

  const handleOverlayInteraction = useCallback(() => {
    scheduleOverlayHide();
  }, [scheduleOverlayHide]);

  const handleIncrementBeats = useCallback(() => {
    setTempoKey((prev) => {
      if (practice.id === "triangle-up" || practice.id === "triangle-down") {
        return stepTriangleTempoKey(practice.id, prev, 1) ?? prev;
      }
      return stepLinearTempoKey(prev, 1);
    });
  }, [practice.id]);

  const handleDecrementBeats = useCallback(() => {
    setTempoKey((prev) => {
      if (practice.id === "triangle-up" || practice.id === "triangle-down") {
        return stepTriangleTempoKey(practice.id, prev, -1) ?? prev;
      }
      return stepLinearTempoKey(prev, -1);
    });
  }, [practice.id]);

  // Persist tempo only once the practice is actually running (not card-only tweaks).
  useEffect(() => {
    if (phase !== "running") return;
    void updateBreathTempoPreference(practice.id, tempoKey);
  }, [phase, practice.id, tempoKey]);

  const handleRequestStop = useCallback(() => {
    clearOverlayTimer();
    setShowStopConfirm(true);
  }, [clearOverlayTimer]);

  useEffect(() => {
    if (phase !== "running") {
      setOverlayVisible(false);
      clearOverlayTimer();
    }
  }, [phase, clearOverlayTimer]);

  /**
   * One-shot «hint-всплытие» панели управления в начале каждой практики,
   * как если бы пользователь тапнул по экрану.
   *
   * Причина: без этого многие не догадываются, что панель снизу вообще
   * существует (она скрыта по дефолту, появляется только по тапу). А именно
   * там настраивается темп дыхания и видны оставшиеся минуты. Один раз в
   * начале — это мягкое знакомство: панель «сама» выезжает сразу после
   * того как inструкция перешла в мандалу (началось движение индикатора)
   * и так же «сама» уезжает вниз через тот же `OVERLAY_AUTOHIDE_MS`, что
   * используется при тапе. Если пользователь в это время тапнет — таймер
   * перезапустится (обычное поведение overlay).
   *
   * Триггер — `elapsedMs >= instructionPhaseMs` (инструкция полностью
   * пропала, начинается основное движение), один раз за running-фазу.
   * `hintShownRef` защищает от повторного срабатывания при каждом тике
   * setInterval для elapsedMs.
   */
  const hintShownRef = useRef(false);
  useEffect(() => {
    if (phase !== "running") {
      hintShownRef.current = false;
      return;
    }
    if (hintShownRef.current) return;
    if (elapsedMs < TIMING.instructionPhaseMs) return;
    hintShownRef.current = true;
    setOverlayVisible(true);
    scheduleOverlayHide();
  }, [phase, elapsedMs, scheduleOverlayHide]);

  useEffect(() => () => clearOverlayTimer(), [clearOverlayTimer]);

  /**
   * ── Results-phase memory release ─────────────────────────────────────────
   *
   * К моменту перехода `running → results` мы УЖЕ:
   *   1) сложили все нужные слайсы в `exportDebug`
   *      (`baselineBpmSeries`, `rsaCyclesSummary`, `phaseDurationsHistory`,
   *      `runtimeDiagnostics`);
   *   2) рассчитали `analysis` из `pipeline.getCoherenceEngine().buildExport...`.
   *
   * Дальше эти refs не читаются для рисования (results-экран статичен), но
   * держат ~50-300 КБ JS-heap каждый. Прошлые 20-минутные сессии оставляли
   * ~200-400 МБ нативной памяти и JS-массивы на результатном экране — и
   * пользователь отмечал, что телефон оставался заметно тёплым даже спустя
   * полчаса на заблокированном экране. В dev-режиме Metro держит app-процесс
   * дольше обычного, и iOS вынужден компактить большие резидентные страницы.
   *
   * Здесь мы проактивно отпускаем всё, что не нужно для показа результатов
   * и для `exportJson`. PulseLog нужен для `exportJson` (пишется лениво), и
   * clear'им его отдельно на AppState→background (см. следующий useEffect).
   */
  useEffect(() => {
    if (phase !== "results") return;
    // exportDebug уже владеет слайсами этих массивов — мы отдаём оригиналы GC.
    baselineBpmSeriesRef.current = [];
    rsaCyclesSummaryRef.current = [];
    rmssdSeriesRef.current = [];
    stressSeriesRef.current = [];
    phaseDurationsHistoryRef.current = [];
    opticalPreviewBufferRef.current = [];
    qcPulseSamplesRef.current = [];
    perfDiagnosticsRef.current.reset();
    jankDetectorRef.current.reset();
    // opticalPreviewSamples — React state ~72 сэмпла. Нужен только во время
    // warmup/qc; на results он уже не отрисовывается. Сбрасываем — иначе
    // бесконечно висит в памяти до следующего beginFromIdle.
    setOpticalPreviewSamples((prev) => (prev.length === 0 ? prev : []));
  }, [phase]);

  /**
   * ── AppState backgrounding on results: финальная очистка ─────────────────
   *
   * Пользователь на results заблокировал экран и ушёл на 30 минут. В этот
   * момент iOS отправит `AppState → background`. До фактической suspension
   * у нас есть ~30 секунд — идеальный момент, чтобы:
   *  - обнулить `pulseLog` (последний крупный массив — до 7200 элементов);
   *  - сбросить `pipeline` (удалит всех накопленных beats + optical decim
   *    buffers). Это БЕЗОПАСНО: results-экран рисуется только из React
   *    state (`analysis`, `exportDebug`, ...), а не из pipeline.
   *    Единственный побочный эффект — если пользователь ВЕРНЁТСЯ и нажмёт
   *    «Экспорт JSON», pulseLog будет пуст. Это компромисс приемлем:
   *    экспорт нужен разработчикам (отладка активации), основные метрики
   *    уже в `exportDebug` и в `analysis`.
   *  - `setExportDebug(null)` НЕ делаем — results-экран всё ещё его читает
   *    (`debugTimeBase`, `beatsAfterSessionWindowFilter`), да и сам объект
   *    небольшой после того, как из него ушли слайсы.
   *
   * Это главная починка «хвоста» (phone hot after practice): без этого
   * Metro dev-client и/или iOS вынуждены держать большой working-set
   * страниц даже в фоне.
   */
  useEffect(() => {
    if (phase !== "results") return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "background") return;
      pulseLogRef.current = [];
      displayRrBeatsRef.current = [];
      lastFreshBeatSourceTsRef.current = null;
      lastFreshBeatWallClockRef.current = null;
      runningLiveBeatSeenRef.current = false;
      try {
        pipeline.softReset();
      } catch {
        // softReset безопасен и идемпотентен, но страхуемся от неожиданностей.
      }
    });
    return () => sub.remove();
  }, [phase, pipeline]);

  const beginFromIdle = useCallback(
    (forceEmulatedPulse = false) => {
      pipeline.softReset();
      pipeline.getCoherenceEngine().reset();
      plannerRef.current.reset();
      qcStartLogicalMsRef.current = null;
      qualityBadAccumMsRef.current = 0;
      fingerAbsentAccumMsRef.current = 0;
      lastSampleMsRef.current = null;
      pulseLogRef.current = [];
      displayRrBeatsRef.current = [];
      finalPulseLogExportRef.current = null;
      qcPulseSamplesRef.current = [];
      opticalPreviewBufferRef.current = [];
      lastOpticalPreviewRefreshWallMsRef.current = 0;
      lastPulseLogWallClockRef.current = 0;
      lastFreshBeatSourceTsRef.current = null;
      lastFreshBeatWallClockRef.current = null;
      runningLiveBeatSeenRef.current = false;
      snapshotCallbacksTotalRef.current = 0;
      snapshotsWhileRunningRef.current = 0;
      phaseDurationsHistoryRef.current = [];
      baselineBpmSeriesRef.current = [];
      rsaCyclesSummaryRef.current = [];
      qcOutcomeRef.current = forceEmulatedPulse ? "user_chose_no_sensor" : null;
      // Сброс гибридного режима — иначе прошлые границы окон утекут в
      // dual-window анализ следующей практики.
      hybridControllerRef.current.reset();
      perfDiagnosticsRef.current.reset();
      jankDetectorRef.current.reset();
      // Сброс activity-счётчиков между практиками: иначе по JSON'у
      // видны кумулятивы предыдущей сессии.
      renderCountInnerRef.current = 0;
      mandalaRenderCountRef.current = 0;
      rafTicksCumulativeRef.current = 0;
      hybridTickCountRef.current = 0;
      perfDiagTickCountRef.current = 0;
      nativeSamplerTickCountRef.current = 0;
      nativeMemoryMbRef.current = null;
      batteryLevelPctRef.current = null;
      pendingHybridTransitionReasonRef.current = null;
      realStartEndedAtMsRef.current = null;
      realEndStartedAtMsRef.current = null;
      stopBaselineRamp();
      pipeline.setOpticalPaused(forceEmulatedPulse);
      pipeline.setMetricsCapturePaused(!allowAdvancedMetrics);
      plannerRef.current.unfreezeBaseline();
      hybridPhaseRef.current = "realStart";
      setCameraSilent(false);
      setFinalStartAnalysis(null);
      setFinalEndAnalysis(null);
      setFinalStartHrv(null);
      setFinalEndHrv(null);
      setFinalStartAvgBpm(null);
      setFinalEndAvgBpm(null);
      setFinalStartWindowMs(null);
      setFinalEndWindowMs(null);
      // Wearable: keep GATT alive across start — remounting BLE cancels the link
      // and re-triggers Android «Запрос подключения».
      if (!(isWearableMode && selectedWearableDevice?.id && !forceEmulatedPulse)) {
        setSourceKey((k) => k + 1);
      }
      setExportDebug(null);
      setAnalysis(null);
      setResultsGraphs(null);
      setOpticalPreviewSamples([]);
      setFinalRmssdMs(null);
      setFinalStressPercent(null);
      setFinalPulseWasEmulated(false);
      setFinalSignalTrust(null);
      setFinalHrvRecoveredFromTail(false);
      setFinalCoherenceRecoveredFromTail(false);
      setFinalCoherenceTailWindowMs(null);
      setSessionStartLogicalMs(null);
      setCurrentPlan(null);
      setCycleStartMs(null);
      setEmulatedPulseSeedBpm(null);
      setEmulatedFallbackSource(null);
      setCameraRecoveryProbeActive(false);
      setUseEmulatedPulseMode(forceEmulatedPulse);
      setDisableOpticalHardware(forceEmulatedPulse);
      setShowQcFailedDialog(false);
      setShowAutoAbortDialog(false);
      setShowWearablePickerDialog(false);
      rmssdSeriesRef.current = [];
      stressSeriesRef.current = [];
      cameraGuidanceReminderShownRef.current = false;
      sessionAbortHandledRef.current = false;
      opticalStallAccumMsRef.current = 0;
      lastCameraTsForStallRef.current = null;
      autoAbortAccumMsRef.current = 0;
      fingerAbsentWallMsRef.current = 0;
      fingerRecoveredWallMsRef.current = 0;
      practiceBackgroundEnteredAtRef.current = null;
      runtimeDiagnosticsStartSeqRef.current = getRuntimeDiagnosticsCurrentSeq();
      clearPpgBannerUi();

      // Camera PPG requested but native plugin missing (Android today / Expo Go):
      // never silently pretend this is a real optical session.
      if (!isWearableMode && useSimulatedPpg && !forceEmulatedPulse) {
        const practiceStrings = getPracticeCatalogStrings(locale);
        Alert.alert(practiceStrings.sensorCameraUnavailableTitle, practiceStrings.sensorCameraUnavailableBody, [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }

      if (!isWearableMode && (useSimulatedPpg || forceEmulatedPulse)) {
        const now = Date.now();
        const estCycleMs = computeCycleMsForAnalysis(
          coherenceShapeRef.current,
          pulseBpmLast?.medianRrMs,
        );
        pipeline.getCoherenceEngine().startSession({
          sessionStartedAtMs: now,
          inhaleMs: estCycleMs.inhaleMs,
          exhaleMs: estCycleMs.exhaleMs,
          cycleMs: estCycleMs.cycleMs,
          mode: "test120s",
          bufferMsBeforeSession: 0,
        });
        setSessionStartWallMs(now);
        setSessionStartLogicalMs(now);
        setElapsedMs(0);
        setPhase("running");
        return;
      }

      if (isWearableMode && selectedWearableDevice?.id && !forceEmulatedPulse) {
        warmupStartedAtMs.current = Date.now();
        protocolStartedAtMs.current = Date.now();
        setSessionStartWallMs(null);
        setSessionStartLogicalMs(null);
        setElapsedMs(0);
        setPhase("warmup");
        return;
      }

      warmupStartedAtMs.current = Date.now();
      protocolStartedAtMs.current = Date.now();
      setSessionStartWallMs(null);
      setElapsedMs(0);
      // TAG_REMOVE_PERF_DIAGNOSTICS — начало новой сессии активации.
      activationSessionIdRef.current =
        `act-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      activationAttemptNumberRef.current = 1;
      setPhase("warmup");
    },
    [
      allowAdvancedMetrics,
      clearPpgBannerUi,
      isWearableMode,
      locale,
      pipeline,
      pulseBpmLast?.medianRrMs,
      selectedWearableDevice?.id,
      stopBaselineRamp,
      useSimulatedPpg,
    ],
  );

  useEffect(() => {
    if (autoStartedRef.current || phase !== "idle" || !durationMs) return;
    autoStartedRef.current = true;
    beginFromIdle(resolvedSensorMode === "none");
  }, [beginFromIdle, durationMs, phase, resolvedSensorMode]);

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS
   *
   * Ручной экспорт диагностики **экрана активации пульсометра**. Пользователь
   * держит палец 20-60 секунд, затем жмёт «Диагностика» — JSON со снимком
   * pipeline уходит разработчику. Используется для разбора ситуаций, когда
   * пульс не ловится или ловится неверно, ДО того как успел сработать
   * полный экспорт практики (тот доступен только после завершения всей
   * 20-минутной сессии).
   *
   * Содержимое:
   *  - `opticalSamples` — сырые optical-сэмплы за последние ~12 с с
   *    redMean/greenMean/blueMean/opticalValue/quality/timestampMs и
   *    всеми вспомогательными метриками;
   *  - `mergedBeats` — обнаруженные удары (timestamps, ms);
   *  - `peakDetectorDiagnostics` — счётчики отсечённых пиков;
   *  - `snapshot` — текущий bio snapshot (BPM, quality, состояния);
   *  - `captureConfig` — параметры захвата (fps, torch, stride) в момент
   *    экспорта для воспроизводимости.
   *
   * Легко выключается: установить `DEBUG_ACTIVATION_EXPORT_ENABLED = false`
   * в этом модуле — кнопка исчезнет.
   */
  const exportActivationDiagnostic = useCallback(async (reason: string = "manual") => {
    try {
      const diag = pipeline.getActivationDiagnostic();
      // Параллельно запрашиваем системные метрики — они асинхронные, но
      // быстрые, и дают ценный контекст для удалённой диагностики (модель
      // телефона, память, температура процессора, уровень батареи).
      const [thermal, memoryMb, batteryPct] = await Promise.all([
        getThermalState().catch(() => "nominal" as ThermalState),
        getNativeMemoryMb().catch(() => null),
        getBatteryLevelPct().catch(() => null),
      ]);
      const payload = {
        // Схема эволюционировала: v2 добавил qcLastEvaluation, v3 добавил
        // deviceInfo / sessionContext / systemDiagnostics / breathPracticeId
        // для группировки отчётов в будущей облачной телеметрии.
        schemaVersion: "activation-diagnostic-v3",
        reason,
        exportedAtMs: Date.now(),
        phase,
        elapsedMsInPhase: elapsedMs,
        sessionContext: {
          activationSessionId: activationSessionIdRef.current,
          attemptNumber: activationAttemptNumberRef.current,
          breathPracticeId: practiceIdRef.current,
          breathShapePhasesCount: coherenceShapeRef.current.phases.length,
          breathShapeBaseIndex: coherenceShapeRef.current.baseIndex,
        },
        deviceInfo: {
          platform: Platform.OS,
          osVersion: String(Platform.Version ?? ""),
          // expo-constants.deviceName: «iPhone 15 Pro» и т.п. (или user alias).
          // Для прод-телеметрии это анонимизированное поле, сейчас удобно в отладке.
          deviceName:
            ((Constants as unknown as { deviceName?: string }).deviceName) ?? null,
          // Версия приложения из expo-constants.
          appVersion:
            ((Constants.expoConfig as unknown as { version?: string } | null)?.version) ?? null,
        },
        systemDiagnostics: {
          thermalState: thermal,
          memoryMb,
          batteryPct,
        },
        snapshot: {
          pulseRateBpm: snapshot.pulseRateBpm,
          signalQuality: snapshot.signalQuality,
          pulseLockState: snapshot.pulseLockState,
          fingerDetected: snapshot.fingerDetected,
          mergedBeatsCount: snapshot.mergedBeats.length,
        },
        qcLastEvaluation: qcLastEvaluationRef.current,
        pipeline: diag,
      };
      const json = JSON.stringify(payload, null, 2);
      const base = cacheDirectory;
      if (base == null) {
        Alert.alert("Файлы", "Каталог кэша недоступен.");
        return;
      }
      const path = `${base}breath-activation-diagnostic-${Date.now()}.json`;
      await writeAsStringAsync(path, json);
      const title = "PPG activation diagnostic";
      if (Platform.OS === "android") {
        const contentUri = await getContentUriAsync(path);
        await Share.share({ title, message: "activation-diagnostic.json", url: contentUri });
      } else {
        const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
        await Share.share({ title, url: fileUrl });
      }
    } catch (e: unknown) {
      Alert.alert("Диагностика", String(e));
    }
  }, [pipeline, phase, elapsedMs, snapshot]);

  // Синхронизируем ref с актуальным callback, чтобы авто-экспорт при QC
  // failure (в useEffect'е выше по файлу) всегда получал свежую функцию,
  // а не замыкание на первый рендер.
  useEffect(() => {
    exportActivationDiagnosticRef.current = exportActivationDiagnostic;
  }, [exportActivationDiagnostic]);

  // TAG_REMOVE_PERF_DIAGNOSTICS — сбрасываем идентификатор сессии активации
  // при возврате в idle (пользователь отменил или закончил практику).
  // При следующем запуске warmup будет сгенерирован новый sessionId.
  useEffect(() => {
    if (phase === "idle") {
      activationSessionIdRef.current = null;
      activationAttemptNumberRef.current = 0;
    }
  }, [phase]);

  const exportJson = useCallback(async () => {
    if (analysis == null || sessionStartWallMs == null || sessionStartLogicalMs == null) return;
    const analysisEndLogicalMs = sessionStartLogicalMs + practiceTotalMs;
    const measuredPulseByTime = new Map(
      (resultsGraphs?.measuredPulseBpm ?? []).map((point) => [point.tMs, point.value] as const),
    );
    const guidancePulseFallbackPoints =
      resultsGraphs?.guidancePulseBpm.length ? resultsGraphs.guidancePulseBpm : (resultsGraphs?.measuredPulseBpm ?? []);
    const fallbackPulseLogFromGraphs =
      guidancePulseFallbackPoints.length > 0
        ? guidancePulseFallbackPoints.map((point) => {
            const measuredPulseRateBpm = measuredPulseByTime.get(point.tMs) ?? point.value;
            const emulatedActive = Math.abs(measuredPulseRateBpm - point.value) > 0.5;
            return {
            cameraTimestampMs: sessionStartLogicalMs + point.tMs,
            wallClockMs: sessionStartWallMs + point.tMs,
            pulseRateBpm: measuredPulseRateBpm,
            measuredPulseRateBpm,
            guidancePulseRateBpm: point.value,
            signalQuality: 0,
            pulseReady: measuredPulseRateBpm > 0,
            fingerDetected: !isWearableMode && measuredPulseRateBpm > 0,
            pulseLockState: "tracking" as const,
            beatTimestampsCount: 0,
            lastBeatTimestampMs: null,
            lastBeatAgeMs: null,
            pulseSource: isWearableMode ? "wearable" : "fingerCamera",
            emulatedActive,
            wearableState: null,
            wearableCapabilityTier: null,
            wearableHeartRateBpm: isWearableMode ? measuredPulseRateBpm : null,
            wearableLastRrAgeMs: null,
            wearablePacketCount: null,
            wearableRrPacketCount: null,
            };
          })
        : undefined;
    const pulseLogForExport =
      finalPulseLogExportRef.current
      ?? fallbackPulseLogFromGraphs
      ?? (useSimulatedPpg
        ? undefined
        : pulseLogRef.current.filter((p) => p.wallClockMs >= sessionStartWallMs));
    const pulseLockTransitions =
      pulseLogForExport && sessionStartWallMs != null
        ? summarizePulseLockTransitions(pulseLogForExport, sessionStartWallMs)
        : undefined;
    const debugForExport: CoherenceExportDebug | undefined =
      exportDebug != null
        ? {
            ...exportDebug,
            pulseLockTransitions,
          }
        : undefined;
    const payload = pipeline.getCoherenceEngine().buildExportJson(analysisEndLogicalMs, {
      dataSource: isWearableMode ? "wearable" : useSimulatedPpg ? "simulated" : "fingerPpg",
      debug: debugForExport,
      resultOverride: analysis,
      pulseLog: pulseLogForExport,
    });
    const json = JSON.stringify(payload, null, 2);
    const base = cacheDirectory;
    if (base == null) {
      Alert.alert("Файлы", "Каталог кэша недоступен.");
      return;
    }
    const path = `${base}breath-coherence-export-${Date.now()}.json`;
    try {
      await writeAsStringAsync(path, json);
      const title = "Breath coherence export";
      if (Platform.OS === "android") {
        const contentUri = await getContentUriAsync(path);
        await Share.share({ title, message: "breath-coherence.json", url: contentUri });
      } else {
        const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
        await Share.share({ title, url: fileUrl });
      }
    } catch (e: unknown) {
      Alert.alert("Экспорт", String(e));
    }
  }, [analysis, exportDebug, isWearableMode, pipeline, practiceTotalMs, resultsGraphs, sessionStartLogicalMs, sessionStartWallMs, useSimulatedPpg]);

  /**
   * Индекс активной фазы текущего плана. Обновляется ~15 Гц от **того же** таймбейза,
   * что и worklet индикатора (`cycleStartMs`), иначе текст фазы опережает/отстаёт от
   * движения блика (особенно когда между phase="running" и стартом дыхания есть fade-in).
   */
  const [activePhaseIndex, setActivePhaseIndex] = useState(0);
  useEffect(() => {
    if (phase !== "running" || !isBreathTimingActive || cycleStartMs == null) {
      setActivePhaseIndex(0);
      return;
    }
    const plan = currentPlan;
    if (!plan || plan.cycleMs <= 0) return;
    /**
     * Lookahead для смены слова вдох/выдох/задержка.
     *
     * Фейдинг (dim→swap→restore) занимает ~370 мс, а воспринимается
     * «текстом нового слова» только после swap. Если переключать точно
     * на границе фазы, глаз успевает зафиксировать новое слово уже с
     * опозданием 150-200 мс после того, как индикатор дыхания начал
     * новое движение. Сдвигаем момент смены «назад» по времени — так,
     * чтобы swap нового слова приходился примерно на реальную смену
     * фазы, а не на её середину.
     */
    const PHASE_LABEL_LOOKAHEAD_MS = 160;
    const id = setInterval(() => {
      const cycleMs = plan.cycleMs;
      const rawT = Date.now() - cycleStartMs + PHASE_LABEL_LOOKAHEAD_MS;
      const t = ((rawT % cycleMs) + cycleMs) % cycleMs;
      let idx = 0;
      for (let i = 0; i < plan.phases.length; i += 1) {
        if (t >= plan.phases[i]!.startMsInCycle && t < plan.phases[i]!.endMsInCycle) {
          idx = i;
          break;
        }
      }
      setActivePhaseIndex((prev) => (prev === idx ? prev : idx));
    }, 60);
    return () => clearInterval(id);
  }, [phase, isBreathTimingActive, cycleStartMs, currentPlan]);

  const activePhase = currentPlan?.phases[activePhaseIndex] ?? null;

  const phaseLabel = !activePhase
    ? str.inhale
    : activePhase.kind === "inhale"
      ? str.inhale
      : activePhase.kind === "exhale"
        ? str.exhale
        : str.hold;
  // Длительность фазы под словом ВДОХ/ВЫДОХ/ЗАДЕРЖКА показываем **в ударах пульса**, а
  // не в секундах. Так число совпадает с цифрой выбора ритма на панели управления.
  const phaseBeats = activePhase ? activePhase.beats : 0;
  void isInhale; // isInhale больше не используется — оставлен хук-вызов для согласия с dep.

  // Мягкий fade при смене фазы: dim→swap→restore с подменой текста по пути.
  // Длительности заметно увеличены (по сравнению с 140/150/200 мс), чтобы переход
  // ощущался плавным, а не «дёрганным»: человеческий глаз хорошо различает
  // изменения яркости длительностью < 200 мс, и короткий fade читается как
  // резкое переключение. 260/200/340 мс даёт ~800 мс на всю анимацию —
  // этого достаточно для ощущения плавности, но всё ещё короче половины
  // самой короткой фазы (обычно ≥ 3 с), поэтому нового слова никто не
  // пропустит.
  //
  // Дополнительно мы dim'им текст сильнее (до 0.15 вместо 0.25) — при
  // большем контрасте между «почти исчез» и «полностью появился» глаз
  // не фиксирует «скачка» и переход выглядит органичнее.
  const phaseOpacitySv = useSharedValue(1);
  const [displayedPhaseLabel, setDisplayedPhaseLabel] = useState(phaseLabel);
  useEffect(() => {
    if (displayedPhaseLabel === phaseLabel) return;
    phaseOpacitySv.value = withTiming(0.15, {
      duration: 260,
      easing: Easing.inOut(Easing.quad),
    });
    const swapTimer = setTimeout(() => {
      setDisplayedPhaseLabel(phaseLabel);
      phaseOpacitySv.value = withTiming(1, {
        duration: 340,
        easing: Easing.inOut(Easing.quad),
      });
    }, 200);
    return () => clearTimeout(swapTimer);
  }, [phaseLabel, displayedPhaseLabel, phaseOpacitySv]);
  const phaseTextStyle = useAnimatedStyle(() => ({ opacity: phaseOpacitySv.value }));

  const centerInstruction = (
    <View style={styles.instructionBlock}>
      <Reanimated.View style={phaseTextStyle}>
        <AppText variant="numericLarge" tone="primary" style={styles.inhaleTitle}>
          {displayedPhaseLabel}
        </AppText>
      </Reanimated.View>
      <AppText variant="dialogBody" tone="muted" style={styles.secHint}>
        {str.beatsShortLabel(phaseBeats)}
      </AppText>
    </View>
  );

  const qcDebugSnapshot = useMemo(() => {
    const stableBpm = pulseBpmLast?.bpm ?? 0;
    const rawBpm = pulseBpmLast?.rawBpm ?? 0;
    const rrCount = pulseBpmLast?.rrCount ?? 0;
    const jitterMs = pulseBpmLast?.jitterMs ?? 0;
    const windowEnd = pipeline.getLastSourceTimestampMs();
    const windowStart =
      phase === "qualityCheck" && qcStartLogicalMsRef.current != null
        ? qcStartLogicalMsRef.current
        : Math.max(0, windowEnd - 5_000);
    const samples = qcPulseSamplesRef.current.filter(
      (sample) => sample.cameraTimestampMs >= windowStart && sample.cameraTimestampMs <= windowEnd,
    );
    const stableSamples = samples.filter(
      (sample) =>
        sample.signalQuality >= 0.54 &&
        sample.rrCount >= 4 &&
        (sample.looksCoherent || sample.lockState !== "searching") &&
        (sample.bpm > 0 || sample.rawBpm > 0),
    );
    const stableFractionPct =
      samples.length > 0 ? Math.round((stableSamples.length / samples.length) * 100) : 0;
    return {
      stableBpm,
      rawBpm,
      rrCount,
      jitterMs,
      stableFractionPct,
      looksCoherent: pulseBpmLast?.looksCoherent ?? false,
    };
  }, [phase, pipeline, pulseBpmLast, qcSecondsLeft, prepSecondsLeft]);

  /**
   * Активация пульсометра показывается сразу в warmup/qualityCheck, независимо от того,
   * «видим» мы палец или нет: иначе камера, чувствительная к случайному просвету, давала
   * ложные переключения ring ↔ searching-icon и дёрганый UI.
   */
  const sensorActivationActive =
    (phase === "warmup" || phase === "qualityCheck") && !useSimulatedPpg;

  void qcDebugSnapshot;

  /**
   * Камера/сенсор:
   *  - В `inactive` / `background` держим захват, даже если `useFocusEffect` уже
   *    дал blur (иначе при уходе в другое приложение гас фонарик).
   *  - В `active` при кратком `breathRouteVisible === false` (оверлей, порядок
   *    blur раньше `inactive`) всё равно держим захват, пока идёт warmup/QC/running —
   *    иначе мигание `<Camera isActive>` и ошибка «Не удалось включить лампу».
   * Фактическое включение камеры по-прежнему режет `breathResourcesActive` (фазы).
   */
  const breathSensorPhaseRunning =
    phase === "warmup" || phase === "qualityCheck" || phase === "running";
  const persistBreathCaptureDuringOsTransition =
    breathRouteVisible ||
    practiceAppState !== "active" ||
    breathSensorPhaseRunning;
  const breathResourcesActive =
    persistBreathCaptureDuringOsTransition &&
    (phase === "warmup" || phase === "qualityCheck" || phase === "running");
  const cameraActive = breathResourcesActive;

  useEffect(() => {
    logRuntimeEvent("breath:resources_active", {
      breathRouteVisible,
      practiceAppState,
      persistBreathCaptureDuringOsTransition,
      phase,
      cameraActive,
      isBreathTimingActive,
    }, "debug");
  }, [
    breathRouteVisible,
    practiceAppState,
    persistBreathCaptureDuringOsTransition,
    cameraActive,
    isBreathTimingActive,
    phase,
  ]);

  /**
   * Live-метрики в футере практики: ОСОЗНАННО минимальны. Во время практики мы
   * НЕ вычисляем coherence %, RMSSD, стресс, entry-time — это результатные метрики,
   * они появятся на экране результатов из полного анализа всех beats в `finalize()`.
   *
   * Единственная живая метрика, которую действительно полезно видеть в процессе —
   * `liveRsaBpm` (медиана размаха HR по последним дыхательным циклам): она уже
   * посчитана `CoherenceEngine.tickLive` дешёво, на окне одного цикла. И `pulseRateBpm`
   * — для ощущения контакта с собственным ритмом.
   *
   * Раньше здесь пересчитывались coherence %, smoothedSeries длины T каждую секунду,
   * плюс Hampel по всем 1500 beats для RMSSD/стресса — всё это суммарно давало O(T²)
   * нагрузку и к 10-й минуте тормозило мандалу и индикатор дыхания.
   */
  const [liveRsaBpm, setLiveRsaBpm] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "running") {
      setLiveRsaBpm(null);
      return;
    }
    if (!allowAdvancedMetrics) {
      setLiveRsaBpm(null);
      return;
    }
    const id = setInterval(() => {
      const live = pipeline.getCoherenceEngine().getLiveSnapshot();
      setLiveRsaBpm(live?.rsaMedianBpmRecent ?? null);
    }, 1000);
    return () => clearInterval(id);
  }, [allowAdvancedMetrics, phase, pipeline]);

  /**
   * Футер во время практики: показываем ТОЛЬКО живые метрики, которые реально
   * считаем в процессе — пульс (для ощущения ритма) и медиану RSA по последним
   * циклам. Coherence %, RMSSD, стресс, entry-time — результатные, уйдут на экран
   * результатов после `finalize()`.
   *
   * Зависимость от `elapsedMs` даёт обновление раз в `UI_TICK_MS = 500 мс` — но
   * это не дорого, потому что в этой memo НЕТ тяжёлых вычислений, только formatting.
   */
  const practiceFooter = useMemo(() => {
    if (phase !== "running") return null;
    // Live optical/BLE/RSA diagnostics are QA-only (HARMONIZER_TEST_MODE).
    if (!HARMONIZER_TEST_MODE) return null;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    // Wearable sessions must not inherit the Android "no finger PPG plugin" simulated
    // optical note — that flag is about the camera path only.
    if (isWearableMode) {
      const liveBpm = Math.round(wearableRuntime.lastHeartRateBpm ?? snapshot.pulseRateBpm ?? 0);
      return (
        <View style={styles.opticalFooter}>
          <Text style={styles.opticalCaption}>{selectedWearableDevice?.name ?? str.wearableActivationTitle}</Text>
          <Text style={styles.opticalMeta}>
            {str.calibrationPulse}: {liveBpm} уд/мин
          </Text>
          <Text style={styles.opticalMetrics}>
            {wearableCapabilityTier === "guidedOnly" ? str.wearableRunningGuidedOnly : str.wearableReadyFullMetrics}
          </Text>
          <Text style={styles.opticalMetricsMuted}>
            время практики: {elapsedSec} с из {Math.round(practiceTotalMs / 1000)} с
          </Text>
        </View>
      );
    }
    if (useSimulatedPpg) {
      return (
        <View style={styles.opticalFooter}>
          <Text style={styles.opticalCaption}>{str.opticalSimulatedNote}</Text>
        </View>
      );
    }
    return (
      <View style={styles.opticalFooter}>
        <Text style={styles.opticalCaption}>{str.opticalSeriesCaption}</Text>
        <Text style={styles.opticalMeta}>
          {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач. {(snapshot.signalQuality * 100).toFixed(0)}%
          {" · "}
          {snapshot.fingerDetected ? "палец" : "нет пальца"} · {snapshot.pulseLockState}
        </Text>
        <Text style={styles.opticalMetrics}>
          {cameraGuidanceOnlyMode
            ? str.cameraRunningGuidanceOnly
            : `RSA: ${liveRsaBpm != null ? `${Math.round(liveRsaBpm)} уд/мин` : "—"}`}
        </Text>
        <Text style={styles.opticalMetricsMuted}>
          время практики: {elapsedSec} с из {Math.round(practiceTotalMs / 1000)} с
        </Text>
      </View>
    );
  }, [
    cameraGuidanceOnlyMode,
    phase,
    snapshot.pulseRateBpm,
    snapshot.signalQuality,
    snapshot.fingerDetected,
    snapshot.pulseLockState,
    isWearableMode,
    liveRsaBpm,
    elapsedMs,
    practiceTotalMs,
    selectedWearableDevice?.name,
    str,
    wearableCapabilityTier,
    wearableRuntime.lastHeartRateBpm,
    // HARMONIZER_TEST_MODE is a build-time constant; listed for clarity.
    HARMONIZER_TEST_MODE,
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      {isPracticePhase ? <PracticeKeepAwake tag={keepAwakeTag} /> : null}
      {!isWearableMode && !isExpoGo && !useSimulatedPpg && !disableOpticalHardware ? (
        <FingerPpgCameraSource
          key={`finger-${sourceKey}`}
          isActive={cameraActive}
          silent={cameraSilent}
          onFrameStats={handleFrameStats}
          captureRateHint={phase === "warmup" || phase === "qualityCheck" ? "highPrecision" : "normal"}
        />
      ) : null}
      {!isWearableMode && useSimulatedPpg ? (
        <SimulatedSensorSource key={`sim-${sourceKey}`} isActive={cameraActive} />
      ) : null}
      {isWearableMode ? (
        <BleHeartRateSource
          key={`ble-${sourceKey}-${selectedWearableDevice?.id ?? "none"}`}
          isActive={cameraActive}
          deviceId={selectedWearableDevice?.id}
          deviceName={selectedWearableDevice?.name}
          initialCapabilityTier={wearableCapabilityTier}
          // Android: reconnect only after a successful ready link (see BleHeartRateSource).
          autoReconnect={autoReconnect}
          suppressBeatEvents={useEmulatedPulseMode}
          onRuntimeSnapshot={handleWearableRuntimeSnapshot}
          onCapabilityResolved={handleWearableCapabilityResolved}
        />
      ) : null}
      {useEmulatedPulseMode && !useSimulatedPpg ? (
        <EmulatedPulseSensorSource
          key={`emu-${sourceKey}`}
          isActive={cameraActive && (isWearableMode || !cameraRecoveryProbeActive)}
          seedBpm={emulatedPulseSeedBpm}
        />
      ) : null}

      {phase === "idle" ? (
        <View style={styles.idle}>
          <AppText variant="screenTitle" tone="primary" style={styles.idleTitle}>
            {str.practiceName[practiceId]}
          </AppText>
          <AppText variant="statPillLabel" tone="muted" style={styles.idleSubtitle}>
            {str.practiceSanskritName[practiceId]}
          </AppText>
          <AppText variant="screenHint" tone="primary" style={styles.idleHint}>
            {isWearableMode ? str.wearableIdleHint : str.fingerHint}
          </AppText>
          {useSimulatedPpg ? (
            <AppText variant="bannerMessage" tone="muted" style={styles.simNote}>
              {str.simulatedMetricsNote}
            </AppText>
          ) : null}
          <View style={styles.practicePicker}>
            <AppText variant="statPillLabel" tone="muted" style={styles.pickerLabel}>
              {str.practicePickerTitle}
            </AppText>
            <View style={styles.pickerChipsRow}>
              {BREATH_PRACTICES.map((p) => {
                const selected = p.id === practiceId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPracticeId(p.id)}
                    style={[
                      styles.pickerChip,
                      {
                        borderColor: theme.colors.surfaceBorder,
                        backgroundColor: selected
                          ? theme.colors.accent
                          : theme.colors.controlButtonBg,
                      },
                    ]}
                  >
                    <AppText
                      variant="statPillLabel"
                      tone={selected ? "accentOn" : "primary"}
                      style={styles.pickerChipText}
                      numberOfLines={1}
                    >
                      {str.practiceName[p.id]}
                    </AppText>
                    <AppText
                      variant="technicalCaption"
                      tone={selected ? "accentOn" : "muted"}
                      numberOfLines={1}
                    >
                      {str.practiceSanskritName[p.id]}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <AppButton
            variant="primary"
            label={isWearableMode ? str.wearableIdleStartButton : str.startButton}
            onPress={() => beginFromIdle(false)}
            style={styles.idleStartBtn}
          />
          {!useSimulatedPpg ? (
            <AppButton
              variant="secondary"
              label={str.startWithoutSensorButton}
              onPress={() => beginFromIdle(true)}
              style={styles.idleStartBtn}
            />
          ) : null}
        </View>
      ) : null}

      {phase === "idle" && showAutoAbortDialog ? (
        <AppDialog
          visible
          title={str.autoAbortTitle}
          message={str.autoAbortMessage}
          actions={
            <>
              <AppButton
                variant="secondary"
                label={str.autoAbortExit}
                onPress={() => {
                  setShowAutoAbortDialog(false);
                  try {
                    router.replace("/");
                  } catch {
                    /* ignore */
                  }
                }}
                style={styles.dialogAction}
              />
              <AppButton
                variant="primary"
                label={str.autoAbortStartAgain}
                onPress={() => {
                  setShowAutoAbortDialog(false);
                  beginFromIdle(false);
                }}
                style={styles.dialogAction}
              />
            </>
          }
        />
      ) : null}

      {/*
        BLE prep chrome: spinner + cancel on both platforms so a missing strap
        never traps the user on a bare black screen (iOS used to hide this UI).
      */}
      {sensorUiMounted &&
      (phase === "warmup" ||
        phase === "qualityCheck" ||
        (!isWearableMode && phase === "running")) ? (
        <View
          style={[styles.calib, isWearableMode ? styles.blePrepOverlay : null]}
          pointerEvents={phase === "running" ? "none" : "auto"}
        >
          <>
          {isWearableMode ? (
            <View style={styles.blePrepMinimal}>
              <View style={styles.blePrepWheelWrap}>
                <ActivityIndicator color={theme.colors.accent} size="large" />
                <AppText variant="dialogBody" tone="primary" style={styles.sensorStatus}>
                  {selectedWearableDevice?.name
                    ? str.wearableConnectingWithName(selectedWearableDevice.name)
                    : str.wearableConnecting}
                </AppText>
                {Platform.OS === "android" &&
                (wearableRuntime.state === "connecting" ||
                  wearableRuntime.state === "reconnecting" ||
                  wearableRuntime.state === "waitingForBluetooth") ? (
                  <AppText variant="technicalCaption" tone="muted" style={styles.blePrepAndroidHint}>
                    {str.wearableAndroidSystemConnectHint}
                  </AppText>
                ) : null}
              </View>
              <AppButton
                variant="secondary"
                label={str.cancelButton}
                onPress={() => {
                  void updateWearablePreferences({ preferredSensorMode: "none" });
                  returnToPracticeOrigin();
                }}
                style={styles.sensorBackBtn}
              />
            </View>
          ) : (
            <>
          <AppText variant="screenTitle" tone="primary" style={styles.sensorTitle}>
            {str.sensorActivationTitle}
          </AppText>
          <AppText variant="screenHint" tone="primary" style={styles.sensorHint}>
            {str.sensorActivationHint}
          </AppText>
          <View style={styles.sensorTimerWrap}>
            {protocolStartedAtMs.current != null ? (
              <CountdownRing
                startedAtMs={protocolStartedAtMs.current}
                totalSeconds={Math.round(COHERENCE_PREP_TOTAL_MS / 1000)}
                size={104}
                strokeWidth={4}
              />
            ) : null}
          </View>
          <AppText variant="technicalCaption" tone="muted" style={styles.sensorStatus}>
            {str.sensorActivationStableWait}
          </AppText>
          <View style={styles.sensorChartWrap}>
            {!useSimulatedPpg ? (
              <PpgMiniChart
                samples={opticalPreviewSamples}
                beatTimestampsMs={snapshot.mergedBeats}
              />
            ) : null}
          </View>
          <AppButton
            variant="secondary"
            label={str.cancelButton}
            onPress={returnToPracticeOrigin}
            style={styles.sensorBackBtn}
          />
          {DEBUG_ACTIVATION_EXPORT_ENABLED && !useSimulatedPpg ? (
            <Pressable
              onPress={() => void exportActivationDiagnostic("manual")}
              style={styles.diagnosticBtn}
              accessibilityLabel="Export activation diagnostic"
            >
              <AppText variant="technicalCaption" tone="muted">
                Диагностика активации (для разработчика)
              </AppText>
            </Pressable>
          ) : null}
            </>
          )}
          </>
        </View>
      ) : null}

      <AppDialog
        visible={showQcFailedDialog}
        title={isWearableMode ? str.wearableQcFailedTitle : str.qcFailedDialogTitle}
        message={isWearableMode ? str.wearableQcFailedMessage : str.qcFailedDialogMessage}
        actionsLayout="column"
        actions={
          <>
            <AppButton
              variant="primary"
              label={isWearableMode ? str.wearableRetryScan : str.qcFailedRetry}
              onPress={() => {
                setShowQcFailedDialog(false);
                qcStartLogicalMsRef.current = null;
                qcOutcomeRef.current = null;
                qcPulseSamplesRef.current = [];
                opticalPreviewBufferRef.current = [];
                setOpticalPreviewSamples([]);
                warmupStartedAtMs.current = Date.now();
                protocolStartedAtMs.current = Date.now();
                if (isWearableMode) {
                  setWearableRuntime({ state: "idle" });
                  setSourceKey((value) => value + 1);
                }
                // TAG_REMOVE_PERF_DIAGNOSTICS — повторная попытка в рамках
                // той же сессии: sessionId сохраняем, attemptNumber += 1.
                activationAttemptNumberRef.current += 1;
                setPhase("warmup");
              }}
            />
            <AppButton
              variant="secondary"
              label={str.qcFailedContinueWithoutSensor}
              onPress={() => {
                setShowQcFailedDialog(false);
                qcOutcomeRef.current = "user_chose_no_sensor";
                beginFromIdle(true);
              }}
            />
            {isWearableMode ? (
              <AppButton
                variant="secondary"
                label={str.cancelButton}
                onPress={() => {
                  setShowQcFailedDialog(false);
                  void updateWearablePreferences({ preferredSensorMode: "none" });
                  returnToPracticeOrigin();
                }}
              />
            ) : null}
            {/*
             * TAG_REMOVE_PERF_DIAGNOSTICS
             *
             * Ссылка отправки отладочного JSON разработчику. Появляется
             * ТОЛЬКО при `DEBUG_ACTIVATION_EXPORT_ENABLED=true` — перед
             * публичным релизом этот блок удаляется целиком, и диалог
             * возвращается к исходному виду (две кнопки: Попробовать /
             * Продолжить без пульсометра). Стиль совпадает с
             * `diagnosticBtn` на экране активации, чтобы не ломать
             * визуальную гармонию дизайна диалога.
             */}
            {DEBUG_ACTIVATION_EXPORT_ENABLED && !useSimulatedPpg && !isWearableMode ? (
              <Pressable
                onPress={() =>
                  void exportActivationDiagnosticRef.current?.("qc_failed_manual_share")
                }
                style={styles.diagnosticBtn}
                accessibilityLabel="Send debug report"
              >
                <AppText variant="technicalCaption" tone="muted">
                  {str.qcFailedSendReport}
                </AppText>
              </Pressable>
            ) : null}
          </>
        }
      />

      <WearablePickerDialog
        visible={showWearablePickerDialog}
        onClose={() => setShowWearablePickerDialog(false)}
        onSelect={handleWearableSelected}
        onDisconnect={handleWearableDisconnected}
        selectedDeviceId={selectedWearableDevice?.id ?? wearablePreferences.lastDeviceId}
        alertMessage={phase === "running" ? str.wearablePickerFaultyMessage : null}
        strings={{
          title: str.wearablePickerTitle,
          searchHint: str.wearablePickerSearchHint,
          foundHint: str.wearablePickerFoundHint,
          notFoundHint: str.wearablePickerNotFoundHint,
          notFoundTips: str.wearablePickerNotFoundTips,
          bluetoothOffHint: str.wearableBluetoothOff,
          retryButton: str.wearableRetryScan,
          closeButton: str.wearablePickerCloseButton,
          selectButton: str.wearablePickerSelectButton,
          connectedLabel: str.wearablePickerConnectedLabel,
          disconnectButton: str.wearablePickerDisconnectButton,
          signalLabel: str.wearableRssiLabel,
          bluetoothStateLabel: str.wearableBluetoothLabel,
        }}
      />

      {phase === "running" && runningUiRevealed ? (
        <View style={styles.runningAbs}>
          <MandalaSoundProvider
            practiceKind="breath"
            durationMs={practiceTotalMs}
            chakra={chakra ?? 4}
            soundBed={soundBed}
            isActive={
              persistBreathCaptureDuringOsTransition &&
              phase === "running" &&
              isBreathTimingActive
            }
            plannedCycle={currentPlan}
            cycleStartMs={cycleStartMs}
            biofeedbackEnabled
          >
            {overlayVisible ? (
              <FloatingCloseButton
                accessibilityLabel={str.stopConfirmTitle}
                onPress={handleRequestStop}
                style={styles.topCloseButton}
              />
            ) : null}
            <BreathPracticeShell
              isBreathTimingActive={isBreathTimingActive}
              plannedCycle={currentPlan}
              cycleStartMs={cycleStartMs}
              onPhaseChange={handlePhaseChange}
              dimOpacity={dimOpacity}
              footer={<SyncedPracticeFooter baseFooter={practiceFooter} />}
              indicatorKind={practice.indicatorKind}
              onScreenTap={handleScreenTap}
              overlay={
                <>
                  <AffirmationBreathOverlay
                    ref={affirmationGateRef}
                    phaseKind={activePhase?.kind ?? null}
                    elapsedMs={elapsedMs}
                    practiceTotalMs={practiceTotalMs}
                    cycleMs={currentPlan?.cycleMs ?? 12_000}
                    active={phase === "running" && isBreathTimingActive}
                  />
                  <BreathOverlayControlPanel
                  visible={overlayVisible}
                  title={str.practiceName[practiceId]}
                  subtitle={str.practiceSanskritName[practiceId]}
                  totalMs={practiceTotalMs}
                  elapsedMs={elapsedMs}
                  minutesShortLabel={str.practiceMinutesShort}
                  beatsDisplay={
                    isTriangleTempo
                      ? {
                          type: "triple",
                          values: tripleTempoBeats,
                          highlightIndex: null,
                        }
                      : {
                          type: "single",
                          value: singleTempoBeats,
                          isHighlighted: isDefaultTempoKey(practice.id, tempoKey),
                        }
                  }
                  onIncrement={
                    isTriangleTempo
                      ? canStepTriangleTempo(
                          practice.id as "triangle-up" | "triangle-down",
                          tempoKey,
                          1,
                        )
                        ? handleIncrementBeats
                        : undefined
                      : singleTempoBeats < LINEAR_OVERLAY_MAX_BEATS
                        ? handleIncrementBeats
                        : undefined
                  }
                  onDecrement={
                    isTriangleTempo
                      ? canStepTriangleTempo(
                          practice.id as "triangle-up" | "triangle-down",
                          tempoKey,
                          -1,
                        )
                        ? handleDecrementBeats
                        : undefined
                      : singleTempoBeats > LINEAR_OVERLAY_MIN_BEATS
                        ? handleDecrementBeats
                        : undefined
                  }
                  onRequestClose={handleRequestStop}
                  onInteraction={handleOverlayInteraction}
                  accessibilityLabel={`${str.baseBeatsAccessibilityLabel}: ${formatTempoLabel(tempoKey)}`}
                />
                </>
              }
              center={
                <View style={styles.centerStack}>
                  <RNAnimated.View style={[styles.mandalaWrap, { opacity: mandalaOpacity }]}>
                    <SyncedBreathBinduMandala
                      chakraPresetIndex={mandalaChakraIndex}
                      onRenderCommitted={handleMandalaRender}
                    />
                  </RNAnimated.View>
                  <RNAnimated.View
                    style={[styles.instructionWrap, { opacity: instructionOpacity }]}
                    pointerEvents="none"
                  >
                    {centerInstruction}
                  </RNAnimated.View>
                </View>
              }
            />
          </MandalaSoundProvider>
        </View>
      ) : null}

      {/* Чёрная штора поверх всего — включается на переходе sensor → practice. */}
      <Reanimated.View
        pointerEvents="none"
        style={[styles.blackCurtain, blackCurtainStyle]}
      />

      {phase === "running" && !useEmulatedPulseMode && !useSimulatedPpg && ppgOverlayMessage ? (
        <View style={styles.ppgBannerBottomWrap} pointerEvents="none">
          <AppText
            variant="technicalCaption"
            tone="primary"
            style={styles.ppgBannerText}
          >
            {ppgOverlayMessage}
          </AppText>
        </View>
      ) : null}

      {phase === "running" ? (
        <PracticeStopConfirmDialog
          visible={showStopConfirm}
          title={str.stopConfirmTitle}
          message={str.stopConfirmMessage}
          continueLabel={str.stopConfirmNo}
          finishLabel={str.stopConfirmYes}
          onContinue={() => {
            setShowStopConfirm(false);
            setOverlayVisible(true);
            scheduleOverlayHide();
          }}
          onFinish={() => {
            applyHardPracticeExit();
            setShowAutoAbortDialog(false);
            returnToPracticeOrigin();
          }}
        />
      ) : null}

      {phase === "results" ? (
        <ResultsView
          str={str}
          analysis={analysis}
          exportDebug={exportDebug}
          resultsGraphs={resultsGraphs}
          finalRmssdMs={finalRmssdMs}
          finalStressPercent={finalStressPercent}
          finalPulseWasEmulated={finalPulseWasEmulated}
          sessionWithoutSensor={
            disableOpticalHardware || exportDebug?.qcOutcome === "user_chose_no_sensor"
          }
          finalSignalTrust={finalSignalTrust}
          cameraGuidanceOnlyMode={cameraGuidanceOnlyMode}
          finalHrvRecoveredFromTail={finalHrvRecoveredFromTail}
          finalCoherenceRecoveredFromTail={finalCoherenceRecoveredFromTail}
          finalCoherenceTailWindowMs={finalCoherenceTailWindowMs}
          finalStartAnalysis={finalStartAnalysis}
          finalEndAnalysis={finalEndAnalysis}
          finalStartHrv={finalStartHrv}
          finalEndHrv={finalEndHrv}
          finalStartAvgBpm={finalStartAvgBpm}
          finalEndAvgBpm={finalEndAvgBpm}
          finalStartWindowMs={finalStartWindowMs}
          finalEndWindowMs={finalEndWindowMs}
          useSimulatedPpg={useSimulatedPpg}
          practiceTotalMs={practiceTotalMs}
          sessionStartWallMs={sessionStartWallMs}
          practiceId={practiceId}
          chakra={chakra ?? 3}
          locale={locale}
          launchSource={launchSource}
          onExportJson={exportJson}
          onClose={() => {
            applyHardPracticeExit();
            returnToPracticeOrigin();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * Экран результатов: двухэтапный.
 *
 * `seriesInsights` считаются по тем же display-prepared точкам, что и header'ы графиков
 * (`prepareSeriesForDisplay` → `summarizeSeries`), чтобы числа, которые видит пользователь на
 * графиках (start → end), и числа, уходящие в LLM-интерпретацию, совпадали. Раньше здесь
 * использовался сырой `resultsGraphs` (с ведущими нулями у coherence и без decimation), из-за чего
 * `startMean` у coherence утягивался к 0, хотя на графике старт рисуется с первого реального
 * измерения.
 */
function buildInterpretationOutcomePayload(
  basePayload: Record<string, unknown>,
  preparedSeries: {
    measuredPulseBpm: readonly BreathResultsSeriesPoint[];
    coherencePercent: readonly BreathResultsSeriesPoint[];
    rmssdMs: readonly BreathResultsSeriesPoint[];
    stressPercent: readonly BreathResultsSeriesPoint[];
    rsaBpm: readonly BreathResultsSeriesPoint[];
  } | null,
): Record<string, unknown> {
  if (preparedSeries == null) return basePayload;
  // Передаём в LLM только метрики с положительной или нейтральной динамикой
  // (start → end). Метрики, ухудшившиеся за практику, исключаются — интерпретация
  // должна обнадёживать, а не фиксировать негатив. Пульс передаём всегда: это
  // базовый маркер, нужен для контекста, и его снижение = успокоение.
  const summaries = {
    pulseBpm: summarizeSeries(preparedSeries.measuredPulseBpm, "bpm"),
    coherencePercent: summarizeSeries(preparedSeries.coherencePercent, "percent"),
    rmssdMs: summarizeSeries(preparedSeries.rmssdMs, "ms"),
    stressPercent: summarizeSeries(preparedSeries.stressPercent, "percent"),
    rsaAmplitudeBpm: summarizeSeries(preparedSeries.rsaBpm, "bpm"),
  };
  const NOISE = 0.1; // защитный порог от дробового джиттера
  const isNeutralOrBetter = (
    s: BreathResultsSeriesSummary | null,
    direction: "higherBetter" | "lowerBetter",
  ): boolean => {
    if (s == null || s.startMean == null || s.endMean == null) return true;
    const delta = s.endMean - s.startMean;
    if (direction === "higherBetter") return delta >= -NOISE;
    return delta <= NOISE;
  };
  const seriesInsights: Record<string, BreathResultsSeriesSummary> = {};
  // pulse — всегда (базовый контекст)
  if (summaries.pulseBpm) seriesInsights.pulseBpm = summaries.pulseBpm;
  if (isNeutralOrBetter(summaries.coherencePercent, "higherBetter") && summaries.coherencePercent) {
    seriesInsights.coherencePercent = summaries.coherencePercent;
  }
  if (isNeutralOrBetter(summaries.rmssdMs, "higherBetter") && summaries.rmssdMs) {
    seriesInsights.rmssdMs = summaries.rmssdMs;
  }
  if (isNeutralOrBetter(summaries.stressPercent, "lowerBetter") && summaries.stressPercent) {
    seriesInsights.stressPercent = summaries.stressPercent;
  }
  if (isNeutralOrBetter(summaries.rsaAmplitudeBpm, "higherBetter") && summaries.rsaAmplitudeBpm) {
    seriesInsights.rsaAmplitudeBpm = summaries.rsaAmplitudeBpm;
  }
  return {
    ...basePayload,
    seriesInsights,
  };
}

function formatChartValue(value: number | null, unit: BreathResultsSeriesSummary["unit"]): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = unit === "percent" ? Math.round(value) : Math.round(value * 10) / 10;
  switch (unit) {
    case "bpm":
      return `${rounded} bpm`;
    case "ms":
      return `${rounded} ms`;
    case "percent":
      return `${Math.round(value)}%`;
  }
}

function ResultsMetricChart(props: {
  title: string;
  points: readonly BreathResultsSeriesPoint[];
  color: string;
  unit: BreathResultsSeriesSummary["unit"];
  fixedMin?: number;
  fixedMax?: number;
  /** Доля headroom-а сверху при auto-scale (когда `fixedMax` не задан): max × (1 + headroom). */
  autoMaxHeadroom?: number;
  highlightIntervals?: readonly NonLiveInterval[];
  domainStartMs?: number;
  domainEndMs?: number;
  continuousAcrossGaps?: boolean;
}) {
  const {
    title,
    points,
    color,
    unit,
    fixedMin,
    fixedMax,
    autoMaxHeadroom = 0,
    highlightIntervals = [],
    domainStartMs = 0,
    domainEndMs,
    continuousAcrossGaps = false,
  } = props;
  const chartPoints = useMemo(() => decimateSeries(points, 120), [points]);
  const lineSegments = useMemo(
    // Guidance is always defined (live → hold → emulated), so it draws as one continuous
    // line across the gray band; only a true zero breaks it. Measured/metric charts keep
    // breaking at time gaps so missing data reads honestly as a gap.
    () =>
      splitPulseChartSeriesSegments(
        chartPoints,
        continuousAcrossGaps ? { maxGapMs: Number.POSITIVE_INFINITY } : undefined,
      ),
    [chartPoints, continuousAcrossGaps],
  );
  const summary = useMemo(() => summarizeSeries(chartPoints, unit), [chartPoints, unit]);
  const geometry = useMemo(() => {
    if (chartPoints.length < 2) return null;
    const width = 260;
    const height = 96;
    const padX = 10;
    const padY = 8;
    const values = chartPoints
      .map((point) => point.value)
      .filter((value) => (unit === "bpm" ? value > 0.5 : Number.isFinite(value)));
    const scaleValues = values.length > 0 ? values : chartPoints.map((point) => point.value);
    let min = fixedMin ?? Math.min(...scaleValues);
    let max = fixedMax ?? Math.max(...scaleValues);
    if (autoMaxHeadroom > 0 && fixedMax == null && max > 0) {
      max = max * (1 + autoMaxHeadroom);
    }
    if (!(max > min)) {
      const center = max || min || 0;
      min = center - 1;
      max = center + 1;
    }
    const chartEndMs = domainEndMs ?? chartPoints[chartPoints.length - 1]!.tMs;
    const chartStartMs = domainStartMs;
    const durationMs = Math.max(1, chartEndMs - chartStartMs);
    const xForTime = (tMs: number) =>
      padX + ((tMs - chartStartMs) / durationMs) * (width - padX * 2);
    const yForValue = (value: number) =>
      padY + (1 - (value - min) / (max - min)) * (height - padY * 2);
    const segmentsAttr = lineSegments.map((segment) =>
      segment
        .map((point) => `${xForTime(point.tMs).toFixed(1)},${yForValue(point.value).toFixed(1)}`)
        .join(" "),
    );
    const highlights = highlightIntervals
      .filter((gap) => gap.endMs > chartStartMs && gap.startMs < chartEndMs)
      .map((gap) => ({
        x1: xForTime(Math.max(gap.startMs, chartStartMs)),
        x2: xForTime(Math.min(gap.endMs, chartEndMs)),
      }));
    return {
      width,
      height,
      min,
      max,
      durationMs: chartEndMs,
      segmentsAttr,
      highlights,
      midY: height / 2,
      topY: padY,
      bottomY: height - padY,
    };
  }, [chartPoints, domainEndMs, domainStartMs, fixedMax, fixedMin, autoMaxHeadroom, highlightIntervals, lineSegments, unit]);
  if (geometry == null || summary == null) return null;
  return (
    <View style={styles.resultChartCard}>
      <View style={styles.resultChartHeader}>
        <Text style={styles.resultChartTitle}>{title}</Text>
        <Text style={styles.resultChartSummary}>
          {formatChartValue(summary.startMean, unit)} → {formatChartValue(summary.endMean, unit)}
        </Text>
      </View>
      <View style={styles.resultChartRow}>
        <View style={styles.resultChartYAxis}>
          <Text style={styles.resultChartAxisLabel}>{formatChartValue(geometry.max, unit)}</Text>
          <Text style={styles.resultChartAxisLabel}>{formatChartValue(geometry.min, unit)}</Text>
        </View>
        <View style={styles.resultChartPlot}>
          <Svg width={geometry.width} height={geometry.height} viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
            <Line x1="0" y1={geometry.topY} x2={geometry.width} y2={geometry.topY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            <Line x1="0" y1={geometry.midY} x2={geometry.width} y2={geometry.midY} stroke="rgba(255,255,255,0.09)" strokeWidth="1" />
            <Line x1="0" y1={geometry.bottomY} x2={geometry.width} y2={geometry.bottomY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
            {geometry.highlights.map((gap, index) => (
              <Rect
                key={`gap-${index}`}
                x={gap.x1}
                y={geometry.topY}
                width={Math.max(1, gap.x2 - gap.x1)}
                height={geometry.bottomY - geometry.topY}
                fill="rgba(255,255,255,0.08)"
              />
            ))}
            {geometry.highlights.map((gap, index) => (
              <Line
                key={`gap-edge-${index}`}
                x1={gap.x1}
                y1={geometry.topY}
                x2={gap.x1}
                y2={geometry.bottomY}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
              />
            ))}
            {geometry.highlights.map((gap, index) => (
              <Line
                key={`gap-edge-end-${index}`}
                x1={gap.x2}
                y1={geometry.topY}
                x2={gap.x2}
                y2={geometry.bottomY}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="1"
              />
            ))}
            {geometry.segmentsAttr.map((pointsAttr, index) => (
              <Polyline
                key={`segment-${index}`}
                points={pointsAttr}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </Svg>
          <View style={styles.resultChartXAxis}>
            <Text style={styles.resultChartAxisLabel}>0:00</Text>
            <Text style={styles.resultChartAxisLabel}>{formatMinutesSeconds(geometry.durationMs)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

type ResultsDetailsViewMode =
  | "metrics"
  | "loadingInterpretation"
  | "interpretation"
  | "interpretationError";

function ResultsView(props: {
  str: ReturnType<typeof getCoherenceBreathStrings>;
  analysis: CoherenceSessionResult | null;
  exportDebug: CoherenceExportDebug | null;
  resultsGraphs: BreathResultsGraphsSnapshot | null;
  finalRmssdMs: number | null;
  finalStressPercent: number | null;
  finalPulseWasEmulated: boolean;
  sessionWithoutSensor: boolean;
  finalSignalTrust: BiofeedbackSignalTrustSummary | null;
  cameraGuidanceOnlyMode: boolean;
  finalHrvRecoveredFromTail: boolean;
  finalCoherenceRecoveredFromTail: boolean;
  finalCoherenceTailWindowMs: number | null;
  finalStartAnalysis: CoherenceSessionResult | null;
  finalEndAnalysis: CoherenceSessionResult | null;
  finalStartHrv: PracticeHrvMetricsResult | null;
  finalEndHrv: PracticeHrvMetricsResult | null;
  finalStartAvgBpm: number | null;
  finalEndAvgBpm: number | null;
  finalStartWindowMs: number | null;
  finalEndWindowMs: number | null;
  useSimulatedPpg: boolean;
  practiceTotalMs: number;
  sessionStartWallMs: number | null;
  practiceId: BreathPracticeId;
  chakra: number;
  locale: BreathLocale;
  launchSource?: string;
  onExportJson: () => void;
  onClose: () => void;
}) {
  const {
    str,
    analysis,
    exportDebug,
    resultsGraphs,
    finalRmssdMs,
    finalStressPercent,
    finalPulseWasEmulated,
    sessionWithoutSensor,
    finalSignalTrust,
    cameraGuidanceOnlyMode,
    finalHrvRecoveredFromTail,
    finalCoherenceRecoveredFromTail,
    finalCoherenceTailWindowMs,
    finalStartAnalysis,
    finalEndAnalysis,
    finalStartHrv,
    finalEndHrv,
    finalStartAvgBpm,
    finalEndAvgBpm,
    finalStartWindowMs,
    finalEndWindowMs,
    useSimulatedPpg,
    practiceTotalMs,
    sessionStartWallMs,
    practiceId,
    chakra,
    locale,
    launchSource,
    onExportJson,
    onClose,
  } = props;

  const { authUser } = useAuth();
  const [detailsViewMode, setDetailsViewMode] = useState<ResultsDetailsViewMode>("metrics");
  const [interpretationText, setInterpretationText] = useState<string | null>(null);
  const savedSessionRef = useRef(false);
  const interpretationAbortRef = useRef<AbortController | null>(null);
  const trustLevel = finalSignalTrust?.level ?? "full_biometrics";
  const showCoherenceResults =
    !cameraGuidanceOnlyMode &&
    !finalPulseWasEmulated &&
    (trustLevel === "full_biometrics" || finalCoherenceRecoveredFromTail) &&
    !analysis?.metricsWithheldDueToInsufficientData;
  const showHrvResults =
    !cameraGuidanceOnlyMode &&
    !finalPulseWasEmulated && (trustLevel !== "pulse_only" || finalHrvRecoveredFromTail);
  const measuredPulseGraphPoints = useMemo(
    () => resultsGraphs?.measuredPulseBpm ?? [],
    [resultsGraphs?.measuredPulseBpm],
  );
  const guidancePulseGraphPoints = useMemo(
    () => resultsGraphs?.guidancePulseBpm ?? [],
    [resultsGraphs?.guidancePulseBpm],
  );
  const measuredPulseHighlights = useMemo(
    () => resultsGraphs?.measuredPulseHighlights ?? [],
    [resultsGraphs?.measuredPulseHighlights],
  );
  const guidancePulseHighlights = useMemo(
    () => resultsGraphs?.guidancePulseHighlights ?? [],
    [resultsGraphs?.guidancePulseHighlights],
  );
  const rrIntervalGraphPoints = useMemo(
    () => resultsGraphs?.rrIntervalMs ?? [],
    [resultsGraphs?.rrIntervalMs],
  );
  // Phone camera: only the measured-pulse chart (guidance is a derived pacing
  // series and looked like a confusing second “pulse” graph). BLE/wearable can
  // still show both when they diverge or when the debug flag is on.
  const showSeparateGuidancePulseGraph =
    !cameraGuidanceOnlyMode &&
    (SHOW_BOTH_PULSE_RESULT_GRAPHS ||
      seriesDifferMeaningfully(measuredPulseGraphPoints, guidancePulseGraphPoints));
  const coherenceGraphPoints = useMemo(
    () => (
      !cameraGuidanceOnlyMode
        ? prepareSeriesForDisplay(resultsGraphs?.coherencePercent ?? [], practiceTotalMs, {
            trimZeroEdges: true,
            extendStart: false,
            extendEnd: false,
          })
        : []
    ),
    [cameraGuidanceOnlyMode, practiceTotalMs, resultsGraphs?.coherencePercent],
  );
  const rmssdGraphPoints = useMemo(
    () => (
      !cameraGuidanceOnlyMode
        ? prepareSeriesForDisplay(resultsGraphs?.rmssdMs ?? [], practiceTotalMs, {
            extendStart: false,
            extendEnd: false,
          })
        : []
    ),
    [cameraGuidanceOnlyMode, practiceTotalMs, resultsGraphs?.rmssdMs],
  );
  const stressGraphPoints = useMemo(
    () => (
      !cameraGuidanceOnlyMode
        ? prepareSeriesForDisplay(resultsGraphs?.stressPercent ?? [], practiceTotalMs, {
            extendStart: false,
            extendEnd: false,
          })
        : []
    ),
    [cameraGuidanceOnlyMode, practiceTotalMs, resultsGraphs?.stressPercent],
  );
  const rsaGraphPoints = useMemo(
    () => (
      !cameraGuidanceOnlyMode
        ? prepareSeriesForDisplay(resultsGraphs?.rsaBpm ?? [], practiceTotalMs, {
            extendStart: false,
            extendEnd: false,
          })
        : []
    ),
    [cameraGuidanceOnlyMode, practiceTotalMs, resultsGraphs?.rsaBpm],
  );
  const canRequestInterpretation =
    !sessionWithoutSensor &&
    !cameraGuidanceOnlyMode &&
    (
      [
        analysis?.coherenceAveragePercent,
        analysis?.rsaAmplitudeBpm,
        finalRmssdMs,
        finalStressPercent,
      ].some((value) => value != null) ||
      coherenceGraphPoints.length >= 2 ||
      rmssdGraphPoints.length >= 2 ||
      rsaGraphPoints.length >= 2 ||
      stressGraphPoints.length >= 2
    );

  const buildOutcome = useCallback((): BreathPracticeOutcome => {
    const summary: BreathPracticeSummary = {
      durationMs: practiceTotalMs,
      pulseEmulated: finalPulseWasEmulated || useSimulatedPpg,
      avgPulseBpm:
        finalStartAvgBpm != null && finalEndAvgBpm != null
          ? Math.round((finalStartAvgBpm + finalEndAvgBpm) / 2)
          : (finalStartAvgBpm ?? finalEndAvgBpm ?? null),
      coherenceAveragePercent: showCoherenceResults ? (analysis?.coherenceAveragePercent ?? null) : null,
      coherenceMaxPercent: showCoherenceResults ? (analysis?.coherenceMaxPercent ?? null) : null,
      rsaAmplitudeBpm: showCoherenceResults ? (analysis?.rsaAmplitudeBpm ?? null) : null,
      rsaNormalizedPercent: showCoherenceResults ? (analysis?.rsaNormalizedPercent ?? null) : null,
      rmssdMs: showHrvResults ? finalRmssdMs : null,
      stressPercent: showHrvResults ? finalStressPercent : null,
      entryTimeSec: showCoherenceResults ? (analysis?.entryTimeSec ?? null) : null,
    };
    const hybrid: BreathHybridBreakdown | null =
      finalStartAnalysis != null && finalEndAnalysis != null
        ? {
            start: {
              windowMs: finalStartWindowMs ?? 0,
              avgBpm: finalStartAvgBpm,
              coherence: finalStartAnalysis,
              hrv: finalStartHrv,
            },
            end: {
              windowMs: finalEndWindowMs ?? 0,
              avgBpm: finalEndAvgBpm,
              coherence: finalEndAnalysis,
              hrv: finalEndHrv,
            },
          }
        : null;
    const outcome: BreathPracticeOutcome = {
      input: { practiceId, durationMs: practiceTotalMs, chakra: (chakra as 1|2|3|4|5|6|7), locale },
      summary,
      hybrid,
      diagnostics: null,
    };
    return outcome;
  }, [
    analysis,
    chakra,
    finalEndAnalysis,
    finalEndAvgBpm,
    finalEndHrv,
    finalEndWindowMs,
    finalPulseWasEmulated,
    finalSignalTrust,
    finalRmssdMs,
    finalStartAnalysis,
    finalStartAvgBpm,
    finalStartHrv,
    finalStartWindowMs,
    finalStressPercent,
    locale,
    practiceId,
    practiceTotalMs,
    showCoherenceResults,
    showHrvResults,
    useSimulatedPpg,
  ]);

  // Session recording happens once on results mount (no mood-picker screen anymore).
  useEffect(() => {
    if (!authUser?.id || savedSessionRef.current) return;
    savedSessionRef.current = true;
    const fallbackStartedAt = Date.now() - practiceTotalMs;
    const startedAtMs = sessionStartWallMs ?? fallbackStartedAt;
    const outcome = buildOutcome();
    void recordPracticeSession({
      userId: authUser.id,
      practiceSlug: practiceId,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(startedAtMs + practiceTotalMs).toISOString(),
      selfRating: null,
      completionPct: 100,
      metrics: outcomeToCommunicatorPayload(outcome) as Json,
      chakraFocusIds: [chakra],
      context: {
        source: "breath",
        launch_source: launchSource ?? "practice_screen",
        practice_kind: "breath",
        duration_ms: practiceTotalMs,
      },
    });
  }, [authUser?.id, buildOutcome, chakra, launchSource, practiceId, practiceTotalMs, sessionStartWallMs]);

  const requestInterpretation = useCallback(async () => {
    interpretationAbortRef.current?.abort();
    const controller = new AbortController();
    interpretationAbortRef.current = controller;
    setDetailsViewMode("loadingInterpretation");
    setInterpretationText(null);

    const outcome = buildOutcome();
    const payload = buildInterpretationOutcomePayload(
      outcomeToCommunicatorPayload(outcome),
      {
        measuredPulseBpm: measuredPulseGraphPoints,
        coherencePercent: coherenceGraphPoints,
        rmssdMs: rmssdGraphPoints,
        stressPercent: stressGraphPoints,
        rsaBpm: rsaGraphPoints,
      },
    );
    try {
      const response = await fetchBreathPracticeInterpretation(
        {
          outcome: payload,
          responseLocale: locale,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const text = response.text?.trim() ?? "";
      if (!text) {
        throw new Error("empty_interpretation");
      }
      setInterpretationText(text);
      setDetailsViewMode("interpretation");
    } catch (error) {
      if (controller.signal.aborted && interpretationAbortRef.current !== controller) {
        return;
      }
      logRuntimeEvent(
        "breath:practice_interpretation_failed",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setInterpretationText(null);
      setDetailsViewMode("interpretationError");
    } finally {
      if (interpretationAbortRef.current === controller) {
        interpretationAbortRef.current = null;
      }
    }
  }, [
    buildOutcome,
    locale,
    resultsGraphs,
  ]);

  useEffect(() => {
    return () => {
      interpretationAbortRef.current?.abort();
      interpretationAbortRef.current = null;
    };
  }, []);

  const showingInterpretation = detailsViewMode !== "metrics";

  if (sessionWithoutSensor) {
    return (
      <View style={styles.results}>
        <Text style={styles.resultsTitle}>{str.noSensorGreatPracticeTitle}</Text>
        <ScrollView
          style={styles.resultsScroll}
          contentContainerStyle={styles.resultsScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.interpretationBody}>{str.noSensorResultsRecommendation}</Text>
        </ScrollView>
        <View style={[styles.resultsActionsRow, styles.resultsActionsRowCentered]}>
          <Pressable onPress={onClose} style={[styles.resultsCloseBtn, styles.resultsCloseBtnAlone]}>
            <Text style={styles.resultsCloseBtnText}>{str.resultsCloseButton}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const showInterpretAction = !showingInterpretation && canRequestInterpretation;
  const showInterpretRetry = detailsViewMode === "interpretationError";
  const closeAlone = !showInterpretAction && !showInterpretRetry;

  return (
    <View style={styles.results}>
      <Text style={styles.resultsTitle}>
        {showingInterpretation ? str.resultsDiscussButton : str.resultsMetricsHeader}
      </Text>
      <ScrollView
        style={styles.resultsScroll}
        contentContainerStyle={styles.resultsScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {showingInterpretation ? (
          <>
            {detailsViewMode === "loadingInterpretation" ? (
              <View style={styles.interpretationLoadingWrap}>
                <ActivityIndicator color={defaultTheme.colors.accent} size="small" />
              </View>
            ) : null}
            {detailsViewMode === "interpretationError" ? (
              <Text style={styles.warnBox}>{str.resultsInterpretationError}</Text>
            ) : null}
            {detailsViewMode === "interpretation" && interpretationText ? (
              <Text style={styles.interpretationBody}>{interpretationText}</Text>
            ) : null}
            {detailsViewMode === "interpretation" && !interpretationText ? (
              <Text style={styles.warnBox}>{str.resultsInterpretationError}</Text>
            ) : null}
          </>
        ) : (
          <>
            {analysis?.metricsApproximate ? (
              <Text style={styles.approx}>{str.approximateMetricsNote}</Text>
            ) : null}
            {useSimulatedPpg ? <Text style={styles.approx}>{str.simulatedMetricsNote}</Text> : null}
            {cameraGuidanceOnlyMode ? (
              <Text style={styles.interpretationBody}>{str.cameraGuidanceOnlyResultsNote}</Text>
            ) : null}
            {finalPulseWasEmulated && !useSimulatedPpg ? (
              <Text style={styles.warnBox}>{str.emulatedPulseResultsNote}</Text>
            ) : null}
            {!finalPulseWasEmulated && trustLevel === "guided_limited" ? (
              <Text style={styles.warnBox}>{str.guidedLimitedResultsNote}</Text>
            ) : null}
            {!finalPulseWasEmulated && trustLevel === "pulse_only" ? (
              <Text style={styles.warnBox}>{str.pulseOnlyResultsNote}</Text>
            ) : null}
            {finalHrvRecoveredFromTail ? (
              <Text style={styles.warnBox}>{str.recoveredTailHrvResultsNote}</Text>
            ) : null}
            {finalCoherenceRecoveredFromTail ? (
              <Text style={styles.warnBox}>
                {str.recoveredTailCoherenceResultsNote(
                  Math.floor((finalCoherenceTailWindowMs ?? 0) / 60_000),
                  Math.round(((finalCoherenceTailWindowMs ?? 0) % 60_000) / 1000),
                )}
              </Text>
            ) : null}
            {!cameraGuidanceOnlyMode && analysis?.warnings?.length ? (
              <Text style={styles.warnBox}>{analysis.warnings.join("\n")}</Text>
            ) : null}
            {!cameraGuidanceOnlyMode ? (
              <>
                <Text style={styles.metricLine}>
                  {str.durationLabel}:{" "}
                  {sessionStartWallMs != null ? (practiceTotalMs / 1000).toFixed(0) : "—"} с
                </Text>
                {finalStartAnalysis != null && finalEndAnalysis != null ? (
                  <>
                    <Text style={styles.approx}>{str.hybridEmulatedMidNote}</Text>
                    <HybridResultsTable
                      str={str}
                      startAnalysis={finalStartAnalysis}
                      endAnalysis={finalEndAnalysis}
                      startHrv={finalStartHrv}
                      endHrv={finalEndHrv}
                      startAvgBpm={finalStartAvgBpm}
                      endAvgBpm={finalEndAvgBpm}
                      startWindowMs={finalStartWindowMs}
                      endWindowMs={finalEndWindowMs}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.metricLine}>
                      {str.coherenceAvgLabel}:{" "}
                      {showCoherenceResults ? formatCoherencePercent(analysis?.coherenceAveragePercent) : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.coherenceMaxLabel}:{" "}
                      {showCoherenceResults ? formatCoherencePercent(analysis?.coherenceMaxPercent) : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.rsaLabel}:{" "}
                      {showCoherenceResults && analysis?.rsaAmplitudeBpm != null
                        ? `${Math.round(analysis.rsaAmplitudeBpm)} уд/мин`
                        : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.rsaNormalizedLabel}:{" "}
                      {showCoherenceResults && analysis?.rsaNormalizedPercent != null
                        ? `${Math.round(analysis.rsaNormalizedPercent)} %`
                        : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.entryTimeLabel}:{" "}
                      {showCoherenceResults && analysis?.entryTimeSec != null
                        ? `${analysis.entryTimeSec} с`
                        : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.rmssdLabel}:{" "}
                      {showHrvResults && finalRmssdMs != null ? `${Math.round(finalRmssdMs)} мс` : "—"}
                    </Text>
                    <Text style={styles.metricLine}>
                      {str.stressLabel}:{" "}
                      {showHrvResults && finalStressPercent != null
                        ? `${Math.round(finalStressPercent)}%`
                        : "—"}
                    </Text>
                  </>
                )}
              </>
            ) : null}
            {measuredPulseGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={showSeparateGuidancePulseGraph ? str.resultsMeasuredPulseLabel : str.calibrationPulse}
                points={measuredPulseGraphPoints}
                color="#60a5fa"
                unit="bpm"
                highlightIntervals={measuredPulseHighlights}
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {showSeparateGuidancePulseGraph && guidancePulseGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.resultsGuidancePulseLabel}
                points={guidancePulseGraphPoints}
                color="#34d399"
                unit="bpm"
                highlightIntervals={guidancePulseHighlights}
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
                continuousAcrossGaps
              />
            ) : null}
            {rrIntervalGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.resultsRrIntervalsLabel}
                points={rrIntervalGraphPoints}
                color="#38bdf8"
                unit="ms"
                highlightIntervals={measuredPulseHighlights}
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {coherenceGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.coherenceAvgLabel}
                points={coherenceGraphPoints}
                color="#22c55e"
                unit="percent"
                fixedMin={0}
                autoMaxHeadroom={0.25}
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {rsaGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.rsaLabel}
                points={rsaGraphPoints}
                color="#a78bfa"
                unit="bpm"
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {rmssdGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.rmssdLabel}
                points={rmssdGraphPoints}
                color="#f59e0b"
                unit="ms"
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {stressGraphPoints.length >= 2 ? (
              <ResultsMetricChart
                title={str.stressLabel}
                points={stressGraphPoints}
                color="#f87171"
                unit="percent"
                fixedMin={0}
                fixedMax={100}
                domainStartMs={0}
                domainEndMs={practiceTotalMs}
              />
            ) : null}
            {!cameraGuidanceOnlyMode && !canRequestInterpretation ? (
              <Text style={styles.infoBox}>{str.resultsInterpretationRequiresMetricsNote}</Text>
            ) : null}
            {DEBUG_ACTIVATION_EXPORT_ENABLED ? (
              <Pressable onPress={() => onExportJson()} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>{str.exportButton}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
      <View style={[styles.resultsActionsRow, closeAlone ? styles.resultsActionsRowCentered : null]}>
        {showInterpretAction ? (
          <Pressable onPress={() => void requestInterpretation()} style={styles.resultsDiscussBtn}>
            <Text style={styles.resultsDiscussBtnText}>{str.resultsDiscussButton}</Text>
          </Pressable>
        ) : null}
        {showInterpretRetry ? (
          <Pressable onPress={() => void requestInterpretation()} style={styles.resultsDiscussBtn}>
            <Text style={styles.resultsDiscussBtnText}>{str.resultsInterpretationRetryButton}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onClose}
          style={[styles.resultsCloseBtn, closeAlone ? styles.resultsCloseBtnAlone : null]}
        >
          <Text style={styles.resultsCloseBtnText}>{str.resultsCloseButton}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Внешний экспортируемый экран: оборачивает в BiofeedbackProvider.
 *
 * Пропсы образуют публичный контракт входа модуля BREATH, см.
 * `@/modules/breath/core/practice-io` и `modules/breath/README.md`.
 *   - `practiceId`  — тип практики (когерентное / канальное / квадрат / треугольник);
 *   - `durationMs`  — длительность практики в миллисекундах;
 *   - `chakra`      — чакра 1..7; выбирает цветовой профиль мандалы.
 *   - `launchSource` — источник запуска для статистики и recent stack diagnostics.
 *   - `usePulseSensor` — если false, практика стартует без активации пульсометра.
 */
export interface CoherenceBreathScreenProps {
  locale?: BreathLocale;
  practiceId?: BreathPracticeId;
  durationMs?: number;
  chakra?: import("@/modules/breath/core/chakra").Chakra;
  soundBed?: SoundBedId;
  /** Tempo key from launch (`6` or `4:4:4`). */
  tempo?: string;
  launchSource?: string;
  sensorMode?: BreathSensorMode;
  deviceId?: string;
  deviceName?: string;
  provider?: WearableDeviceProvider;
  capabilityTier?: string;
  connectionHint?: string;
  autoReconnect?: boolean;
  usePulseSensor?: boolean;
}

export function CoherenceBreathScreen({
  locale = "ru",
  practiceId,
  durationMs,
  chakra,
  soundBed = SOUND_BED_NEURO_SYNC,
  tempo,
  launchSource,
  sensorMode,
  deviceId,
  deviceName,
  provider,
  capabilityTier,
  connectionHint,
  autoReconnect = true,
  usePulseSensor,
}: CoherenceBreathScreenProps) {
  const providerConfig = sensorMode === "ble" ? WEARABLE_CAPTURE_CONFIG : FINGER_CAMERA_CAPTURE_CONFIG;
  return (
    <ThemeProvider value={defaultTheme}>
      <BiofeedbackProvider config={providerConfig}>
        <CoherenceBreathScreenInner
          locale={locale}
          initialPracticeId={practiceId}
          durationMs={durationMs}
          chakra={chakra}
          soundBed={soundBed}
          initialTempoKey={tempo}
          launchSource={launchSource}
          sensorMode={sensorMode}
          deviceId={deviceId}
          deviceName={deviceName}
          provider={provider}
          capabilityTier={capabilityTier}
          connectionHint={connectionHint}
          autoReconnect={autoReconnect}
          usePulseSensor={usePulseSensor}
        />
      </BiofeedbackProvider>
    </ThemeProvider>
  );
}

/**
 * Двухколоночная таблица результатов для гибридного режима. Слева — метрики
 * реального окна в начале практики, справа — в конце. Средние значения между
 * окнами умышленно не считаем: динамика «до vs после» — основная информация
 * для пользователя.
 */
function HybridResultsTable(props: {
  str: ReturnType<typeof getCoherenceBreathStrings>;
  startAnalysis: CoherenceSessionResult;
  endAnalysis: CoherenceSessionResult;
  startHrv: PracticeHrvMetricsResult | null;
  endHrv: PracticeHrvMetricsResult | null;
  startAvgBpm: number | null;
  endAvgBpm: number | null;
  startWindowMs: number | null;
  endWindowMs: number | null;
}) {
  const {
    str,
    startAnalysis,
    endAnalysis,
    startHrv,
    endHrv,
    startAvgBpm,
    endAvgBpm,
    startWindowMs,
    endWindowMs,
  } = props;

  const formatDuration = (ms: number | null): string => {
    if (ms == null || !(ms > 0)) return "—";
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return str.resultsWindowDurationLabel(m, s);
  };

  const fmtPercent = (value: number | null | undefined): string =>
    formatCoherencePercent(value);
  const fmtBpm = (value: number | null | undefined): string =>
    value != null ? `${Math.round(value)} уд/мин` : "—";
  const fmtMs = (value: number | null | undefined): string =>
    value != null ? `${Math.round(value)} мс` : "—";
  const fmtSec = (value: number | null | undefined): string =>
    value != null ? `${value} с` : "—";

  const rmssdStart =
    startHrv != null && startHrv.showRmssd ? startHrv.rmssdMs : null;
  const rmssdEnd =
    endHrv != null && endHrv.showRmssd ? endHrv.rmssdMs : null;
  const stressStart =
    startHrv != null && startHrv.showStress ? startHrv.stressPercent : null;
  const stressEnd =
    endHrv != null && endHrv.showStress ? endHrv.stressPercent : null;

  const rows: { label: string; start: string; end: string }[] = [
    {
      label: str.avgBpmLabel,
      start: fmtBpm(startAvgBpm),
      end: fmtBpm(endAvgBpm),
    },
    {
      label: str.coherenceAvgLabel,
      start: fmtPercent(startAnalysis.coherenceAveragePercent),
      end: fmtPercent(endAnalysis.coherenceAveragePercent),
    },
    {
      label: str.coherenceMaxLabel,
      start: fmtPercent(startAnalysis.coherenceMaxPercent),
      end: fmtPercent(endAnalysis.coherenceMaxPercent),
    },
    {
      label: str.rsaLabel,
      start: fmtBpm(startAnalysis.rsaAmplitudeBpm),
      end: fmtBpm(endAnalysis.rsaAmplitudeBpm),
    },
    {
      label: str.rsaNormalizedLabel,
      start: fmtPercent(startAnalysis.rsaNormalizedPercent),
      end: fmtPercent(endAnalysis.rsaNormalizedPercent),
    },
    {
      label: str.entryTimeLabel,
      start: fmtSec(startAnalysis.entryTimeSec),
      end: fmtSec(endAnalysis.entryTimeSec),
    },
    {
      label: str.rmssdLabel,
      start: fmtMs(rmssdStart),
      end: fmtMs(rmssdEnd),
    },
    {
      label: str.stressLabel,
      start: fmtPercent(stressStart),
      end: fmtPercent(stressEnd),
    },
  ];

  return (
    <View style={hybridStyles.table}>
      <View style={hybridStyles.headerRow}>
        <View style={hybridStyles.labelCell} />
        <View style={hybridStyles.valueCell}>
          <Text style={hybridStyles.headerText}>{str.resultsWindowStartLabel}</Text>
          <Text style={hybridStyles.subHeaderText}>{formatDuration(startWindowMs)}</Text>
        </View>
        <View style={hybridStyles.valueCell}>
          <Text style={hybridStyles.headerText}>{str.resultsWindowEndLabel}</Text>
          <Text style={hybridStyles.subHeaderText}>{formatDuration(endWindowMs)}</Text>
        </View>
      </View>
      {rows.map((row) => (
        <View key={row.label} style={hybridStyles.row}>
          <View style={hybridStyles.labelCell}>
            <Text style={hybridStyles.labelText}>{row.label}</Text>
          </View>
          <View style={hybridStyles.valueCell}>
            <Text style={hybridStyles.valueText}>{row.start}</Text>
          </View>
          <View style={hybridStyles.valueCell}>
            <Text style={hybridStyles.valueText}>{row.end}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const hybridStyles = StyleSheet.create({
  table: {
    marginTop: 8,
    marginBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.08)",
  },
  labelCell: {
    flex: 1.4,
    paddingRight: 8,
  },
  valueCell: {
    flex: 1,
    alignItems: "flex-end",
    paddingLeft: 8,
  },
  headerText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  subHeaderText: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 2,
  },
  labelText: {
    color: "#cbd5e1",
    fontSize: 14,
  },
  valueText: {
    color: "#f8fafc",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07080c" },
  idle: { flex: 1, padding: 24, justifyContent: "center" },
  idleTitle: { marginBottom: 2 },
  idleSubtitle: { marginBottom: 12 },
  idleHint: { marginBottom: 12 },
  simNote: { marginBottom: 12 },
  idleStartBtn: { marginTop: 12 },
  practicePicker: {
    marginTop: 8,
    marginBottom: 16,
  },
  pickerLabel: {
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pickerChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 148,
  },
  pickerChipText: {
    fontWeight: "700",
    marginBottom: 2,
  },
  primaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#22c55e",
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { color: "#052e16", fontWeight: "700", fontSize: 16 },
  secondaryBtn: {
    alignSelf: "stretch",
    marginTop: 16,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryBtnText: { color: "#e2e8f0", fontWeight: "600" },
  centerStack: { ...StyleSheet.absoluteFillObject, justifyContent: "center", alignItems: "center" },
  mandalaWrap: { ...StyleSheet.absoluteFillObject },
  instructionWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  instructionBlock: { alignItems: "center" },
  inhaleTitle: { textAlign: "center" },
  secHint: { marginTop: 8, textAlign: "center" },
  results: { flex: 1, padding: 24 },
  resultsTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  approx: { color: "#fbbf24", marginBottom: 12, fontSize: 13 },
  warnBox: { color: "#fca5a5", fontSize: 12, marginBottom: 12 },
  infoBox: { color: "#93c5fd", fontSize: 12, marginBottom: 12, lineHeight: 18 },
  debugMini: { color: "#64748b", fontSize: 11, marginBottom: 10, lineHeight: 15 },
  metricLine: { color: "#e2e8f0", fontSize: 16, marginBottom: 8 },
  metricNote: { color: "#94a3b8", fontSize: 12, marginBottom: 12, lineHeight: 18 },
  interpretationBody: { color: "#e2e8f0", fontSize: 16, lineHeight: 24, marginBottom: 12 },
  interpretationLoadingWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  resultsScroll: { flex: 1 },
  resultsScrollContent: { paddingBottom: 4 },
  resultChartCard: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
  },
  resultChartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  resultChartTitle: { color: "#f8fafc", fontSize: 15, fontWeight: "600", flex: 1 },
  resultChartSummary: { color: "#cbd5e1", fontSize: 12 },
  resultChartRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  // Fixed-width, right-aligned gutter so EVERY chart's plot starts at the same x.
  // Without a fixed width the gutter grew/shrank with the label text ("100%" vs
  // "22.8 ms" vs "80 bpm"), shifting the flex:1 plot — and with it the gridlines and
  // gap bands — by a different amount per chart. That was the cross-chart "полоски
  // сдвинуты" misalignment.
  resultChartYAxis: { width: 52, alignItems: "flex-end", justifyContent: "space-between", paddingVertical: 8 },
  resultChartPlot: { flex: 1 },
  resultChartXAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  resultChartAxisLabel: { color: "#94a3b8", fontSize: 11 },
  resultsActionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  resultsActionsRowCentered: {
    justifyContent: "center",
  },
  resultsDiscussBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563eb",
  },
  resultsDiscussBtnText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  resultsCloseBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#22c55e",
  },
  resultsCloseBtnAlone: {
    flex: 0,
    alignSelf: "center",
    minWidth: 168,
    paddingHorizontal: 28,
  },
  resultsCloseBtnText: {
    color: "#052e16",
    fontSize: 16,
    fontWeight: "700",
  },
  calib: { flex: 1, padding: 24, justifyContent: "center" },
  calibTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  calibHint: { color: "#94a3b8", fontSize: 15, marginBottom: 16 },
  calibStatus: { color: "#e2e8f0", fontSize: 16, marginBottom: 12 },
  calibPill: {
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  calibPillText: { color: "#cbd5e1", fontSize: 14 },
  opticalFooter: { gap: 6 },
  opticalCaption: { color: "rgba(226,232,240,0.88)", fontSize: 11, fontWeight: "600" },
  opticalMeta: { color: "#94a3b8", fontSize: 11, lineHeight: 15 },
  opticalMetrics: { color: "#e2e8f0", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  opticalMetricsMuted: { color: "#94a3b8", fontSize: 11, lineHeight: 15 },
  /**
   * PPG-баннер «Пульс потерян/слабый сигнал» во время практики. Лежит в самом низу поверх
   * всего полотна, чтобы всплывающая панель управления не перекрывала его (панель выезжает
   * над этим баннером, поскольку у неё больший `bottom`).
   */
  runningAbs: { ...StyleSheet.absoluteFillObject },
  topCloseButton: {
    position: "absolute",
    top: 54,
    right: 18,
    zIndex: 45,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  /**
   * Чёрная штора поверх всего. В обычное время прозрачна и не ловит касания. Используется
   * только для fade-to-black-and-back между sensor-UI и practice-UI. zIndex выше, чем у
   * панели управления, чтобы штора действительно перекрывала её на момент перехода.
   */
  blackCurtain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    zIndex: 80,
  },
  ppgBannerBottomWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    /**
     * Выше линии, где появится всплывающая панель управления (card ≈ 135 px + SafeArea).
     * Оставляем зазор, чтобы панель не перекрывала текст, когда выезжает.
     */
    bottom: 190,
    alignItems: "center",
    zIndex: 35,
  },
  ppgBannerText: {
    textAlign: "center",
  },
  sensorTitle: {
    marginBottom: 6,
    textAlign: "center",
  },
  sensorHint: {
    marginBottom: 28,
    textAlign: "center",
  },
  sensorTimerWrap: {
    alignSelf: "center",
    width: 104, // совпадает с `size` у CountdownRing: место всегда зарезервировано,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  /** Dim overlay instead of a solid “black window” for BLE connect wait. */
  blePrepOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 50,
  },
  blePrepMinimal: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 12,
  },
  blePrepWheelWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    minHeight: 220,
  },
  blePrepAndroidHint: {
    textAlign: "center",
    marginTop: 4,
    maxWidth: 280,
  },
  sensorStatus: {
    textAlign: "center",
    marginBottom: 28,
  },
  sensorChartWrap: {
    minHeight: 72, // совпадает с `height` у PpgMiniChart — резервирует место, чтобы
    // содержимое окна активации не «прыгало», даже если график временно не отрисуется.
    marginBottom: 32,
  },
  wearablePickerCard: {
    gap: 10,
  },
  wearableRow: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  wearableMetaLine: {
    textAlign: "center",
  },
  wearableActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  wearableActionBtn: {
    flex: 1,
  },
  sensorBackBtn: {
    alignSelf: "stretch",
  },
  diagnosticBtn: {
    alignSelf: "center",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dialogAction: {
    flex: 1,
  },
});
