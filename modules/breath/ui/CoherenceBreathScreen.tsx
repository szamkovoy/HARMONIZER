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
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { SimulatedSensorSource } from "@/modules/biofeedback/sensors/SimulatedSensorSource";

import {
  COHERENCE_PREFLIGHT_BUFFER_MS,
  COHERENCE_QUALITY_WINDOW_MS,
  COHERENCE_WARMUP_MS,
} from "@/modules/breath/core/coherence-constants";
import { DEFAULT_COHERENCE_TEST_TIMING } from "@/modules/breath/core/types";
import { getCoherenceBreathStrings, type BreathLocale } from "@/modules/breath/i18n/coherence";
import type {
  CoherenceExportDebug,
  CoherencePulseLogEntry,
  CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";
import { BreathBinduMandala } from "@/modules/breath/ui/BreathBinduMandala";

import { BreathPracticeShell, useBreathPhaseLabel } from "./BreathPracticeShell";

const TIMING = DEFAULT_COHERENCE_TEST_TIMING;
/** Максимум времени в прогреве + QC до отмены (защита от зависания). */
const COHERENCE_PROTOCOL_MAX_MS = 180_000;
const UI_TICK_MS = 500;
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
  const coherenceLast = useBiofeedbackChannel("coherence");
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionStartWallMs, setSessionStartWallMs] = useState<number | null>(null);
  const [sessionStartLogicalMs, setSessionStartLogicalMs] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<CoherenceSessionResult | null>(null);
  const [exportDebug, setExportDebug] = useState<CoherenceExportDebug | null>(null);
  const [sourceKey, setSourceKey] = useState(0);
  /** Уникальный счётчик «сессий PPG» для legacy совместимости в debug-метаполях. */
  const fingerSessionKey = sourceKey;

  const warmupStartedAtMs = useRef<number | null>(null);
  const protocolStartedAtMs = useRef<number | null>(null);
  const qcStartLogicalMsRef = useRef<number | null>(null);
  const pulseLogRef = useRef<CoherencePulseLogEntry[]>([]);
  const lastPulseLogWallClockRef = useRef(0);
  const snapshotCallbacksTotalRef = useRef(0);
  const snapshotsWhileRunningRef = useRef(0);

  /** Маска секунд практики, в которые сигнал был некачественным → BPM=0 на тахограмме. */
  const qualityBadAccumMsRef = useRef(0);
  const fingerAbsentAccumMsRef = useRef(0);
  const lastSampleMsRef = useRef<number | null>(null);

  /** Обратный отсчёт окна QC (секунды по времени камеры); `null` — ждём первую метку. */
  const [qcSecondsLeft, setQcSecondsLeft] = useState<number | null>(null);

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

  // ─── Подписка на pulseBpm для счёта QC окна и pulseLog ────────────────────

  useEffect(() => {
    return bus.subscribe("pulseBpm", (event) => {
      snapshotCallbacksTotalRef.current += 1;
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

  // ─── QC окно 5 с (camera time) ────────────────────────────────────────────

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
        .getMergedBeats()
        .filter((t) => t >= qcStart && t <= winEnd);
      const snap = snapshotRef.current;
      const ok =
        snap.pulseLockState === "tracking" &&
        snap.signalQuality > 0.7 &&
        beatsInWin.length >= 3;
      if (ok) {
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
        qcStartLogicalMsRef.current = camTs;
      }
    }, 250);
    return () => {
      clearInterval(id);
      setQcSecondsLeft(null);
    };
  }, [phase, pipeline, clearPpgBannerUi]);

  // ─── Running: добавляем удары в CoherenceEngine + ведём баннеры качества ─

  useEffect(() => {
    if (phase !== "running" || useSimulatedPpg) return;
    const id = setInterval(() => {
      const now = pipeline.getLastSourceTimestampMs();
      if (now <= 0) return;
      pipeline.getCoherenceEngine().appendBeats(pipeline.getMergedBeats());

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
      const sessionBeats = pipeline.getCoherenceEngine().getSessionBeats();
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
      };
      setExportDebug(debug);
      setAnalysis(finalRes);
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

  const { isInhale } = useBreathPhaseLabel(elapsedMs, TIMING.inhaleMs, TIMING.exhaleMs);

  const dimOpacity =
    phase === "running" && elapsedMs > TIMING.totalMs - TIMING.dimBeforeEndMs
      ? Math.min(
          1,
          (elapsedMs - (TIMING.totalMs - TIMING.dimBeforeEndMs)) / TIMING.dimBeforeEndMs,
        )
      : 0;

  const beginFromIdle = useCallback(() => {
    pipeline.softReset();
    pipeline.getCoherenceEngine().reset();
    qcStartLogicalMsRef.current = null;
    qualityBadAccumMsRef.current = 0;
    fingerAbsentAccumMsRef.current = 0;
    lastSampleMsRef.current = null;
    pulseLogRef.current = [];
    lastPulseLogWallClockRef.current = 0;
    snapshotCallbacksTotalRef.current = 0;
    snapshotsWhileRunningRef.current = 0;
    setSourceKey((k) => k + 1);
    setExportDebug(null);
    setAnalysis(null);
    setSessionStartLogicalMs(null);
    clearPpgBannerUi();

    if (useSimulatedPpg) {
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
  }, [pipeline, clearPpgBannerUi]);

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

  const centerInstruction = (
    <View style={styles.instructionBlock}>
      <Text style={styles.inhaleTitle}>{isInhale ? str.inhale : str.exhale}</Text>
      <Text style={styles.secHint}>{((isInhale ? TIMING.inhaleMs : TIMING.exhaleMs) / 1000).toFixed(0)} с</Text>
    </View>
  );

  const cameraActive = phase === "warmup" || phase === "qualityCheck" || phase === "running";

  const liveCoherencePercent = coherenceLast?.currentPercent ?? null;

  const practiceFooter = useMemo(() => {
    if (phase !== "running") return null;
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
          {liveCoherencePercent != null ? ` · когерентность ${Math.round(liveCoherencePercent)}%` : ""}
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
    str,
  ]);

  return (
    <SafeAreaView style={styles.safe}>
      {!isExpoGo && !useSimulatedPpg ? (
        <FingerPpgCameraSource key={`finger-${sourceKey}`} isActive={cameraActive} />
      ) : null}
      {useSimulatedPpg ? (
        <SimulatedSensorSource key={`sim-${sourceKey}`} isActive={cameraActive} />
      ) : null}

      {phase === "idle" ? (
        <View style={styles.idle}>
          <Text style={styles.idleTitle}>{str.practiceTitle}</Text>
          <Text style={styles.idleHint}>{str.fingerHint}</Text>
          {useSimulatedPpg ? <Text style={styles.simNote}>{str.simulatedMetricsNote}</Text> : null}
          <Pressable onPress={beginFromIdle} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{str.startButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "warmup" ? (
        <View style={styles.calib}>
          <Text style={styles.calibTitle}>{str.warmupTitle}</Text>
          <Text style={styles.calibHint}>{str.warmupHint}</Text>
          <Text style={styles.calibStatus}>{str.calibrationWait}</Text>
          <View style={styles.calibPill}>
            <Text style={styles.calibPillText}>
              {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач.{" "}
              {(snapshot.signalQuality * 100).toFixed(0)}%
            </Text>
          </View>
          <Pressable onPress={() => setPhase("idle")} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "qualityCheck" ? (
        <View style={styles.calib}>
          <Text style={styles.calibTitle}>{str.qualityCheckTitle}</Text>
          <Text style={styles.calibHint}>{str.qualityCheckHint}</Text>
          <Text style={styles.calibStatus}>
            {qcSecondsLeft === null ? str.qualityCheckWaitingTimebase : str.qualityCheckCountdown(qcSecondsLeft)}
          </Text>
          <View style={styles.calibPill}>
            <Text style={styles.calibPillText}>
              {str.calibrationPulse}: {Math.round(snapshot.pulseRateBpm || 0)} уд/мин · кач.{" "}
              {(snapshot.signalQuality * 100).toFixed(0)}% · {snapshot.pulseLockState}
            </Text>
          </View>
          <Pressable onPress={() => setPhase("idle")} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "running" ? (
        <BreathPracticeShell
          isBreathTimingActive
          breathSessionStartMs={sessionStartWallMs}
          inhaleMs={TIMING.inhaleMs}
          exhaleMs={TIMING.exhaleMs}
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
});
