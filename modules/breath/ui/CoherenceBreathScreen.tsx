import Constants from "expo-constants";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated as RNAnimated,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { isFingerFrameProcessorAvailable } from "@/modules/biofeedback-finger-frame-processor/src";

import { BiofeedbackProvider, useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { useBiofeedbackBus, useBiofeedbackChannel } from "@/modules/biofeedback/bus/react";
import { useBiofeedbackSnapshot } from "@/modules/biofeedback/bus/snapshot-adapter";
import { computePracticeHrvMetricsFullSession } from "@/modules/biofeedback/core/metrics";
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import { EmulatedPulseSensorSource } from "@/modules/biofeedback/sensors/EmulatedPulseSensorSource";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { SimulatedSensorSource } from "@/modules/biofeedback/sensors/SimulatedSensorSource";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

import {
  COHERENCE_PREFLIGHT_BUFFER_MS,
  COHERENCE_PREP_TOTAL_MS,
  COHERENCE_QUALITY_WINDOW_MS,
  COHERENCE_WARMUP_MS,
  QC_BPM_STDEV_MAX,
  QC_MIN_BEATS,
} from "@/modules/breath/core/coherence-constants";
import {
  BreathPhasePlanner,
  buildSimpleInhaleExhaleShape,
  type PlannedCycle,
} from "@/modules/breath/core/breath-phase-planner";
import { DEFAULT_COHERENCE_TEST_TIMING } from "@/modules/breath/core/types";
import { getCoherenceBreathStrings, type BreathLocale } from "@/modules/breath/i18n/coherence";
import type {
  CoherenceExportDebug,
  CoherencePulseLogEntry,
  CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";
import { BreathBinduMandala } from "@/modules/breath/ui/BreathBinduMandala";
import { PpgOpticalPreview } from "@/modules/breath/ui/PpgOpticalPreview";

import { BreathPracticeShell, useBreathPhaseLabel } from "./BreathPracticeShell";

const TIMING = DEFAULT_COHERENCE_TEST_TIMING;
/** Начальный BPM для seed-а planner-а, пока не пришли реальные удары. */
const INITIAL_SEED_BPM = 60;
/** Максимум времени в прогреве + QC до отмены (защита от зависания). */
const COHERENCE_PROTOCOL_MAX_MS = 180_000;
const UI_TICK_MS = 500;
/**
 * Частота обновления baseline EMA в planner-е. Это НЕ частота пересчёта `phaseDurations`
 * — план цикла меняется только по границе (см. `BreathPracticeShell.onCycleEnd`).
 * 250 мс достаточно, чтобы EMA успевал отслеживать медленные изменения BPM.
 */
const PLANNER_BASELINE_TICK_MS = 250;
/** Декларативный рисунок дыхания для когерентной практики. */
const COHERENCE_SHAPE = buildSimpleInhaleExhaleShape(
  TIMING.inhaleBeats,
  TIMING.exhaleBeats,
);
/** Пороги независимых конечных автоматов: палец / качество (мс по шкале камеры). */
const PPG_FINGER_LOST_OVERLAY_MS = 1000;
const PPG_QUALITY_GRADE_B_MS = 2000;
const PPG_QUALITY_GRADE_C_MS = 7000;
const PPG_SESSION_SECONDS = 120;
/** Длительность одного показа баннера ППГ (секунды × 1000). */
const PPG_BANNER_DISPLAY_MS = 4000;

const isExpoGo = Constants.executionEnvironment === "storeClient";
const useSimulatedPpg = isExpoGo || !isFingerFrameProcessorAvailable();

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
 * Внутренний экран. Использует Bus + Pipeline через context (см. `BiofeedbackProvider`),
 * подписывается на каналы, вместо прямой работы со снимками FingerSignalAnalyzer.
 */
function CoherenceBreathScreenInner({ locale }: { locale: BreathLocale }) {
  const str = useMemo(() => getCoherenceBreathStrings(locale), [locale]);
  const pipeline = useBiofeedbackPipeline();
  const bus = useBiofeedbackBus();
  const snapshot = useBiofeedbackSnapshot();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const pulseBpmLast = useBiofeedbackChannel("pulseBpm");
  const coherenceLast = useBiofeedbackChannel("coherence");
  const rmssdLast = useBiofeedbackChannel("rmssd");
  const stressLast = useBiofeedbackChannel("stress");
  // Подписка держит провайдер в курсе источника (UI использует `finalPulseWasEmulated`,
  // но канал нужен, чтобы React перерендеривал компонент при смене источника и
  // snapshot-кэш канала оставался заполненным).
  useBiofeedbackChannel("pulseSource");
  const [useEmulatedPulseMode, setUseEmulatedPulseMode] = useState(false);
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
  /** История планов за сессию (для diagnostic export). */
  const phaseDurationsHistoryRef = useRef<
    { planIndex: number; cycleMs: number; plannedInhaleMs: number; plannedExhaleMs: number; baselineBpm: number; rsaBpm: number | null }[]
  >([]);
  /** baseline BPM в planner-е: (t_since_session_start_ms, bpm). */
  const baselineBpmSeriesRef = useRef<{ tMs: number; bpm: number }[]>([]);
  /** Сводка по завершённым RSA-циклам. */
  const rsaCyclesSummaryRef = useRef<
    { hrInhale: number; hrExhale: number; rsaBpm: number; durationMs: number }[]
  >([]);
  const [sourceKey, setSourceKey] = useState(0);
  /** Уникальный счётчик «сессий PPG» для legacy совместимости в debug-метаполях. */
  const fingerSessionKey = sourceKey;

  const warmupStartedAtMs = useRef<number | null>(null);
  const protocolStartedAtMs = useRef<number | null>(null);
  const qcStartLogicalMsRef = useRef<number | null>(null);
  const pulseLogRef = useRef<CoherencePulseLogEntry[]>([]);
  const qcPulseSamplesRef = useRef<QcPulseSample[]>([]);
  const opticalPreviewBufferRef = useRef<RawOpticalSample[]>([]);
  const lastOpticalPreviewRefreshWallMsRef = useRef(0);
  const lastPulseLogWallClockRef = useRef(0);
  const snapshotCallbacksTotalRef = useRef(0);
  const snapshotsWhileRunningRef = useRef(0);
  const [opticalPreviewSamples, setOpticalPreviewSamples] = useState<RawOpticalSample[]>([]);

  /** Маска секунд практики, в которые сигнал был некачественным → BPM=0 на тахограмме. */
  const qualityBadAccumMsRef = useRef(0);
  const fingerAbsentAccumMsRef = useRef(0);
  const lastSampleMsRef = useRef<number | null>(null);

  /** Обратный отсчёт окна QC (секунды по времени камеры); `null` — ждём первую метку. */
  const [qcSecondsLeft, setQcSecondsLeft] = useState<number | null>(null);
  /** Обратный отсчёт всего protocol-а прогрев+QC для кругового индикатора (сек). */
  const [prepSecondsLeft, setPrepSecondsLeft] = useState<number | null>(null);
  /** Показать диалог «QC не прошёл — продолжить без датчика / повторить». */
  const [showQcFailedDialog, setShowQcFailedDialog] = useState(false);
  /**
   * Исход QC для экспорта: `ok` | `user_chose_no_sensor` | `retry_failed` | `null`.
   * `retry_failed` выставляется если пользователь закрыл диалог в текущей реализации не будет
   * использовано (кнопка «Попробовать снова» сбрасывает в null и снова запускает warmup),
   * оставлено на будущее для статистики.
   */
  const qcOutcomeRef = useRef<"ok" | "user_chose_no_sensor" | "retry_failed" | null>(null);

  /** UI banners. */
  const [ppgOverlayMessage, setPpgOverlayMessage] = useState<string | null>(null);
  const ppgBannerHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fingerLostBannerShownThisEpisodeRef = useRef(false);
  const weakSignalBannerShownThisEpisodeRef = useRef(false);
  const prevFingerDetectedForBannerRef = useRef(true);
  const prevBadSignalForBannerRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const clearPpgBannerUi = useCallback(() => {
    setPpgOverlayMessage(null);
    if (ppgBannerHideTimerRef.current != null) {
      clearTimeout(ppgBannerHideTimerRef.current);
      ppgBannerHideTimerRef.current = null;
    }
    fingerLostBannerShownThisEpisodeRef.current = false;
    weakSignalBannerShownThisEpisodeRef.current = false;
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
    if (phase !== "warmup" || useSimulatedPpg) return;
    const id = setInterval(() => {
      if (Date.now() - (warmupStartedAtMs.current ?? 0) >= COHERENCE_WARMUP_MS) {
        qcStartLogicalMsRef.current = null;
        setPhase("qualityCheck");
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if ((phase !== "warmup" && phase !== "qualityCheck") || useSimulatedPpg) return;
    const id = setInterval(() => {
      if (Date.now() - (protocolStartedAtMs.current ?? 0) > COHERENCE_PROTOCOL_MAX_MS) {
        Alert.alert(str.calibrationTitle, str.calibrationTimeout);
        setPhase("idle");
      }
    }, 2000);
    return () => clearInterval(id);
  }, [phase, str.calibrationTimeout, str.calibrationTitle]);

  // ─── Live optical preview для warmup/QC/running ───────────────────────────

  useEffect(() => {
    return bus.subscribe("optical", (sample) => {
      if (useSimulatedPpg || phaseRef.current === "idle" || phaseRef.current === "results") {
        return;
      }
      opticalPreviewBufferRef.current.push(sample);
      if (opticalPreviewBufferRef.current.length > 72) {
        opticalPreviewBufferRef.current = opticalPreviewBufferRef.current.slice(-72);
      }
      const now = Date.now();
      if (now - lastOpticalPreviewRefreshWallMsRef.current >= 120) {
        lastOpticalPreviewRefreshWallMsRef.current = now;
        setOpticalPreviewSamples([...opticalPreviewBufferRef.current]);
      }
    });
  }, [bus]);

  // ─── Подписка на pulseBpm для QC, debug и pulseLog ────────────────────────

  useEffect(() => {
    return bus.subscribe("pulseBpm", (event) => {
      snapshotCallbacksTotalRef.current += 1;
      const cameraTimestampMs = pipeline.getLastSourceTimestampMs();
      if (phaseRef.current === "warmup" || phaseRef.current === "qualityCheck") {
        qcPulseSamplesRef.current.push({
          cameraTimestampMs,
          bpm: event.bpm,
          rawBpm: event.rawBpm,
          rrCount: event.rrCount,
          jitterMs: event.jitterMs,
          looksCoherent: event.looksCoherent,
          signalQuality: snapshotRef.current.signalQuality,
          lockState: event.lockState,
        });
        qcPulseSamplesRef.current = qcPulseSamplesRef.current.filter(
          (sample) => sample.cameraTimestampMs >= cameraTimestampMs - COHERENCE_PREP_TOTAL_MS - 4_000,
        );
      }
      if (phaseRef.current === "running") {
        snapshotsWhileRunningRef.current += 1;
        const wall = Date.now();
        if (wall - lastPulseLogWallClockRef.current >= 500) {
          lastPulseLogWallClockRef.current = wall;
          pulseLogRef.current.push({
            cameraTimestampMs: pipeline.getLastSourceTimestampMs(),
            wallClockMs: wall,
            pulseRateBpm: event.bpm,
            signalQuality: snapshot.signalQuality,
            pulseReady: event.hasFreshBeat,
            fingerDetected: snapshot.fingerDetected,
            pulseLockState: event.lockState,
            beatTimestampsCount: pipeline.getMergedBeats().length,
          });
        }
      }
    });
  }, [bus, pipeline, snapshot.signalQuality, snapshot.fingerDetected]);

  // ─── QC окно 10 с (camera time) — ОДНА попытка, затем диалог ──────────────

  useEffect(() => {
    if (phase !== "qualityCheck" || useSimulatedPpg) return;
    const id = setInterval(() => {
      const camTs = pipeline.getLastSourceTimestampMs();
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

      if (camTs < qcStart + COHERENCE_QUALITY_WINDOW_MS) return;

      const winEnd = qcStart + COHERENCE_QUALITY_WINDOW_MS;
      const beatsInWin = pipeline
        .getCanonicalBeats()
        .filter((t) => t >= qcStart && t <= winEnd);
      const snap = snapshotRef.current;

      const pulseSamples = qcPulseSamplesRef.current.filter(
        (sample) => sample.cameraTimestampMs >= qcStart && sample.cameraTimestampMs <= winEnd,
      );
      const stableSamples = pulseSamples.filter(
        (sample) =>
          sample.signalQuality >= 0.54 &&
          sample.rrCount >= 4 &&
          (sample.looksCoherent || sample.lockState !== "searching") &&
          (sample.bpm > 0 || sample.rawBpm > 0),
      );
      const bpmValues = stableSamples
        .map((sample) => (sample.bpm > 0 ? sample.bpm : sample.rawBpm))
        .filter((value) => value > 0);
      const bpmStdev = computeStdDev(bpmValues);
      const stableFraction =
        pulseSamples.length > 0 ? stableSamples.length / pulseSamples.length : 0;

      const ok =
        snap.signalQuality >= 0.7 &&
        beatsInWin.length >= QC_MIN_BEATS &&
        stableSamples.length >= 3 &&
        stableFraction >= 0.55 &&
        bpmStdev <= QC_BPM_STDEV_MAX;

      if (ok) {
        qcOutcomeRef.current = "ok";
        const anchor = winEnd;
        pipeline.getCoherenceEngine().startSession({
          sessionStartedAtMs: anchor,
          inhaleMs: TIMING.inhaleMs,
          exhaleMs: TIMING.exhaleMs,
          mode: "test120s",
          preflightBeats: beatsInWin,
          bufferMsBeforeSession: COHERENCE_PREFLIGHT_BUFFER_MS,
        });
        qualityBadAccumMsRef.current = 0;
        fingerAbsentAccumMsRef.current = 0;
        lastSampleMsRef.current = anchor;
        clearPpgBannerUi();
        setSessionStartWallMs(Date.now());
        setSessionStartLogicalMs(anchor);
        setElapsedMs(0);
        setPhase("running");
      } else {
        // Одна попытка — если не прошло, показываем диалог выбора.
        qcOutcomeRef.current = "retry_failed";
        setShowQcFailedDialog(true);
      }
    }, 250);
    return () => {
      clearInterval(id);
      setQcSecondsLeft(null);
    };
  }, [phase, pipeline, clearPpgBannerUi]);

  // ─── Круговой обратный отсчёт прогрев+QC (warmup 10 с + QC 10 с = 20 с) ───

  useEffect(() => {
    if (phase !== "warmup" && phase !== "qualityCheck") {
      setPrepSecondsLeft(null);
      return;
    }
    if (useSimulatedPpg) {
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
  }, [phase]);

  // ─── Running: добавляем удары в CoherenceEngine + ведём баннеры качества ─

  useEffect(() => {
    if (phase !== "running" || useSimulatedPpg) return;
    const id = setInterval(() => {
      const now = pipeline.getLastSourceTimestampMs();
      if (now <= 0) return;
      pipeline.getCoherenceEngine().appendBeats(pipeline.getCanonicalBeats());

      const lastSample = lastSampleMsRef.current ?? now;
      const delta = Math.max(0, now - lastSample);
      lastSampleMsRef.current = now;

      const fingerOk = snapshot.fingerDetected;
      const badSignal =
        snapshot.pulseLockState === "searching" || snapshot.signalQuality < 0.5;

      if (!fingerOk) {
        fingerAbsentAccumMsRef.current += delta;
        qualityBadAccumMsRef.current = 0;
      } else {
        fingerAbsentAccumMsRef.current = 0;
        if (badSignal) qualityBadAccumMsRef.current += delta;
        else qualityBadAccumMsRef.current = 0;
      }

      const fingerJustReturned = fingerOk && !prevFingerDetectedForBannerRef.current;
      const signalJustRecovered = fingerOk && !badSignal && prevBadSignalForBannerRef.current;
      if (fingerJustReturned || signalJustRecovered) {
        if (ppgBannerHideTimerRef.current != null) clearTimeout(ppgBannerHideTimerRef.current);
        ppgBannerHideTimerRef.current = null;
        setPpgOverlayMessage(null);
        if (fingerJustReturned) fingerLostBannerShownThisEpisodeRef.current = false;
        if (signalJustRecovered) weakSignalBannerShownThisEpisodeRef.current = false;
      }
      prevFingerDetectedForBannerRef.current = fingerOk;
      prevBadSignalForBannerRef.current = badSignal;

      const qualitySustainedBad =
        fingerOk &&
        qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_B_MS &&
        badSignal;

      if (sessionStartLogicalMs != null) {
        const sec = Math.min(
          PPG_SESSION_SECONDS - 1,
          Math.max(0, Math.floor((now - sessionStartLogicalMs) / 1000)),
        );
        if (!fingerOk || qualitySustainedBad) {
          pipeline.getCoherenceEngine().forceSecondBpmZero(sec, PPG_SESSION_SECONDS);
        }
      }

      if (
        !fingerOk &&
        fingerAbsentAccumMsRef.current >= PPG_FINGER_LOST_OVERLAY_MS &&
        !fingerLostBannerShownThisEpisodeRef.current
      ) {
        fingerLostBannerShownThisEpisodeRef.current = true;
        if (ppgBannerHideTimerRef.current != null) clearTimeout(ppgBannerHideTimerRef.current);
        setPpgOverlayMessage(str.ppgFingerLostMessage);
        ppgBannerHideTimerRef.current = setTimeout(() => {
          setPpgOverlayMessage(null);
          ppgBannerHideTimerRef.current = null;
        }, PPG_BANNER_DISPLAY_MS);
      } else if (
        fingerOk &&
        badSignal &&
        qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_B_MS &&
        qualityBadAccumMsRef.current < PPG_QUALITY_GRADE_C_MS &&
        !weakSignalBannerShownThisEpisodeRef.current
      ) {
        weakSignalBannerShownThisEpisodeRef.current = true;
        if (ppgBannerHideTimerRef.current != null) clearTimeout(ppgBannerHideTimerRef.current);
        setPpgOverlayMessage(str.ppgWeakSignalMessage);
        ppgBannerHideTimerRef.current = setTimeout(() => {
          setPpgOverlayMessage(null);
          ppgBannerHideTimerRef.current = null;
        }, PPG_BANNER_DISPLAY_MS);
      }
    }, 250);
    return () => clearInterval(id);
  }, [
    phase,
    pipeline,
    sessionStartLogicalMs,
    snapshot.fingerDetected,
    snapshot.pulseLockState,
    snapshot.signalQuality,
    str.ppgFingerLostMessage,
    str.ppgWeakSignalMessage,
  ]);

  // ─── UI таймер сессии + анимации ─────────────────────────────────────────

  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null || sessionStartLogicalMs == null) return;
    const id = setInterval(() => {
      const e = Date.now() - sessionStartWallMs;
      setElapsedMs(Math.min(e, TIMING.totalMs));
      if (e < TIMING.totalMs) return;
      clearInterval(id);
      const analysisEndLogicalMs = sessionStartLogicalMs + TIMING.totalMs;
      const result = pipeline.getCoherenceEngine().finalize(analysisEndLogicalMs);
      const finalRes = useSimulatedPpg
        ? { ...result, warnings: [...result.warnings, str.simulatedMetricsNote] }
        : result;
      const practiceHrv = computePracticeHrvMetricsFullSession(
        pipeline.getHrvAccumulator().getBeats(),
      );
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
        sessionTimeBase: useSimulatedPpg ? "unixEpochMs" : "cameraPresentationMs",
        practicePpgAnchorMs: useSimulatedPpg ? null : sessionStartLogicalMs,
        wallClockSessionStartMs: sessionStartWallMs,
        snapshotCallbacksTotal: snapshotCallbacksTotalRef.current,
        snapshotsWhileRunning: snapshotsWhileRunningRef.current,
        lastSnapshotTimestampMs: pipeline.getLastSourceTimestampMs(),
        lastSnapshotBeatCount: pipeline.getMergedBeats().length,
        lastSnapshotDetectedBeatCount: pipeline.getMergedBeats().length,
        lastSnapshotPulseLock: pipeline.getLockState(),
        lastSnapshotFingerDetected: snapshot.fingerDetected,
        rawBeatArrayLengthBeforeFilter: sessionBeats.length,
        beatsAfterDedupeMs: finalRes.beatTimestampsMsAnalyzed.length,
        rawBeatMinMs: sessionBeats[0] ?? null,
        rawBeatMaxMs: sessionBeats[sessionBeats.length - 1] ?? null,
        beatsAfterSessionWindowFilter: finalRes.beatTimestampsMsBeforeDedupe.length,
        analysisSessionStartMs: sessionStartLogicalMs,
        analysisSessionEndMs: analysisEndLogicalMs,
        rrSeriesMs,
        baselineBpmSeries: baselineBpmSeriesRef.current.slice(),
        rsaCyclesSummary: rsaCyclesSummaryRef.current.slice(),
        phaseDurationsHistory: phaseDurationsHistoryRef.current.slice(),
        qcOutcome: qcOutcomeRef.current,
        practiceRmssdMs: practiceHrv.showRmssd ? practiceHrv.rmssdMs : null,
        practiceStressPercent: practiceHrv.showStress ? practiceHrv.stressPercent : null,
        practiceHrvBeatCount: practiceHrv.validBeatCount,
        peakDetector: peakDiag,
      };
      setExportDebug(debug);
      setAnalysis(finalRes);
      setFinalRmssdMs(practiceHrv.showRmssd ? practiceHrv.rmssdMs : null);
      setFinalStressPercent(practiceHrv.showStress ? practiceHrv.stressPercent : null);
      setFinalPulseWasEmulated(pipeline.isPulseEmulated());
      setPhase("results");
    }, UI_TICK_MS);
    return () => clearInterval(id);
  }, [
    phase,
    sessionStartWallMs,
    sessionStartLogicalMs,
    fingerSessionKey,
    pipeline,
    snapshot.fingerDetected,
    str.simulatedMetricsNote,
  ]);

  /**
   * Инициализация планировщика при переходе в "running": seed BPM + первый план цикла.
   * Дальнейшее — через `handleCycleEnd` (по онCycleEnd от shell) и `updateBaseline` из
   * подписки на `pulseBpm`.
   */
  useEffect(() => {
    if (phase !== "running") return;
    const planner = plannerRef.current;
    const seedBpm = snapshot.pulseRateBpm > 0 ? snapshot.pulseRateBpm : INITIAL_SEED_BPM;
    planner.seedBaseline(seedBpm);
    const firstPlan = planner.planNextCycle(COHERENCE_SHAPE);
    const startAtMs = Date.now();
    setCurrentPlan(firstPlan);
    setCycleStartMs(startAtMs);
    phaseDurationsHistoryRef.current = [
      {
        planIndex: 0,
        cycleMs: firstPlan.cycleMs,
        plannedInhaleMs: firstPlan.phases.find((p) => p.kind === "inhale")?.phaseMs ?? 0,
        plannedExhaleMs: firstPlan.phases.find((p) => p.kind === "exhale")?.phaseMs ?? 0,
        baselineBpm: firstPlan.baselineBpm,
        rsaBpm: firstPlan.rsaInfo?.rsaBpm ?? null,
      },
    ];
    // next effects: subscribe to pulseBpm to keep baseline EMA fresh.
  }, [phase]);

  /** Подписка на pulseBpm → planner.updateBaseline. Обновления идут ~2 Гц. */
  useEffect(() => {
    if (phase !== "running") return;
    const planner = plannerRef.current;
    return bus.subscribe("pulseBpm", (event) => {
      const medianRr = event.medianRrMs;
      const bpm = medianRr > 0 ? 60_000 / medianRr : event.bpm;
      if (bpm > 0) {
        const now = Date.now();
        planner.updateBaseline(now, bpm);
        if (sessionStartWallMs != null) {
          baselineBpmSeriesRef.current.push({ tMs: now - sessionStartWallMs, bpm });
        }
      }
    });
  }, [phase, bus, sessionStartWallMs]);

  /** Подписка на coherence → подавать planner последний завершённый RSA-цикл. */
  useEffect(() => {
    if (phase !== "running") return;
    const planner = plannerRef.current;
    let lastCycleKey = "";
    return bus.subscribe("coherence", (event) => {
      const cycle = event.lastCompletedRsaCycle;
      if (!cycle) return;
      planner.ingestCompletedRsaCycle(cycle);
      const key = `${cycle.durationMs.toFixed(0)}|${cycle.hrInhale.toFixed(2)}|${cycle.hrExhale.toFixed(2)}`;
      if (key !== lastCycleKey) {
        lastCycleKey = key;
        rsaCyclesSummaryRef.current.push({
          hrInhale: cycle.hrInhale,
          hrExhale: cycle.hrExhale,
          rsaBpm: cycle.rsaBpm,
          durationMs: cycle.durationMs,
        });
      }
    });
  }, [phase, bus]);

  /** Вызывается shell-ом по концу каждого цикла → запланировать следующий. */
  const handleCycleEnd = useCallback(() => {
    const prevPlan = currentPlanRef.current;
    const prevStart = cycleStartMsRef.current;
    if (!prevPlan || prevStart == null) return;
    const planner = plannerRef.current;
    const nextPlan = planner.planNextCycle(COHERENCE_SHAPE);
    const nextStart = prevStart + prevPlan.cycleMs;
    setCurrentPlan(nextPlan);
    setCycleStartMs(nextStart);
    phaseDurationsHistoryRef.current.push({
      planIndex: phaseDurationsHistoryRef.current.length,
      cycleMs: nextPlan.cycleMs,
      plannedInhaleMs: nextPlan.phases.find((p) => p.kind === "inhale")?.phaseMs ?? 0,
      plannedExhaleMs: nextPlan.phases.find((p) => p.kind === "exhale")?.phaseMs ?? 0,
      baselineBpm: nextPlan.baselineBpm,
      rsaBpm: nextPlan.rsaInfo?.rsaBpm ?? null,
    });
  }, []);

  useEffect(() => {
    if (phase !== "running" || sessionStartWallMs == null) return;
    const fadeStart = TIMING.instructionPhaseMs - 1500;
    if (elapsedMs >= fadeStart && elapsedMs < TIMING.instructionPhaseMs) {
      const t = (elapsedMs - fadeStart) / 1500;
      instructionOpacity.setValue(1 - t);
      mandalaOpacity.setValue(t);
    } else if (elapsedMs >= TIMING.instructionPhaseMs) {
      instructionOpacity.setValue(0);
      mandalaOpacity.setValue(1);
    } else {
      instructionOpacity.setValue(1);
      mandalaOpacity.setValue(0);
    }
  }, [elapsedMs, instructionOpacity, mandalaOpacity, phase, sessionStartWallMs]);

  const { isInhale } = useBreathPhaseLabel(elapsedMs, currentPlan);

  const dimOpacity =
    phase === "running" && elapsedMs > TIMING.totalMs - TIMING.dimBeforeEndMs
      ? Math.min(
          1,
          (elapsedMs - (TIMING.totalMs - TIMING.dimBeforeEndMs)) / TIMING.dimBeforeEndMs,
        )
      : 0;

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
      qcPulseSamplesRef.current = [];
      opticalPreviewBufferRef.current = [];
      lastOpticalPreviewRefreshWallMsRef.current = 0;
      lastPulseLogWallClockRef.current = 0;
      snapshotCallbacksTotalRef.current = 0;
      snapshotsWhileRunningRef.current = 0;
      phaseDurationsHistoryRef.current = [];
      baselineBpmSeriesRef.current = [];
      rsaCyclesSummaryRef.current = [];
      qcOutcomeRef.current = forceEmulatedPulse ? "user_chose_no_sensor" : null;
      setSourceKey((k) => k + 1);
      setExportDebug(null);
      setAnalysis(null);
      setOpticalPreviewSamples([]);
      setFinalRmssdMs(null);
      setFinalStressPercent(null);
      setFinalPulseWasEmulated(false);
      setSessionStartLogicalMs(null);
      setCurrentPlan(null);
      setCycleStartMs(null);
      setUseEmulatedPulseMode(forceEmulatedPulse);
      setShowQcFailedDialog(false);
      clearPpgBannerUi();

      if (useSimulatedPpg || forceEmulatedPulse) {
        const now = Date.now();
        pipeline.getCoherenceEngine().startSession({
          sessionStartedAtMs: now,
          inhaleMs: TIMING.inhaleMs,
          exhaleMs: TIMING.exhaleMs,
          mode: "test120s",
          bufferMsBeforeSession: 0,
        });
        setSessionStartWallMs(now);
        setSessionStartLogicalMs(now);
        setElapsedMs(0);
        setPhase("running");
        return;
      }

      warmupStartedAtMs.current = Date.now();
      protocolStartedAtMs.current = Date.now();
      setSessionStartWallMs(null);
      setElapsedMs(0);
      setPhase("warmup");
    },
    [pipeline, clearPpgBannerUi],
  );

  const exportJson = useCallback(async () => {
    if (analysis == null || sessionStartWallMs == null || sessionStartLogicalMs == null) return;
    const analysisEndLogicalMs = sessionStartLogicalMs + TIMING.totalMs;
    const payload = pipeline.getCoherenceEngine().buildExportJson(analysisEndLogicalMs, {
      dataSource: useSimulatedPpg ? "simulated" : "fingerPpg",
      debug: exportDebug ?? undefined,
      pulseLog: useSimulatedPpg
        ? undefined
        : pulseLogRef.current.filter((p) => p.wallClockMs >= sessionStartWallMs),
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
  }, [analysis, exportDebug, pipeline, sessionStartLogicalMs, sessionStartWallMs]);

  const inhaleMsForHint =
    currentPlan?.phases.find((p) => p.kind === "inhale")?.phaseMs ?? TIMING.inhaleMs;
  const exhaleMsForHint =
    currentPlan?.phases.find((p) => p.kind === "exhale")?.phaseMs ?? TIMING.exhaleMs;

  const centerInstruction = (
    <View style={styles.instructionBlock}>
      <Text style={styles.inhaleTitle}>{isInhale ? str.inhale : str.exhale}</Text>
      <Text style={styles.secHint}>
        {((isInhale ? inhaleMsForHint : exhaleMsForHint) / 1000).toFixed(0)} с
      </Text>
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

  const qcOpticalPreview =
    !useSimulatedPpg && (phase === "warmup" || phase === "qualityCheck") ? (
      <PpgOpticalPreview
        title={str.opticalSeriesCaption}
        samples={opticalPreviewSamples}
        beatTimestampsMs={snapshot.mergedBeats}
        emptyText={str.opticalNoSamples}
        footer={
          <View style={styles.qcDebugWrap}>
            <Text style={styles.qcDebugText}>
              stable {Math.round(qcDebugSnapshot.stableBpm || 0)} · raw{" "}
              {Math.round(qcDebugSnapshot.rawBpm || 0)} · RR {qcDebugSnapshot.rrCount} · jitter{" "}
              {Math.round(qcDebugSnapshot.jitterMs)} ms
            </Text>
            <Text style={styles.qcDebugTextMuted}>
              good {qcDebugSnapshot.stableFractionPct}% · {snapshot.pulseLockState} · сигн.{" "}
              {(snapshot.signalQuality * 100).toFixed(0)}% ·{" "}
              {qcDebugSnapshot.looksCoherent ? "coherent" : "noisy"}
            </Text>
          </View>
        }
      />
    ) : null;

  const cameraActive = phase === "warmup" || phase === "qualityCheck" || phase === "running";

  const liveCoherencePercent = coherenceLast?.currentPercent ?? null;
  const liveCoherenceAvgPercent = coherenceLast?.averagePercent ?? null;
  const liveCoherenceEntrySec = coherenceLast?.entryTimeSec ?? null;
  const liveRmssdMs = rmssdLast?.rmssdMs ?? null;
  const liveStressPercent = stressLast?.percent ?? null;

  /**
   * Live-RSA: медиана последних до 5 валидных циклов из снапшота CoherenceEngine (~1 Гц).
   *
   * Раньше показывали только последний цикл — он сильно скачет (одиночные выбросы до 40–60 уд/мин
   * даже у сидящего неподвижно человека из-за шума PPG в конкретные 10-с интервалы). Медиана
   * последних 3–5 циклов гораздо стабильнее и отражает реальный тонус RSA.
   */
  const [liveRsaBpm, setLiveRsaBpm] = useState<number | null>(null);
  useEffect(() => {
    if (phase !== "running") {
      setLiveRsaBpm(null);
      return;
    }
    const id = setInterval(() => {
      const now = pipeline.getLastSourceTimestampMs();
      if (now <= 0) return;
      const snap = pipeline.getCoherenceEngine().snapshot(now);
      if (snap == null) return;
      const active = snap.rsaCycles.filter((c) => !c.inactive);
      if (active.length === 0) {
        setLiveRsaBpm(null);
        return;
      }
      const tail = active.slice(-5).map((c) => c.rsaBpm).sort((a, b) => a - b);
      const median = tail[Math.floor(tail.length / 2)]!;
      setLiveRsaBpm(median);
    }, 1000);
    return () => clearInterval(id);
  }, [phase, pipeline]);

  const practiceFooter = useMemo(() => {
    if (phase !== "running") return null;
    if (useSimulatedPpg) {
      return (
        <View style={styles.opticalFooter}>
          <Text style={styles.opticalCaption}>{str.opticalSimulatedNote}</Text>
        </View>
      );
    }
    const elapsedSec = Math.floor(elapsedMs / 1000);
    return (
      <View style={styles.opticalFooter}>
        <Text style={styles.opticalCaption}>{str.opticalSeriesCaption}</Text>
        <Text style={styles.opticalMeta}>
          {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач. {(snapshot.signalQuality * 100).toFixed(0)}%
          {" · "}
          {snapshot.fingerDetected ? "палец" : "нет пальца"} · {snapshot.pulseLockState}
        </Text>
        <Text style={styles.opticalMetrics}>
          Гармония: {liveCoherencePercent != null ? `${Math.round(liveCoherencePercent)}%` : "—"}
          {liveCoherenceAvgPercent != null ? ` (ср. ${Math.round(liveCoherenceAvgPercent)}%)` : ""}
          {" · "}RSA: {liveRsaBpm != null ? `${Math.round(liveRsaBpm)} уд/мин` : "—"}
          {" · "}RMSSD: {liveRmssdMs != null ? `${Math.round(liveRmssdMs)} мс` : "—"}
          {" · "}стресс: {liveStressPercent != null ? `${Math.round(liveStressPercent)}%` : "—"}
        </Text>
        <Text style={styles.opticalMetricsMuted}>
          Вход в поток: {liveCoherenceEntrySec != null ? `${liveCoherenceEntrySec} с` : "—"}
          {" · "}время практики: {elapsedSec} с из {Math.round(TIMING.totalMs / 1000)} с
        </Text>
      </View>
    );
  }, [
    phase,
    snapshot.pulseRateBpm,
    snapshot.signalQuality,
    snapshot.fingerDetected,
    snapshot.pulseLockState,
    liveCoherencePercent,
    liveCoherenceAvgPercent,
    liveCoherenceEntrySec,
    liveRsaBpm,
    liveRmssdMs,
    liveStressPercent,
    elapsedMs,
    str,
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      {!isExpoGo && !useSimulatedPpg && !useEmulatedPulseMode ? (
        <FingerPpgCameraSource key={`finger-${sourceKey}`} isActive={cameraActive} />
      ) : null}
      {useSimulatedPpg ? (
        <SimulatedSensorSource key={`sim-${sourceKey}`} isActive={cameraActive} />
      ) : null}
      {useEmulatedPulseMode && !useSimulatedPpg ? (
        <EmulatedPulseSensorSource key={`emu-${sourceKey}`} isActive={cameraActive} />
      ) : null}

      {phase === "idle" ? (
        <View style={styles.idle}>
          <Text style={styles.idleTitle}>{str.practiceTitle}</Text>
          <Text style={styles.idleHint}>{str.fingerHint}</Text>
          {useSimulatedPpg ? <Text style={styles.simNote}>{str.simulatedMetricsNote}</Text> : null}
          <Pressable onPress={() => beginFromIdle(false)} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{str.startButton}</Text>
          </Pressable>
          {!useSimulatedPpg ? (
            <Pressable onPress={() => beginFromIdle(true)} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>{str.startWithoutSensorButton}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {phase === "warmup" ? (
        <View style={styles.calib}>
          <Text style={styles.calibTitle}>{str.warmupTitle}</Text>
          <Text style={styles.calibHint}>{str.warmupHint}</Text>
          {prepSecondsLeft != null ? (
            <View style={styles.prepCountdownWrap}>
              <View style={styles.prepCountdownRing}>
                <Text style={styles.prepCountdownNum}>{prepSecondsLeft}</Text>
              </View>
              <Text style={styles.prepCountdownCaption}>с</Text>
            </View>
          ) : null}
          <Text style={styles.calibStatus}>{str.calibrationWait}</Text>
          <View style={styles.calibPill}>
            <Text style={styles.calibPillText}>
              {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач.{" "}
              {(snapshot.signalQuality * 100).toFixed(0)}% · raw {Math.round(pulseBpmLast?.rawBpm || 0)}
            </Text>
          </View>
          {qcOpticalPreview}
          <Pressable onPress={() => setPhase("idle")} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "qualityCheck" ? (
        <View style={styles.calib}>
          <Text style={styles.calibTitle}>{str.qualityCheckTitle}</Text>
          <Text style={styles.calibHint}>{str.qualityCheckHint}</Text>
          {prepSecondsLeft != null ? (
            <View style={styles.prepCountdownWrap}>
              <View style={styles.prepCountdownRing}>
                <Text style={styles.prepCountdownNum}>{prepSecondsLeft}</Text>
              </View>
              <Text style={styles.prepCountdownCaption}>с</Text>
            </View>
          ) : null}
          <Text style={styles.calibStatus}>
            {qcSecondsLeft === null ? str.qualityCheckWaitingTimebase : str.qualityCheckCountdown(qcSecondsLeft)}
          </Text>
          <View style={styles.calibPill}>
            <Text style={styles.calibPillText}>
              {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач.{" "}
              {(snapshot.signalQuality * 100).toFixed(0)}% · raw {Math.round(pulseBpmLast?.rawBpm || 0)}
              {" · "}
              {snapshot.pulseLockState}
            </Text>
          </View>
          {qcOpticalPreview}
          <Pressable onPress={() => setPhase("idle")} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {showQcFailedDialog ? (
        <View style={styles.dialogBackdrop}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>{str.qcFailedDialogTitle}</Text>
            <Text style={styles.dialogMessage}>{str.qcFailedDialogMessage}</Text>
            <Pressable
              onPress={() => {
                setShowQcFailedDialog(false);
                qcOutcomeRef.current = "user_chose_no_sensor";
                beginFromIdle(true);
              }}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>{str.qcFailedContinueWithoutSensor}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setShowQcFailedDialog(false);
                qcStartLogicalMsRef.current = null;
                qcOutcomeRef.current = null;
                qcPulseSamplesRef.current = [];
                opticalPreviewBufferRef.current = [];
                setOpticalPreviewSamples([]);
                warmupStartedAtMs.current = Date.now();
                protocolStartedAtMs.current = Date.now();
                setPhase("warmup");
              }}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>{str.qcFailedRetry}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === "running" ? (
        <BreathPracticeShell
          isBreathTimingActive
          plannedCycle={currentPlan}
          cycleStartMs={cycleStartMs}
          onCycleEnd={handleCycleEnd}
          dimOpacity={dimOpacity}
          footer={practiceFooter}
          center={
            <View style={styles.centerStack}>
              <RNAnimated.View style={[styles.mandalaWrap, { opacity: mandalaOpacity }]}>
                <BreathBinduMandala isActive />
              </RNAnimated.View>
              <RNAnimated.View
                style={[styles.instructionWrap, { opacity: instructionOpacity }]}
                pointerEvents="none"
              >
                {centerInstruction}
              </RNAnimated.View>
              {ppgOverlayMessage ? (
                <View style={styles.ppgOverlayWrap} pointerEvents="none">
                  <Text style={styles.ppgOverlayText}>{ppgOverlayMessage}</Text>
                </View>
              ) : null}
            </View>
          }
        />
      ) : null}

      {phase === "results" ? (
        <View style={styles.results}>
          <Text style={styles.resultsTitle}>{str.practiceTitle}</Text>
          {analysis?.metricsApproximate ? <Text style={styles.approx}>{str.approximateMetricsNote}</Text> : null}
          {useSimulatedPpg ? <Text style={styles.approx}>{str.simulatedMetricsNote}</Text> : null}
          {finalPulseWasEmulated && !useSimulatedPpg ? (
            <Text style={styles.warnBox}>{str.emulatedPulseResultsNote}</Text>
          ) : null}
          {analysis?.warnings?.length ? (
            <Text style={styles.warnBox}>{analysis.warnings.join("\n")}</Text>
          ) : null}
          {exportDebug ? (
            <Text style={styles.debugMini}>
              {exportDebug.sessionTimeBase === "cameraPresentationMs"
                ? str.debugTimeBaseCamera
                : str.debugTimeBaseUnix}
              {" · "}
              {str.debugBeatsInWindow}: {exportDebug.beatsAfterSessionWindowFilter}
              {exportDebug.beatsAfterDedupeMs != null ? (
                <>
                  {" · "}
                  {str.debugBeatsAfterDedupe}: {exportDebug.beatsAfterDedupeMs}
                </>
              ) : null}
            </Text>
          ) : null}
          <Text style={styles.metricLine}>
            {str.durationLabel}:{" "}
            {sessionStartWallMs != null ? (TIMING.totalMs / 1000).toFixed(0) : "—"} с
          </Text>
          {analysis?.metricsWithheldDueToInsufficientData || finalPulseWasEmulated ? (
            <Text style={styles.metricLine}>
              {str.coherenceAvgLabel}: — · {str.coherenceMaxLabel}: — · {str.rsaLabel}: — ·{" "}
              {str.rsaNormalizedLabel}: — · {str.entryTimeLabel}: — · {str.rmssdLabel}: — ·{" "}
              {str.stressLabel}: —
            </Text>
          ) : (
            <>
              <Text style={styles.metricLine}>
                {str.coherenceAvgLabel}:{" "}
                {analysis?.coherenceAveragePercent != null
                  ? `${Math.round(analysis.coherenceAveragePercent)}%`
                  : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.coherenceMaxLabel}:{" "}
                {analysis?.coherenceMaxPercent != null ? `${Math.round(analysis.coherenceMaxPercent)}%` : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.rsaLabel}:{" "}
                {analysis?.rsaAmplitudeBpm != null ? `${Math.round(analysis.rsaAmplitudeBpm)} уд/мин` : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.rsaNormalizedLabel}:{" "}
                {analysis?.rsaNormalizedPercent != null
                  ? `${Math.round(analysis.rsaNormalizedPercent)} %`
                  : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.entryTimeLabel}: {analysis?.entryTimeSec != null ? `${analysis.entryTimeSec} с` : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.rmssdLabel}: {finalRmssdMs != null ? `${Math.round(finalRmssdMs)} мс` : "—"}
              </Text>
              <Text style={styles.metricLine}>
                {str.stressLabel}: {finalStressPercent != null ? `${Math.round(finalStressPercent)}%` : "—"}
              </Text>
            </>
          )}
          <Pressable onPress={() => exportJson()} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>{str.exportButton}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setPhase("idle");
              setSessionStartWallMs(null);
              setSessionStartLogicalMs(null);
              setAnalysis(null);
              setExportDebug(null);
              setFinalRmssdMs(null);
              setFinalStressPercent(null);
              setFinalPulseWasEmulated(false);
              setElapsedMs(0);
            }}
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Внешний экспортируемый экран: оборачивает в BiofeedbackProvider. */
export function CoherenceBreathScreen({ locale = "ru" }: { locale?: BreathLocale }) {
  return (
    <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
      <CoherenceBreathScreenInner locale={locale} />
    </BiofeedbackProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07080c" },
  idle: { flex: 1, padding: 24, justifyContent: "center" },
  idleTitle: { color: "#f1f5f9", fontSize: 22, fontWeight: "700", marginBottom: 12 },
  idleHint: { color: "#94a3b8", fontSize: 15, marginBottom: 12 },
  simNote: { color: "#94a3b8", fontSize: 13, marginBottom: 16 },
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
    paddingRight: 40,
  },
  instructionBlock: { alignItems: "center" },
  inhaleTitle: { color: "#f8fafc", fontSize: 42, fontWeight: "800", letterSpacing: 1 },
  secHint: { color: "#94a3b8", marginTop: 8, fontSize: 18 },
  results: { flex: 1, padding: 24, justifyContent: "center" },
  resultsTitle: { color: "#f8fafc", fontSize: 20, fontWeight: "700", marginBottom: 12 },
  approx: { color: "#fbbf24", marginBottom: 12, fontSize: 13 },
  warnBox: { color: "#fca5a5", fontSize: 12, marginBottom: 12 },
  debugMini: { color: "#64748b", fontSize: 11, marginBottom: 10, lineHeight: 15 },
  metricLine: { color: "#e2e8f0", fontSize: 16, marginBottom: 8 },
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
  qcDebugWrap: { gap: 2 },
  qcDebugText: { color: "#e2e8f0", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  qcDebugTextMuted: { color: "#94a3b8", fontSize: 11, lineHeight: 15 },
  ppgOverlayWrap: {
    position: "absolute",
    left: 20,
    right: 52,
    top: "12%",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  ppgOverlayText: {
    color: "#fbbf24",
    fontSize: 15,
    fontWeight: "normal",
    textAlign: "center",
    lineHeight: 21,
  },
  prepCountdownWrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: 20,
  },
  prepCountdownRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: "#22c55e",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(34,197,94,0.08)",
  },
  prepCountdownNum: {
    color: "#f8fafc",
    fontSize: 32,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  prepCountdownCaption: {
    color: "#94a3b8",
    marginLeft: 12,
    fontSize: 18,
    fontWeight: "600",
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,23,0.82)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 50,
  },
  dialogCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#0f172a",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1e293b",
    gap: 12,
  },
  dialogTitle: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  dialogMessage: {
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
});
