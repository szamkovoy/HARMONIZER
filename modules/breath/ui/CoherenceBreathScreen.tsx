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

import type { FingerSignalSnapshot } from "@/modules/biofeedback/core/types";
import { isFingerFrameProcessorAvailable } from "@/modules/biofeedback-finger-frame-processor/src";
import { getCoherenceBreathStrings, type BreathLocale } from "@/modules/breath/i18n/coherence";
import {
  COHERENCE_BEAT_DEDUPE_MS,
  COHERENCE_PREFLIGHT_BUFFER_MS,
  COHERENCE_QUALITY_WINDOW_MS,
  COHERENCE_WARMUP_MS,
} from "@/modules/breath/core/coherence-constants";
import { DEFAULT_COHERENCE_TEST_TIMING } from "@/modules/breath/core/types";
import { generateSimulatedBeatTimestamps } from "@/modules/breath/core/simulated-beats";
import {
  buildCoherenceExportJson,
  dedupeBeatTimestampsMs,
  runCoherenceSessionAnalysis,
  type CoherenceExportDebug,
  type CoherencePulseLogEntry,
  type CoherenceSessionResult,
  type CoherenceSessionTimeBase,
} from "@/modules/breath/core/coherence-session-analysis";
import { BreathBinduMandala } from "@/modules/breath/ui/BreathBinduMandala";
import { BreathFingerCapture } from "@/modules/breath/ui/BreathFingerCapture";

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

function NativeBreathFingerBridge({
  isActive,
  onSnapshot,
  fingerSessionKey,
}: {
  isActive: boolean;
  onSnapshot: (s: FingerSignalSnapshot) => void;
  fingerSessionKey: number;
}) {
  const VisionCamera = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const { useCameraPermission } = VisionCamera;
  const { hasPermission, requestPermission } = useCameraPermission();

  if (!isFingerFrameProcessorAvailable()) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.permissionText}>Нативный frame plugin недоступен — метрики будут по модели.</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.permissionText}>Нужен доступ к камере для ППГ.</Text>
        <Pressable onPress={() => void requestPermission()} style={styles.permissionBtn}>
          <Text style={styles.permissionBtnText}>Разрешить камеру</Text>
        </Pressable>
      </View>
    );
  }

  return <BreathFingerCapture key={fingerSessionKey} isActive={isActive} onSnapshot={onSnapshot} />;
}

function BreathSignalBars({
  values,
  tintColor,
}: {
  values: readonly number[];
  tintColor: string;
}) {
  const amplitude = Math.max(...values.map((value) => Math.abs(value)), 0.001);
  return (
    <View style={styles.signalBars}>
      {values.map((value, index) => {
        const normalized = Math.min(1, Math.max(0.14, Math.abs(value) / amplitude));
        return (
          <View
            key={`${index}-${value}`}
            style={[
              styles.signalBar,
              {
                height: `${normalized * 100}%`,
                opacity: value >= 0 ? 1 : 0.45,
                backgroundColor: tintColor,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function BreathOpticalStrip({
  snapshot,
  pulseLabel,
  opticalCaption,
  noSamplesHint,
}: {
  snapshot: FingerSignalSnapshot | null;
  pulseLabel: string;
  opticalCaption: string;
  noSamplesHint: string;
}) {
  const opticalBars = useMemo(
    () => snapshot?.opticalSamples.map((sample) => sample.value - snapshot.baseline) ?? [],
    [snapshot],
  );
  return (
    <View style={styles.opticalFooter}>
      <Text style={styles.opticalCaption}>{opticalCaption}</Text>
      {opticalBars.length > 0 ? (
        <BreathSignalBars values={opticalBars} tintColor="#ff8f9f" />
      ) : (
        <View style={styles.opticalPlaceholder}>
          <Text style={styles.opticalPlaceholderText}>{noSamplesHint}</Text>
        </View>
      )}
      {snapshot ? (
        <Text style={styles.opticalMeta}>
          {pulseLabel}: {Math.round(snapshot.pulseRateBpm)} уд/мин · кач. {(snapshot.signalQuality * 100).toFixed(0)}%
          {" · "}
          {snapshot.fingerDetected ? "палец" : "нет пальца"} · {snapshot.pulseLockState}
        </Text>
      ) : null}
    </View>
  );
}

export function CoherenceBreathScreen({ locale = "ru" }: { locale?: BreathLocale }) {
  const str = useMemo(() => getCoherenceBreathStrings(locale), [locale]);
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionStartMs, setSessionStartMs] = useState<number | null>(null);
  const [sessionEndMs, setSessionEndMs] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<CoherenceSessionResult | null>(null);
  const [exportDebug, setExportDebug] = useState<CoherenceExportDebug | null>(null);
  const [fingerSessionKey, setFingerSessionKey] = useState(0);
  const gongPlayedRef = useRef(false);
  /** Последний merged-массив из снимка (для UI/мета в debug). */
  const lastBeatsRef = useRef<number[]>([]);
  /**
   * Накопление меток ударов за текущую практику: в каждом снимке merged-массив — только скользящее окно (~12 с),
   * поэтому сюда каждый кадр добавляем snapshot.beatTimestampsMs и схлопываем дубликаты (COHERENCE_BEAT_DEDUPE_MS).
   * Иначе в анализ попадают только последние пики, хотя pulseLog показывает стабильный сигнал всю сессию.
   */
  const allSessionBeatsRef = useRef<number[]>([]);
  /** Метки из успешного 5-секундного QC — буфер для тахограммы до logical T=0. */
  const preflightBeatsRef = useRef<number[]>([]);
  const warmupWallStartRef = useRef<number | null>(null);
  const protocolWallStartRef = useRef<number | null>(null);
  const qcCameraStartRef = useRef<number | null>(null);
  const pulseLogRef = useRef<CoherencePulseLogEntry[]>([]);
  const lastPulseLogWallClockRef = useRef(0);
  const snapshotCallbacksTotalRef = useRef(0);
  const snapshotsWhileRunningRef = useRef(0);
  const lastSnapMetaRef = useRef({
    timestampMs: 0 as number | null,
    beatTimestampsMsLength: 0,
    detectedBeatCount: 0,
    pulseLockState: "searching" as FingerSignalSnapshot["pulseLockState"],
    fingerDetected: false,
  });
  /** Время кадра камеры в момент старта практики (см. нативный timestampMs в плагине — не Unix). */
  const practicePpgAnchorMsRef = useRef<number | null>(null);
  const lastCameraMsRunningRef = useRef<number | null>(null);
  const fingerAbsentAccumMsRef = useRef(0);
  const qualityBadAccumMsRef = useRef(0);
  /** Индекс секунды 0..119 относительно practice anchor: принудительный BPM = 0 на тахограмме. */
  const secondBpmForcedZeroRef = useRef<boolean[]>(new Array(PPG_SESSION_SECONDS).fill(false));
  const [ppgOverlayMessage, setPpgOverlayMessage] = useState<string | null>(null);
  const ppgBannerHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Уже показали баннер за текущий эпизод «нет пальца» (сброс при возврате контакта). */
  const fingerLostBannerShownThisEpisodeRef = useRef(false);
  /** Уже показали баннер за текущий эпизод «плохой сигнал» 2–7 с (сброс при восстановлении lock/SQ). */
  const weakSignalBannerShownThisEpisodeRef = useRef(false);
  const prevFingerDetectedForBannerRef = useRef(true);
  const prevBadSignalForBannerRef = useRef(false);
  const [calibrationSnapshot, setCalibrationSnapshot] = useState<FingerSignalSnapshot | null>(null);

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
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") {
      clearPpgBannerUi();
    }
  }, [phase, clearPpgBannerUi]);

  const instructionOpacity = useRef(new RNAnimated.Value(1)).current;
  const mandalaOpacity = useRef(new RNAnimated.Value(0)).current;

  const onFingerSnapshot = useCallback(
    (snapshot: FingerSignalSnapshot) => {
      snapshotCallbacksTotalRef.current += 1;
      if (phaseRef.current === "running") {
        snapshotsWhileRunningRef.current += 1;
      }
      lastBeatsRef.current = [...snapshot.beatTimestampsMs];
      if (
        !useSimulatedPpg &&
        (phaseRef.current === "warmup" ||
          phaseRef.current === "qualityCheck" ||
          phaseRef.current === "running")
      ) {
        let shouldMergeBeats = true;
        if (phaseRef.current === "running") {
          const anchor = practicePpgAnchorMsRef.current;
          const lastCam = lastCameraMsRunningRef.current;
          const camTs = snapshot.timestampMs;
          const delta = lastCam != null ? Math.max(0, camTs - lastCam) : 0;
          lastCameraMsRunningRef.current = camTs;

          if (anchor != null) {
            const badSignal =
              snapshot.pulseLockState === "searching" || snapshot.signalQuality < 0.5;

            if (!snapshot.fingerDetected) {
              fingerAbsentAccumMsRef.current += delta;
              qualityBadAccumMsRef.current = 0;
            } else {
              fingerAbsentAccumMsRef.current = 0;
              if (badSignal) {
                qualityBadAccumMsRef.current += delta;
              } else {
                qualityBadAccumMsRef.current = 0;
              }
            }

            const fingerJustReturned =
              snapshot.fingerDetected && !prevFingerDetectedForBannerRef.current;
            const signalJustRecovered =
              snapshot.fingerDetected && !badSignal && prevBadSignalForBannerRef.current;

            if (fingerJustReturned) {
              if (ppgBannerHideTimerRef.current != null) {
                clearTimeout(ppgBannerHideTimerRef.current);
                ppgBannerHideTimerRef.current = null;
              }
              setPpgOverlayMessage(null);
              fingerLostBannerShownThisEpisodeRef.current = false;
            }

            if (signalJustRecovered) {
              if (ppgBannerHideTimerRef.current != null) {
                clearTimeout(ppgBannerHideTimerRef.current);
                ppgBannerHideTimerRef.current = null;
              }
              setPpgOverlayMessage(null);
              weakSignalBannerShownThisEpisodeRef.current = false;
            }

            prevFingerDetectedForBannerRef.current = snapshot.fingerDetected;
            prevBadSignalForBannerRef.current = badSignal;

            const fingerOk = snapshot.fingerDetected;
            const qualitySustainedBad =
              fingerOk &&
              qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_B_MS &&
              (snapshot.pulseLockState === "searching" || snapshot.signalQuality < 0.5);
            shouldMergeBeats = fingerOk && !qualitySustainedBad;

            if (!shouldMergeBeats) {
              const sec = Math.min(
                PPG_SESSION_SECONDS - 1,
                Math.max(0, Math.floor((camTs - anchor) / 1000)),
              );
              secondBpmForcedZeroRef.current[sec] = true;
            }

            if (
              !snapshot.fingerDetected &&
              fingerAbsentAccumMsRef.current >= PPG_FINGER_LOST_OVERLAY_MS &&
              !fingerLostBannerShownThisEpisodeRef.current
            ) {
              fingerLostBannerShownThisEpisodeRef.current = true;
              if (ppgBannerHideTimerRef.current != null) {
                clearTimeout(ppgBannerHideTimerRef.current);
              }
              setPpgOverlayMessage(str.ppgFingerLostMessage);
              ppgBannerHideTimerRef.current = setTimeout(() => {
                setPpgOverlayMessage(null);
                ppgBannerHideTimerRef.current = null;
              }, PPG_BANNER_DISPLAY_MS);
            } else if (
              snapshot.fingerDetected &&
              badSignal &&
              qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_B_MS &&
              qualityBadAccumMsRef.current < PPG_QUALITY_GRADE_C_MS &&
              !weakSignalBannerShownThisEpisodeRef.current
            ) {
              weakSignalBannerShownThisEpisodeRef.current = true;
              if (ppgBannerHideTimerRef.current != null) {
                clearTimeout(ppgBannerHideTimerRef.current);
              }
              setPpgOverlayMessage(str.ppgWeakSignalMessage);
              ppgBannerHideTimerRef.current = setTimeout(() => {
                setPpgOverlayMessage(null);
                ppgBannerHideTimerRef.current = null;
              }, PPG_BANNER_DISPLAY_MS);
            }
          }
        }

        if (shouldMergeBeats) {
          allSessionBeatsRef.current = dedupeBeatTimestampsMs(
            [...allSessionBeatsRef.current, ...snapshot.beatTimestampsMs],
            COHERENCE_BEAT_DEDUPE_MS,
          );
        }
      }
      lastSnapMetaRef.current = {
        timestampMs: snapshot.timestampMs,
        beatTimestampsMsLength: snapshot.beatTimestampsMs.length,
        detectedBeatCount: snapshot.detectedBeatCount,
        pulseLockState: snapshot.pulseLockState,
        fingerDetected: snapshot.fingerDetected,
      };
      if (
        phaseRef.current === "warmup" ||
        phaseRef.current === "qualityCheck" ||
        phaseRef.current === "running"
      ) {
        setCalibrationSnapshot(snapshot);
      }

      if (phaseRef.current === "running") {
        const wall = Date.now();
        if (wall - lastPulseLogWallClockRef.current >= 500) {
          lastPulseLogWallClockRef.current = wall;
          pulseLogRef.current.push({
            cameraTimestampMs: snapshot.timestampMs,
            wallClockMs: wall,
            pulseRateBpm: snapshot.pulseRateBpm,
            signalQuality: snapshot.signalQuality,
            pulseReady: snapshot.pulseReady,
            fingerDetected: snapshot.fingerDetected,
            pulseLockState: snapshot.pulseLockState,
            beatTimestampsCount: snapshot.beatTimestampsMs.length,
          });
        }
      }

      if (phaseRef.current === "qualityCheck" && !useSimulatedPpg) {
        if (qcCameraStartRef.current == null) {
          qcCameraStartRef.current = snapshot.timestampMs;
        }
        const qcStart = qcCameraStartRef.current;
        if (snapshot.timestampMs < qcStart + COHERENCE_QUALITY_WINDOW_MS) {
          return;
        }
        const winEnd = qcStart + COHERENCE_QUALITY_WINDOW_MS;
        const beatsInWin = allSessionBeatsRef.current.filter((t) => t >= qcStart && t <= winEnd);
        const ok =
          snapshot.pulseLockState === "tracking" &&
          snapshot.signalQuality > 0.7 &&
          beatsInWin.length >= 3;
        if (ok) {
          preflightBeatsRef.current = dedupeBeatTimestampsMs(beatsInWin, COHERENCE_BEAT_DEDUPE_MS);
          practicePpgAnchorMsRef.current = winEnd;
          lastCameraMsRunningRef.current = null;
          fingerAbsentAccumMsRef.current = 0;
          qualityBadAccumMsRef.current = 0;
          secondBpmForcedZeroRef.current = new Array(PPG_SESSION_SECONDS).fill(false);
          clearPpgBannerUi();
          setSessionStartMs(Date.now());
          setElapsedMs(0);
          gongPlayedRef.current = false;
          setPhase("running");
        } else {
          qcCameraStartRef.current = snapshot.timestampMs;
        }
      }
    },
    [useSimulatedPpg, str.ppgFingerLostMessage, str.ppgWeakSignalMessage, clearPpgBannerUi],
  );

  useEffect(() => {
    if (phase !== "warmup" || useSimulatedPpg) {
      return;
    }
    const id = setInterval(() => {
      if (Date.now() - (warmupWallStartRef.current ?? 0) >= COHERENCE_WARMUP_MS) {
        qcCameraStartRef.current = null;
        setPhase("qualityCheck");
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, useSimulatedPpg]);

  useEffect(() => {
    if ((phase !== "warmup" && phase !== "qualityCheck") || useSimulatedPpg) {
      return;
    }
    const id = setInterval(() => {
      if (Date.now() - (protocolWallStartRef.current ?? 0) > COHERENCE_PROTOCOL_MAX_MS) {
        Alert.alert(str.calibrationTitle, str.calibrationTimeout);
        allSessionBeatsRef.current = [];
        setPhase("idle");
        setCalibrationSnapshot(null);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [phase, str.calibrationTimeout, str.calibrationTitle, useSimulatedPpg]);

  useEffect(() => {
    if (phase !== "running" || sessionStartMs == null) {
      return;
    }
    let id: ReturnType<typeof setInterval>;
    id = setInterval(() => {
      const e = Date.now() - sessionStartMs;
      setElapsedMs(Math.min(e, TIMING.totalMs));
      if (e < TIMING.totalMs) {
        return;
      }
      clearInterval(id);
      const wallEndMs = sessionStartMs + TIMING.totalMs;
      const anchor = practicePpgAnchorMsRef.current;
      const usePpgTimeline = !useSimulatedPpg && anchor != null;
      const sessionTimeBase: CoherenceSessionTimeBase = usePpgTimeline ? "cameraPresentationMs" : "unixEpochMs";
      const analysisStartMs = usePpgTimeline ? anchor : sessionStartMs;
      const analysisEndMs = usePpgTimeline ? anchor + TIMING.totalMs : wallEndMs;
      const rawBeats = [...allSessionBeatsRef.current];
      const beats = useSimulatedPpg
        ? generateSimulatedBeatTimestamps(sessionStartMs, wallEndMs)
        : rawBeats.filter(
            (t) =>
              t >= analysisStartMs - COHERENCE_PREFLIGHT_BUFFER_MS - 1 && t <= analysisEndMs + 1,
          );
      const rawBeatMinMs = rawBeats.length === 0 ? null : Math.min(...rawBeats);
      const rawBeatMaxMs = rawBeats.length === 0 ? null : Math.max(...rawBeats);
      const meta = lastSnapMetaRef.current;
      const res = runCoherenceSessionAnalysis({
        sessionStartedAtMs: analysisStartMs,
        sessionEndedAtMs: analysisEndMs,
        beatTimestampsMs: beats,
        inhaleMs: TIMING.inhaleMs,
        exhaleMs: TIMING.exhaleMs,
        mode: "test120s",
        bufferMsBeforeSession: useSimulatedPpg ? 0 : COHERENCE_PREFLIGHT_BUFFER_MS,
        secondBpmForcedZero: useSimulatedPpg ? undefined : [...secondBpmForcedZeroRef.current],
      });
      const finalRes =
        useSimulatedPpg ? { ...res, warnings: [...res.warnings, str.simulatedMetricsNote] } : res;
      const debug: CoherenceExportDebug = {
        fingerSessionKey,
        sessionTimeBase,
        practicePpgAnchorMs: anchor,
        wallClockSessionStartMs: sessionStartMs,
        snapshotCallbacksTotal: snapshotCallbacksTotalRef.current,
        snapshotsWhileRunning: snapshotsWhileRunningRef.current,
        lastSnapshotTimestampMs: meta.timestampMs,
        lastSnapshotBeatCount: meta.beatTimestampsMsLength,
        lastSnapshotDetectedBeatCount: meta.detectedBeatCount,
        lastSnapshotPulseLock: meta.pulseLockState,
        lastSnapshotFingerDetected: meta.fingerDetected,
        rawBeatArrayLengthBeforeFilter: rawBeats.length,
        beatsAfterDedupeMs: finalRes.beatTimestampsMsAnalyzed.length,
        rawBeatMinMs,
        rawBeatMaxMs,
        beatsAfterSessionWindowFilter: beats.length,
        analysisSessionStartMs: analysisStartMs,
        analysisSessionEndMs: analysisEndMs,
      };
      setExportDebug(debug);
      setAnalysis(finalRes);
      setSessionEndMs(wallEndMs);
      setPhase("results");
    }, UI_TICK_MS);
    return () => clearInterval(id);
  }, [phase, sessionStartMs, fingerSessionKey, str.simulatedMetricsNote]);

  useEffect(() => {
    if (phase !== "running" || sessionStartMs == null) {
      return;
    }
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
  }, [elapsedMs, instructionOpacity, mandalaOpacity, phase, sessionStartMs]);

  useEffect(() => {
    if (phase !== "running" || sessionStartMs == null) {
      return;
    }
    const at = TIMING.totalMs - TIMING.gongBeforeEndMs;
    if (elapsedMs >= at && !gongPlayedRef.current) {
      gongPlayedRef.current = true;
    }
  }, [elapsedMs, phase, sessionStartMs]);

  const { isInhale } = useBreathPhaseLabel(elapsedMs, TIMING.inhaleMs, TIMING.exhaleMs);

  const dimOpacity =
    phase === "running" && elapsedMs > TIMING.totalMs - TIMING.dimBeforeEndMs
      ? Math.min(
          1,
          (elapsedMs - (TIMING.totalMs - TIMING.dimBeforeEndMs)) / TIMING.dimBeforeEndMs,
        )
      : 0;

  const beginFromIdle = () => {
    practicePpgAnchorMsRef.current = null;
    lastCameraMsRunningRef.current = null;
    fingerAbsentAccumMsRef.current = 0;
    qualityBadAccumMsRef.current = 0;
    secondBpmForcedZeroRef.current = new Array(PPG_SESSION_SECONDS).fill(false);
    clearPpgBannerUi();
    preflightBeatsRef.current = [];
    allSessionBeatsRef.current = [];
    qcCameraStartRef.current = null;
    warmupWallStartRef.current = Date.now();
    protocolWallStartRef.current = Date.now();
    pulseLogRef.current = [];
    lastPulseLogWallClockRef.current = 0;
    snapshotCallbacksTotalRef.current = 0;
    snapshotsWhileRunningRef.current = 0;
    setFingerSessionKey((k) => k + 1);
    setExportDebug(null);
    lastBeatsRef.current = [];
    setCalibrationSnapshot(null);
    setAnalysis(null);
    setSessionEndMs(null);
    if (useSimulatedPpg) {
      const now = Date.now();
      practicePpgAnchorMsRef.current = now;
      setSessionStartMs(now);
      setElapsedMs(0);
      gongPlayedRef.current = false;
      setPhase("running");
      return;
    }
    setPhase("warmup");
    setSessionStartMs(null);
    setElapsedMs(0);
  };

  const exportJson = async () => {
    if (analysis == null || sessionStartMs == null || sessionEndMs == null) {
      return;
    }
    const anchor = practicePpgAnchorMsRef.current;
    const usePpgTimeline = !useSimulatedPpg && anchor != null;
    const analysisStartMs = usePpgTimeline ? anchor : sessionStartMs;
    const analysisEndMs = usePpgTimeline ? anchor + TIMING.totalMs : sessionEndMs;
    const raw = [...allSessionBeatsRef.current];
    const beats = useSimulatedPpg
      ? generateSimulatedBeatTimestamps(sessionStartMs, sessionEndMs)
      : raw.filter(
          (t) =>
            t >= analysisStartMs - COHERENCE_PREFLIGHT_BUFFER_MS - 1 && t <= analysisEndMs + 1,
        );
    const payload = buildCoherenceExportJson(
      {
        sessionStartedAtMs: analysisStartMs,
        sessionEndedAtMs: analysisEndMs,
        beatTimestampsMs: beats,
        inhaleMs: TIMING.inhaleMs,
        exhaleMs: TIMING.exhaleMs,
        mode: "test120s",
        bufferMsBeforeSession: useSimulatedPpg ? 0 : COHERENCE_PREFLIGHT_BUFFER_MS,
        secondBpmForcedZero: useSimulatedPpg ? undefined : [...secondBpmForcedZeroRef.current],
      },
      analysis,
      {
        dataSource: useSimulatedPpg ? "simulated" : "fingerPpg",
        debug: exportDebug ?? undefined,
        pulseLog:
          useSimulatedPpg ? undefined : pulseLogRef.current.filter((p) => p.wallClockMs >= sessionStartMs),
      },
    );
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
  };

  const centerInstruction = (
    <View style={styles.instructionBlock}>
      <Text style={styles.inhaleTitle}>{isInhale ? str.inhale : str.exhale}</Text>
      <Text style={styles.secHint}>{((isInhale ? TIMING.inhaleMs : TIMING.exhaleMs) / 1000).toFixed(0)} с</Text>
    </View>
  );

  const cameraActive = phase === "warmup" || phase === "qualityCheck" || phase === "running";

  const practiceOpticalFooter = useMemo(() => {
    if (phase !== "running") {
      return null;
    }
    if (useSimulatedPpg) {
      return (
        <View style={styles.opticalFooter}>
          <Text style={styles.opticalCaption}>{str.opticalSimulatedNote}</Text>
        </View>
      );
    }
    return (
      <BreathOpticalStrip
        snapshot={calibrationSnapshot}
        pulseLabel={str.calibrationPulse}
        opticalCaption={str.opticalSeriesCaption}
        noSamplesHint={str.opticalNoSamples}
      />
    );
  }, [phase, useSimulatedPpg, calibrationSnapshot, str]);

  return (
    <SafeAreaView style={styles.safe}>
      {!isExpoGo && !useSimulatedPpg ? (
        <NativeBreathFingerBridge
          fingerSessionKey={fingerSessionKey}
          isActive={cameraActive}
          onSnapshot={onFingerSnapshot}
        />
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
          {calibrationSnapshot ? (
            <View style={styles.calibPill}>
              <Text style={styles.calibPillText}>
                {str.calibrationPulse}: {Math.round(calibrationSnapshot.pulseRateBpm)} уд/мин · кач.{" "}
                {(calibrationSnapshot.signalQuality * 100).toFixed(0)}%
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => {
              setPhase("idle");
              setCalibrationSnapshot(null);
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "qualityCheck" ? (
        <View style={styles.calib}>
          <Text style={styles.calibTitle}>{str.qualityCheckTitle}</Text>
          <Text style={styles.calibHint}>{str.qualityCheckHint}</Text>
          <Text style={styles.calibStatus}>{str.qualityCheckWait}</Text>
          {calibrationSnapshot ? (
            <View style={styles.calibPill}>
              <Text style={styles.calibPillText}>
                {str.calibrationPulse}: {Math.round(calibrationSnapshot.pulseRateBpm)} уд/мин · кач.{" "}
                {(calibrationSnapshot.signalQuality * 100).toFixed(0)}% · {calibrationSnapshot.pulseLockState}
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => {
              setPhase("idle");
              setCalibrationSnapshot(null);
            }}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>{str.backButton}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === "running" ? (
        <BreathPracticeShell
          isBreathTimingActive
          breathSessionStartMs={sessionStartMs}
          inhaleMs={TIMING.inhaleMs}
          exhaleMs={TIMING.exhaleMs}
          dimOpacity={dimOpacity}
          footer={practiceOpticalFooter}
          center={
            <View style={styles.centerStack}>
              <RNAnimated.View style={[styles.mandalaWrap, { opacity: mandalaOpacity }]}>
                <BreathBinduMandala isActive />
              </RNAnimated.View>
              <RNAnimated.View style={[styles.instructionWrap, { opacity: instructionOpacity }]} pointerEvents="none">
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
            {sessionStartMs != null && sessionEndMs != null
              ? ((sessionEndMs - sessionStartMs) / 1000).toFixed(0)
              : "—"}{" "}
            с
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
              setSessionStartMs(null);
              setSessionEndMs(null);
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
  mandalaWrap: {
    ...StyleSheet.absoluteFillObject,
  },
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
  permissionBox: { padding: 16 },
  permissionText: { color: "#cbd5e1", marginBottom: 8 },
  permissionBtn: { alignSelf: "flex-start", backgroundColor: "#334155", padding: 12, borderRadius: 8 },
  permissionBtnText: { color: "#f8fafc", fontWeight: "600" },
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
  signalBars: {
    height: 72,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  signalBar: {
    flex: 1,
    minHeight: 8,
    borderRadius: 999,
  },
  opticalPlaceholder: {
    minHeight: 72,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  opticalPlaceholderText: {
    color: "rgba(228, 232, 255, 0.58)",
    fontSize: 12,
    fontWeight: "600",
  },
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
