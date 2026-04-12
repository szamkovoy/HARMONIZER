import Constants from "expo-constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { AppState, Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";

import {
  analyzeFingerRoi,
  isFingerFrameProcessorAvailable,
  type FingerFrameProcessorResult,
} from "@/modules/biofeedback-finger-frame-processor/src";
import {
  FingerSignalAnalyzer,
  toFingerBiofeedbackFrame,
} from "@/modules/biofeedback/core/finger-analysis";
import { FingerMeasurementSessionPanel } from "@/modules/biofeedback/ui/FingerMeasurementSessionPanel";
import { createSimulatedBiofeedbackFrame } from "@/modules/biofeedback/core/simulated";
import {
  FACE_CAMERA_CAPTURE_CONFIG,
  FINGER_CAMERA_CAPTURE_CONFIG,
  type BiofeedbackCaptureConfig,
  type BiofeedbackFrame,
  type FingerSignalSnapshot,
} from "@/modules/biofeedback/core/types";

type ProbeSource = "fingerCamera" | "faceCamera";

type NativeFrameStats = {
  width: number;
  height: number;
  pixelFormat: string;
  processedFrames: number;
};

function useElapsedSeconds(isActive: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      startedAtRef.current = null;
      return;
    }

    const tick = (timestamp: number) => {
      if (startedAtRef.current === null) {
        startedAtRef.current = timestamp;
      }
      setElapsedSeconds((timestamp - startedAtRef.current) / 1000);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [isActive]);

  return elapsedSeconds;
}

function formatOneDecimal(value: number) {
  return value.toFixed(1);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatWindowStatus(currentSeconds: number, targetSeconds: number) {
  return `${Math.min(targetSeconds, Math.max(0, Math.floor(currentSeconds)))}/${targetSeconds}s`;
}

/** Показ фиксированных session-значений после снятия пальца — даже если rmssdReady/stressReady сброшены. */
function probeHrvShowSessionSnapshot(snapshot: FingerSignalSnapshot): boolean {
  return snapshot.hrvSessionEndCaptured && !snapshot.fingerDetected;
}

function shouldShowProbeRmssdValue(snapshot: FingerSignalSnapshot): boolean {
  return snapshot.rmssdReady || probeHrvShowSessionSnapshot(snapshot);
}

function shouldShowProbeStressValue(snapshot: FingerSignalSnapshot): boolean {
  return snapshot.stressReady || probeHrvShowSessionSnapshot(snapshot);
}

function formatProbeHrvRmssd(snapshot: FingerSignalSnapshot): string {
  if (probeHrvShowSessionSnapshot(snapshot)) {
    const approx = snapshot.hrvRmssdApproximate ? " (approx.)" : "";
    return `${formatOneDecimal(snapshot.hrvSessionEndInitialRmssdMs)} → ${formatOneDecimal(snapshot.hrvSessionEndFinalRmssdMs)} ms (session)${approx}`;
  }
  if (!snapshot.rmssdReady) {
    return `${snapshot.hrvEligibleBeatCount}/${snapshot.hrvMinDisplayEligibleBeats} beats`;
  }
  if (snapshot.hrvShowInitialFinal) {
    const approx = snapshot.hrvRmssdApproximate ? " (approx.)" : "";
    return `${formatOneDecimal(snapshot.hrvInitialRmssdMs)} → ${formatOneDecimal(snapshot.hrvFinalRmssdMs)} ms${approx}`;
  }
  const tag = snapshot.hrvRmssdApproximate ? "~ " : "";
  return `${tag}${formatOneDecimal(snapshot.rmssdMs)} ms`;
}

function formatProbeStress(snapshot: FingerSignalSnapshot): string {
  if (probeHrvShowSessionSnapshot(snapshot)) {
    const approx = snapshot.hrvStressApproximate ? " (approx.)" : "";
    return `${formatOneDecimal(snapshot.hrvSessionEndInitialStressIndex)} → ${formatOneDecimal(snapshot.hrvSessionEndFinalStressIndex)} / 100 (session)${approx}`;
  }
  if (!snapshot.stressReady) {
    return `${snapshot.hrvEligibleBeatCount}/${snapshot.hrvMinDisplayEligibleBeats} beats`;
  }
  if (snapshot.hrvShowInitialFinal) {
    const approx = snapshot.hrvStressApproximate ? " (approx.)" : "";
    return `${formatOneDecimal(snapshot.hrvInitialStressIndex)} → ${formatOneDecimal(snapshot.hrvFinalStressIndex)} / 100${approx}`;
  }
  const tag = snapshot.hrvStressApproximate ? "~ " : "";
  return `${tag}${formatOneDecimal(snapshot.stressIndex)} / 100`;
}

function formatNumberList(values: readonly number[], suffix = "", limit = 10) {
  if (values.length === 0) {
    return "[]";
  }

  const visibleValues = values.slice(-limit).map((value) => `${Math.round(value)}${suffix}`);
  return values.length > limit ? `... ${visibleValues.join(", ")}` : visibleValues.join(", ");
}

function formatPeakReasonSummary(snapshot: FingerSignalSnapshot | null) {
  if (!snapshot || snapshot.rejectedPeaks.length === 0) {
    return "none";
  }

  const counts = new Map<string, number>();
  for (const peak of snapshot.rejectedPeaks) {
    counts.set(peak.reasonCode, (counts.get(peak.reasonCode) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([reasonCode, count]) => `${reasonCode}:${count}`)
    .join(", ");
}

function ProgressBar({ value, tintColor }: { value: number; tintColor: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.min(Math.max(value, 0), 1) * 100}%`, backgroundColor: tintColor }]} />
    </View>
  );
}

function SignalBars({
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

export function BiofeedbackProbeScreen() {
  const isExpoGo = Constants.executionEnvironment === "storeClient";
  return isExpoGo ? <ExpoGoProbeScreen /> : <NativeProbeScreen />;
}

function ExpoGoProbeScreen() {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [source, setSource] = useState<ProbeSource>("fingerCamera");
  const [torchEnabled, setTorchEnabled] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchArmed, setTorchArmed] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const isRenderActive = isFocused && appState === "active";
  const elapsedSeconds = useElapsedSeconds(isRenderActive);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setCameraReady(false);
    setTorchArmed(false);
  }, [source, isRenderActive]);

  useEffect(() => {
    if (!isRenderActive || source !== "fingerCamera" || !torchEnabled || !cameraReady) {
      setTorchArmed(false);
      return;
    }

    const timeout = setTimeout(() => {
      setTorchArmed(true);
    }, 350);

    return () => clearTimeout(timeout);
  }, [cameraReady, isRenderActive, source, torchEnabled]);

  const captureConfig: BiofeedbackCaptureConfig =
    source === "fingerCamera" ? FINGER_CAMERA_CAPTURE_CONFIG : FACE_CAMERA_CAPTURE_CONFIG;
  const simulatedFrame = useMemo(
    () => createSimulatedBiofeedbackFrame(elapsedSeconds, source),
    [elapsedSeconds, source],
  );
  const hasPermission = permission?.granted ?? false;
  const cameraFacing = source === "faceCamera" ? "front" : "back";
  const shouldEnableTorch = source === "fingerCamera" && torchEnabled && torchArmed;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>BIOFEEDBACK PROBE</Text>
          <Text style={styles.title}>Expo Probe</Text>
          <Text style={styles.subtitle}>
            Первый безопасный probe-экран для проверки UX камеры, разрешений, света и torch. Важно: в
            `expo-camera` здесь нет raw frame access, поэтому waveform/PPG пока не извлекается.
          </Text>
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Важно: метрики ниже пока не реальные</Text>
          <Text style={styles.warningText}>
            Текущие `pulse`, `breath`, `RMSSD` и `stress` на этом экране симулированы. Камера сейчас используется
            только для проверки preview UX, finger/face режима, разрешений и torch. По этому экрану пока нельзя
            судить о реальном качестве распознавания пульса или дыхания.
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Native path уже подключен в проект</Text>
          <Text style={styles.infoText}>
            Этот экран работает как Expo fallback. После установки dev build тот же маршрут откроется уже в native
            режиме через `VisionCamera` и начнет показывать настоящий frame-processing scaffold.
          </Text>
        </View>

        <View style={styles.segmentRow}>
          <Pressable
            onPress={() => setSource("fingerCamera")}
            style={[styles.segmentButton, source === "fingerCamera" && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentLabel, source === "fingerCamera" && styles.segmentLabelActive]}>Finger</Text>
          </Pressable>
          <Pressable
            onPress={() => setSource("faceCamera")}
            style={[styles.segmentButton, source === "faceCamera" && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentLabel, source === "faceCamera" && styles.segmentLabelActive]}>Face</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Camera Preview</Text>
          <Text style={styles.cardHint}>
            {source === "fingerCamera"
              ? "Положите палец на основную камеру. Torch включается для UX-проверки finger PPG режима."
              : "Посмотрите во фронтальную камеру при хорошем ровном свете. Здесь проверяем face rPPG UX-контур."}
          </Text>

          {!hasPermission ? (
            <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Разрешить камеру</Text>
            </Pressable>
          ) : (
            <>
              <View style={styles.cameraFrame}>
                {isRenderActive ? (
                  <CameraView
                    style={styles.camera}
                    facing={cameraFacing}
                    enableTorch={shouldEnableTorch}
                    active={isRenderActive}
                    onCameraReady={() => {
                      setCameraReady(true);
                    }}
                  />
                ) : (
                  <View style={[styles.camera, styles.cameraPlaceholder]}>
                    <Text style={styles.cameraPlaceholderText}>Preview paused</Text>
                  </View>
                )}
                <View style={styles.cameraOverlay}>
                  <Text style={styles.cameraOverlayText}>
                    {source === "fingerCamera"
                      ? "ROI сейчас conceptual: finger probe"
                      : "ROI сейчас conceptual: face probe"}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => setTorchEnabled((current) => !current)}
                  disabled={source !== "fingerCamera"}
                  style={[
                    styles.secondaryButton,
                    source !== "fingerCamera" && styles.secondaryButtonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {shouldEnableTorch ? "Torch On" : "Torch Off"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Probe Status</Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Source</Text>
              <Text style={styles.metricValue}>{source === "fingerCamera" ? "Finger Camera" : "Face Camera"}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Target FPS</Text>
              <Text style={styles.metricValue}>{captureConfig.targetFps}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Torch</Text>
              <Text style={styles.metricValue}>
                {captureConfig.requiresTorch
                  ? shouldEnableTorch
                    ? "Requested after camera ready"
                    : torchEnabled
                      ? "Waiting for camera ready"
                      : "Disabled"
                  : "Not needed"}
              </Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Raw Frames</Text>
              <Text style={styles.metricValue}>Unavailable in Expo probe</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Camera Ready</Text>
              <Text style={styles.metricValue}>{cameraReady ? "Yes" : "No"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Simulated Contract Preview</Text>
          <Text style={styles.cardHint}>
            Ниже не реальные camera-данные, а временный preview того bio-contract, который потом уйдет в `MANDALA`
            и `BREATH`. Это полезно для UX и интеграции, пока настоящий sensor backend не подключен.
          </Text>

          <View style={styles.metricGrid}>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Simulated Pulse</Text>
              <Text style={styles.metricValue}>{formatOneDecimal(simulatedFrame.pulseRateBpm)} bpm</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Simulated Breath</Text>
              <Text style={styles.metricValue}>{formatOneDecimal(simulatedFrame.breathRateBpm)} bpm</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Simulated RMSSD</Text>
              <Text style={styles.metricValue}>{formatOneDecimal(simulatedFrame.rmssdMs)} ms</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Simulated Stress</Text>
              <Text style={styles.metricValue}>{formatOneDecimal(simulatedFrame.stressIndex)} / 100</Text>
            </View>
          </View>

          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Pulse Phase</Text>
            <ProgressBar value={simulatedFrame.pulsePhase} tintColor="#ff8f9f" />
          </View>
          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Breath Phase</Text>
            <ProgressBar value={simulatedFrame.breathPhase} tintColor="#7bd8ff" />
          </View>
          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Signal Quality</Text>
            <ProgressBar value={simulatedFrame.signalQuality} tintColor="#8cffc8" />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next Step</Text>
          <Text style={styles.cardHint}>
            Expo уже выполнил свою UX-роль. Следующий шаг для настоящего сигнала - dev build и native frame access.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NativeProbeScreen() {
  const VisionCamera = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const WorkletsCore = require("react-native-worklets-core") as typeof import("react-native-worklets-core");
  const { Camera, useCameraPermission, useCameraDevice, useFrameProcessor, runAtTargetFps } = VisionCamera;
  const { Worklets } = WorkletsCore;

  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [source, setSource] = useState<ProbeSource>("fingerCamera");
  const [torchEnabled, setTorchEnabled] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchArmed, setTorchArmed] = useState(false);
  const [frameStats, setFrameStats] = useState<NativeFrameStats>({
    width: 0,
    height: 0,
    pixelFormat: "unknown",
    processedFrames: 0,
  });
  const [fingerSnapshot, setFingerSnapshot] = useState<FingerSignalSnapshot | null>(null);
  const [liveContractFrame, setLiveContractFrame] = useState<BiofeedbackFrame | null>(null);
  const analyzerRef = useRef<FingerSignalAnalyzer | null>(new FingerSignalAnalyzer(FINGER_CAMERA_CAPTURE_CONFIG));
  const { hasPermission, requestPermission } = useCameraPermission();
  const isRenderActive = isFocused && appState === "active";
  const elapsedSeconds = useElapsedSeconds(isRenderActive);
  const isFingerPluginAvailable = isFingerFrameProcessorAvailable();
  const cameraSessionReady = cameraReady || frameStats.processedFrames > 0;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    setCameraReady(false);
    setTorchArmed(false);
    setFingerSnapshot(null);
    setLiveContractFrame(null);
    analyzerRef.current = source === "fingerCamera" ? new FingerSignalAnalyzer(FINGER_CAMERA_CAPTURE_CONFIG) : null;
    setFrameStats({
      width: 0,
      height: 0,
      pixelFormat: "unknown",
      processedFrames: 0,
    });
  }, [source, isRenderActive]);

  useEffect(() => {
    if (!isRenderActive || source !== "fingerCamera" || !torchEnabled || !cameraSessionReady) {
      setTorchArmed(false);
      return;
    }

    const timeout = setTimeout(() => {
      setTorchArmed(true);
    }, 250);

    return () => clearTimeout(timeout);
  }, [cameraSessionReady, isRenderActive, source, torchEnabled]);

  const captureConfig: BiofeedbackCaptureConfig =
    source === "fingerCamera" ? FINGER_CAMERA_CAPTURE_CONFIG : FACE_CAMERA_CAPTURE_CONFIG;
  const simulatedFrame = useMemo(
    () => createSimulatedBiofeedbackFrame(elapsedSeconds, source),
    [elapsedSeconds, source],
  );
  const contractFrame = liveContractFrame ?? simulatedFrame;
  const position = source === "faceCamera" ? "front" : "back";
  const device = useCameraDevice(
    position,
    source === "fingerCamera" ? { physicalDevices: ["wide-angle-camera"] } : undefined,
  );
  const shouldEnableTorch =
    source === "fingerCamera" && torchEnabled && torchArmed && Boolean(device?.hasTorch);
  const opticalBars = useMemo(
    () => fingerSnapshot?.opticalSamples.map((sample) => sample.value - fingerSnapshot.baseline) ?? [],
    [fingerSnapshot],
  );

  const handleNativeFrame = useCallback(
    (
      width: number,
      height: number,
      pixelFormat: string | undefined,
      fingerSample: FingerFrameProcessorResult | null,
    ) => {
      setFrameStats((current) => ({
        width,
        height,
        pixelFormat: pixelFormat ?? current.pixelFormat,
        processedFrames: current.processedFrames + 1,
      }));
      setCameraReady(true);

      if (source !== "fingerCamera" || fingerSample == null) {
        return;
      }

      if (analyzerRef.current == null) {
        analyzerRef.current = new FingerSignalAnalyzer(FINGER_CAMERA_CAPTURE_CONFIG);
      }

      const snapshot = analyzerRef.current.push(fingerSample);
      setFingerSnapshot(snapshot);

      const hasUsablePulseWindow =
        snapshot.fingerDetected &&
        snapshot.pulseReady &&
        snapshot.pulseRateBpm >= captureConfig.minPulseBpm &&
        snapshot.pulseRateBpm <= captureConfig.maxPulseBpm &&
        snapshot.sampleCount >= 28 &&
        snapshot.opticalSamples.length >= 24;
      const nextLiveContractFrame =
        hasUsablePulseWindow &&
        ((snapshot.signalQuality >= 0.5 && snapshot.pulseLockConfidence >= 0.58) ||
          (snapshot.pulseLockState === "holding" && snapshot.pulseLockConfidence >= 0.24))
          ? toFingerBiofeedbackFrame(snapshot)
          : null;

      setLiveContractFrame(nextLiveContractFrame);
    },
    [captureConfig.maxPulseBpm, captureConfig.minPulseBpm, source],
  );

  const reportNativeFrame = Worklets.createRunOnJS(handleNativeFrame);

  const handleNewFingerMeasurement = useCallback(() => {
    /** Не пересоздаём анализатор: иначе обнуляется накопитель HRV и ломается экспорт RMSSD-диагностики после замера. */
    setFingerSnapshot(null);
    setLiveContractFrame(null);
  }, []);

  const handleExportRmssdHampelDiagnostics = useCallback(async () => {
    const analyzer = analyzerRef.current;
    if (analyzer == null) {
      Alert.alert("Нет анализатора", "Используется режим finger camera.");
      return;
    }
    const payload = analyzer.getPracticeRmssdHampelDiagnostics();
    if (payload == null) {
      Alert.alert(
        "Нет данных",
        "Нужна хотя бы одна успешная серия: не меньше 30 валидных ударов в накопителе HRV после калибровки. Подождите накопления в пробы или откройте экран после замера без «Нового замера» до экспорта. После сброса сессии доступен кэш последнего расчёта, если он уже был.",
      );
      return;
    }
    try {
      const json = JSON.stringify(payload, null, 2);
      const base = cacheDirectory;
      if (base == null) {
        Alert.alert("Файлы", "Каталог кэша недоступен на этой платформе.");
        return;
      }
      const path = `${base}hrv-rmssd-hampel-diag-${payload.exportedAtMs}.json`;
      await writeAsStringAsync(path, json);
      const title = "Диагностика RMSSD (классика vs пайплайн)";
      if (Platform.OS === "android") {
        const contentUri = await getContentUriAsync(path);
        await Share.share({
          title,
          message: "hrv-rmssd-hampel-diag.json",
          url: contentUri,
        });
      } else {
        const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
        await Share.share({
          title,
          url: fileUrl,
        });
      }
    } catch (error: unknown) {
      Alert.alert("Ошибка экспорта", String(error));
    }
  }, []);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      runAtTargetFps(30, () => {
        "worklet";
        const fingerSample =
          source === "fingerCamera"
            ? analyzeFingerRoi(frame, {
                roiScale: 0.34,
                sampleStride: 4,
              })
            : null;
        reportNativeFrame(frame.width, frame.height, frame.pixelFormat, fingerSample);
      });
    },
    [reportNativeFrame, source],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>BIOFEEDBACK PROBE</Text>
          <Text style={styles.title}>Native Probe</Text>
          <Text style={styles.subtitle}>
            Этот маршрут уже использует `VisionCamera`. В `fingerCamera` сюда теперь подключен первый live ROI analyzer:
            он читает центральный patch кадра, строит optical series и включает fallback только если quality gate не
            пройден.
          </Text>
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>
            {isFingerPluginAvailable
              ? "Finger ROI analyzer подключен, face path пока scaffold-only"
              : "Vision frame plugin не загрузился, probe уйдет в fallback"}
          </Text>
          <Text style={styles.warningText}>
            {isFingerPluginAvailable
              ? "Сейчас реальный live-signal собирается только для `fingerCamera`. `FaceCamera` остается scaffold-режимом, а contract-card ниже мягко откатывается на simulation, если палец, свет или torch не дают стабильный сигнал."
              : "Native preview и frame stats все еще полезны, но без локального frame plugin реальный finger ROI анализ не запустится. В этом случае экран сохранит simulated fallback и не будет притворяться настоящим измерением."}
          </Text>
        </View>

        <View style={styles.segmentRow}>
          <Pressable
            onPress={() => setSource("fingerCamera")}
            style={[styles.segmentButton, source === "fingerCamera" && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentLabel, source === "fingerCamera" && styles.segmentLabelActive]}>Finger</Text>
          </Pressable>
          <Pressable
            onPress={() => setSource("faceCamera")}
            style={[styles.segmentButton, source === "faceCamera" && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentLabel, source === "faceCamera" && styles.segmentLabelActive]}>Face</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Native Camera Preview</Text>
          <Text style={styles.cardHint}>
            {source === "fingerCamera"
              ? "Finger path: back camera + torch + live ROI aggregation в центре кадра. Сейчас это уже sensor path, а не просто scaffold."
              : "Face path: front camera + preview + frame stats. Реальный face analyzer пойдет только после стабильного finger path."}
          </Text>

          {!hasPermission ? (
            <Pressable onPress={() => void requestPermission()} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Разрешить камеру</Text>
            </Pressable>
          ) : !device ? (
            <View style={[styles.camera, styles.cameraPlaceholder]}>
              <Text style={styles.cameraPlaceholderText}>Подходящая камера не найдена</Text>
            </View>
          ) : (
            <>
              <View style={styles.cameraFrame}>
                <Camera
                  style={styles.camera}
                  device={device}
                  isActive={isRenderActive}
                  torch={shouldEnableTorch ? "on" : "off"}
                  frameProcessor={frameProcessor}
                  photo={false}
                  video={false}
                  audio={false}
                  pixelFormat="yuv"
                  onInitialized={() => {
                    setCameraReady(true);
                  }}
                  onStarted={() => {
                    setCameraReady(true);
                  }}
                  onPreviewStarted={() => {
                    setCameraReady(true);
                  }}
                  onError={() => {
                    setCameraReady(false);
                    setTorchArmed(false);
                  }}
                />
                <View style={styles.cameraOverlay}>
                  <Text style={styles.cameraOverlayText}>
                    {source === "fingerCamera"
                      ? isFingerPluginAvailable
                        ? "Live ROI active: center finger patch"
                        : "Finger ROI plugin missing: fallback only"
                      : "Face path remains preview + frame stats"}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <Pressable
                  onPress={() => setTorchEnabled((current) => !current)}
                  disabled={source !== "fingerCamera" || !device.hasTorch}
                  style={[
                    styles.secondaryButton,
                    (source !== "fingerCamera" || !device.hasTorch) && styles.secondaryButtonDisabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {shouldEnableTorch ? "Torch On" : "Torch Off"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Native Probe Status</Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Source</Text>
              <Text style={styles.metricValue}>{source === "fingerCamera" ? "Finger Camera" : "Face Camera"}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Target FPS</Text>
              <Text style={styles.metricValue}>{captureConfig.targetFps}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Camera Ready</Text>
              <Text style={styles.metricValue}>{cameraSessionReady ? "Yes" : "No"}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Torch</Text>
              <Text style={styles.metricValue}>
                {source !== "fingerCamera"
                  ? "Not needed"
                  : device?.hasTorch
                    ? shouldEnableTorch
                      ? "On"
                      : torchEnabled
                        ? cameraSessionReady
                          ? "Armed / waiting"
                          : "Waiting for first frame"
                        : "Disabled"
                    : "Unavailable on device"}
              </Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Frame Size</Text>
              <Text style={styles.metricValue}>
                {frameStats.width > 0 ? `${frameStats.width} x ${frameStats.height}` : "Waiting"}
              </Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Pixel Format</Text>
              <Text style={styles.metricValue}>{frameStats.pixelFormat}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Processed Frames</Text>
              <Text style={styles.metricValue}>{frameStats.processedFrames}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Signal Backend</Text>
              <Text style={styles.metricValue}>
                {source === "fingerCamera"
                  ? isFingerPluginAvailable
                    ? "Live finger ROI + quality gate"
                    : "Fallback only"
                  : "Face scaffold / live plugin pending"}
              </Text>
            </View>
          </View>
        </View>

        {source === "fingerCamera" ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Validation Focus</Text>
              <Text style={styles.cardHint}>
                Во время on-device теста смотрите прежде всего на эти поля: прошел ли gate, удерживается ли cadence,
                стабилен ли pulse и перестал ли RMSSD дергаться без причины.
              </Text>

              <View style={styles.metricGrid}>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Finger Contact</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? (fingerSnapshot.fingerDetected ? "Detected" : "Missing") : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Contact Confidence</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.fingerPresenceConfidence) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Quality Gate</Text>
                  <Text style={styles.metricValue}>{liveContractFrame ? "Passed" : "Fallback Active"}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Lock Confidence</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.pulseLockConfidence) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Cadence Lock</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot
                      ? fingerSnapshot.pulseLockState === "tracking"
                        ? "Tracking"
                        : fingerSnapshot.pulseLockState === "holding"
                          ? "Holding"
                          : "Searching"
                      : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Pulse Estimate</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && fingerSnapshot.pulseReady && fingerSnapshot.pulseRateBpm >= captureConfig.minPulseBpm
                      ? `${formatOneDecimal(fingerSnapshot.pulseRateBpm)} bpm`
                      : fingerSnapshot
                        ? fingerSnapshot.fingerDetected
                          ? fingerSnapshot.pulseCalibrationComplete
                            ? "Validating pulse"
                            : `Warming ${formatWindowStatus(fingerSnapshot.pulseWindowSeconds, 20)}`
                          : "Waiting for contact"
                        : "Searching"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>RMSSD</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && shouldShowProbeRmssdValue(fingerSnapshot)
                      ? formatProbeHrvRmssd(fingerSnapshot)
                      : fingerSnapshot
                        ? fingerSnapshot.pulseCalibrationComplete
                          ? `${fingerSnapshot.hrvEligibleBeatCount}/${fingerSnapshot.hrvMinDisplayEligibleBeats} beats`
                          : "Waiting for calibration"
                        : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>HRV Confidence</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.hrvConfidence) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Signal Quality</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.signalQuality) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Stress</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot
                      ? shouldShowProbeStressValue(fingerSnapshot)
                        ? formatProbeStress(fingerSnapshot)
                        : fingerSnapshot.pulseCalibrationComplete
                          ? `${fingerSnapshot.hrvEligibleBeatCount}/${fingerSnapshot.hrvMinDisplayEligibleBeats} beats`
                          : "Waiting for calibration"
                      : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Motion</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.motion) : "Waiting"}
                  </Text>
                </View>
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Optical Series</Text>
                {opticalBars.length > 0 ? (
                  <SignalBars values={opticalBars} tintColor="#ff8f9f" />
                ) : (
                  <View style={styles.signalPlaceholder}>
                    <Text style={styles.signalPlaceholderText}>Ожидаем первые ROI samples</Text>
                  </View>
                )}
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Live Signal Quality</Text>
                <ProgressBar value={fingerSnapshot?.signalQuality ?? 0} tintColor="#8cffc8" />
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Live Pulse Phase</Text>
                <ProgressBar value={fingerSnapshot?.pulsePhase ?? 0} tintColor="#ff8f9f" />
              </View>
            </View>

            <FingerMeasurementSessionPanel snapshot={fingerSnapshot} onNewMeasurement={handleNewFingerMeasurement} />

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Signal Diagnostics</Text>
              <Text style={styles.cardHint}>
                Этот блок нужен уже для тонкой отладки, когда хочется понять, почему lock или HRV в конкретный момент
                ухудшились.
              </Text>
              <Pressable
                style={styles.diagExportButton}
                onPress={() => {
                  void handleExportRmssdHampelDiagnostics();
                }}
              >
                <Text style={styles.diagExportButtonText}>
                  Экспорт JSON: RMSSD классика vs пайплайн (Хампель, блоки)
                </Text>
              </Pressable>
              <Text style={styles.diagExportHint}>
                Сравнивает «сырой» RMSSD только с жёстким фильтром RR и полный пайплайн на том же сегменте. Если
                разница заметна — пришлите файл в чат для разбора.
              </Text>

              <View style={styles.metricGrid}>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Signal Status</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.signalStatus ?? "Waiting"}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Raw Pulse</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && fingerSnapshot.rawPulseRateBpm >= captureConfig.minPulseBpm
                      ? `${formatOneDecimal(fingerSnapshot.rawPulseRateBpm)} bpm`
                      : "Rechecking"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Raw RMSSD</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && fingerSnapshot.rawRmssdMs > 0
                      ? `${formatOneDecimal(fingerSnapshot.rawRmssdMs)} ms`
                      : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>RR Count</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.rrIntervalsMs.length ?? 0}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Detected Beats</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.detectedBeatCount ?? 0}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Candidate Peaks</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.candidatePeakCount ?? 0}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Accepted Peaks</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.acceptedPeakCount ?? 0}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Rejected Peaks</Text>
                  <Text style={styles.metricValue}>{fingerSnapshot?.rejectedPeakCount ?? 0}</Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Median RR</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && fingerSnapshot.medianRrMs > 0
                      ? `${Math.round(fingerSnapshot.medianRrMs)} ms`
                      : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Raw Baevsky</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && fingerSnapshot.rawBaevskyStressIndexRaw > 0
                      ? formatOneDecimal(fingerSnapshot.rawBaevskyStressIndexRaw)
                      : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Stress Index</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot && shouldShowProbeStressValue(fingerSnapshot)
                      ? formatProbeStress(fingerSnapshot)
                      : fingerSnapshot
                        ? fingerSnapshot.pulseCalibrationComplete
                          ? `${fingerSnapshot.hrvEligibleBeatCount}/${fingerSnapshot.hrvMinDisplayEligibleBeats} beats`
                          : "Waiting for calibration"
                        : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Red Dominance</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatOneDecimal(fingerSnapshot.redDominance) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Luma</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.lumaMean) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Dark Pixels</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.darknessRatio) : "Waiting"}
                  </Text>
                </View>
                <View style={styles.metricPill}>
                  <Text style={styles.metricLabel}>Saturated Pixels</Text>
                  <Text style={styles.metricValue}>
                    {fingerSnapshot ? formatPercent(fingerSnapshot.saturationRatio) : "Waiting"}
                  </Text>
                </View>
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Raw RR List</Text>
                <Text style={styles.diagnosticText}>
                  {fingerSnapshot ? formatNumberList(fingerSnapshot.rawRrIntervalsMs, "ms", 12) : "Waiting"}
                </Text>
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Accepted Peak Timestamps</Text>
                <Text style={styles.diagnosticText}>
                  {fingerSnapshot
                    ? formatNumberList(fingerSnapshot.acceptedPeaks.map((peak) => peak.timestampMs), "ms", 8)
                    : "Waiting"}
                </Text>
              </View>

              <View style={styles.phaseBlock}>
                <Text style={styles.phaseLabel}>Rejected Peak Reasons</Text>
                <Text style={styles.diagnosticText}>{formatPeakReasonSummary(fingerSnapshot)}</Text>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Face path intentionally postponed</Text>
            <Text style={styles.infoText}>
              `FaceCamera` пока не поднимает live analyzer. Сначала валидируем `fingerCamera`, потому что он дает более
              контролируемый torch + ROI сценарий и быстрее покажет, жизнеспособен ли весь native optical pipeline.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{liveContractFrame ? "Live Contract Output" : "Fallback Contract Output"}</Text>
          <Text style={styles.cardHint}>
            {liveContractFrame
              ? "Quality gate пройден: ниже уже live frame из реального finger ROI analyzer. Если контакт кратко деградирует, cadence lock теперь короткое время удерживает последнюю стабильную частоту и затем плавно перестраивается после relock."
              : "Сейчас contract-card держится на fallback. Это нормальное поведение, пока палец, torch, экспозиция или cadence lock еще не дают достаточно устойчивого сигнала."}
          </Text>

          <View style={styles.metricGrid}>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Output Source</Text>
              <Text style={styles.metricValue}>{liveContractFrame ? "Live Finger ROI" : "Simulated Fallback"}</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Pulse</Text>
              <Text style={styles.metricValue}>{formatOneDecimal(contractFrame.pulseRateBpm)} bpm</Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Breath</Text>
              <Text style={styles.metricValue}>
                {contractFrame.breathRateBpm > 0 ? `${formatOneDecimal(contractFrame.breathRateBpm)} bpm` : "Pending"}
              </Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>RMSSD</Text>
              <Text style={styles.metricValue}>
                {liveContractFrame && fingerSnapshot
                  ? shouldShowProbeRmssdValue(fingerSnapshot)
                    ? formatProbeHrvRmssd(fingerSnapshot)
                    : fingerSnapshot.pulseCalibrationComplete
                      ? `${fingerSnapshot.hrvEligibleBeatCount}/${fingerSnapshot.hrvMinDisplayEligibleBeats} beats`
                      : "Calibrating…"
                  : `${formatOneDecimal(contractFrame.rmssdMs)} ms`}
              </Text>
            </View>
            <View style={styles.metricPill}>
              <Text style={styles.metricLabel}>Stress</Text>
              <Text style={styles.metricValue}>
                {liveContractFrame && fingerSnapshot
                  ? shouldShowProbeStressValue(fingerSnapshot)
                    ? formatProbeStress(fingerSnapshot)
                    : fingerSnapshot.pulseCalibrationComplete
                      ? `${fingerSnapshot.hrvEligibleBeatCount}/${fingerSnapshot.hrvMinDisplayEligibleBeats} beats`
                      : "Calibrating…"
                  : `${formatOneDecimal(contractFrame.stressIndex)} / 100`}
              </Text>
            </View>
          </View>

          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Pulse Phase</Text>
            <ProgressBar value={contractFrame.pulsePhase} tintColor="#ff8f9f" />
          </View>
          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Breath Phase</Text>
            <ProgressBar value={contractFrame.breathPhase} tintColor="#7bd8ff" />
          </View>
          <View style={styles.phaseBlock}>
            <Text style={styles.phaseLabel}>Signal Quality</Text>
            <ProgressBar value={contractFrame.signalQuality} tintColor="#8cffc8" />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#05070d",
  },
  screen: {
    flex: 1,
    backgroundColor: "#05070d",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  warningCard: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(64, 32, 18, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(255, 183, 120, 0.26)",
  },
  warningTitle: {
    color: "#ffd8a8",
    fontSize: 15,
    fontWeight: "800",
  },
  warningText: {
    color: "rgba(255, 236, 216, 0.84)",
    fontSize: 13,
    lineHeight: 19,
  },
  infoCard: {
    gap: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(26, 40, 74, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(132, 170, 255, 0.22)",
  },
  infoTitle: {
    color: "#dce8ff",
    fontSize: 15,
    fontWeight: "800",
  },
  infoText: {
    color: "rgba(221, 231, 255, 0.84)",
    fontSize: 13,
    lineHeight: 19,
  },
  eyebrow: {
    color: "rgba(226, 232, 255, 0.72)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: "rgba(228, 232, 255, 0.78)",
    fontSize: 14,
    lineHeight: 20,
  },
  segmentRow: {
    flexDirection: "row",
    gap: 10,
  },
  segmentButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.22)",
  },
  segmentButtonActive: {
    backgroundColor: "#9a8cff",
    borderColor: "#9a8cff",
  },
  segmentLabel: {
    color: "#ecf1ff",
    fontSize: 14,
    fontWeight: "700",
  },
  segmentLabelActive: {
    color: "#0b1020",
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "#101624",
    borderWidth: 1,
    borderColor: "rgba(146, 162, 255, 0.14)",
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },
  cardHint: {
    color: "rgba(223, 229, 255, 0.72)",
    fontSize: 13,
    lineHeight: 19,
  },
  diagExportButton: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.28)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  diagExportButtonText: {
    color: "#ecf1ff",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  diagExportHint: {
    color: "rgba(200, 210, 255, 0.55)",
    fontSize: 11,
    lineHeight: 16,
  },
  cameraFrame: {
    overflow: "hidden",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(160, 176, 255, 0.16)",
    backgroundColor: "#04060d",
  },
  camera: {
    width: "100%",
    aspectRatio: 3 / 4,
  },
  cameraPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#090d17",
  },
  cameraPlaceholderText: {
    color: "rgba(228, 232, 255, 0.6)",
    fontSize: 14,
    fontWeight: "600",
  },
  cameraOverlay: {
    position: "absolute",
    right: 12,
    bottom: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(5, 8, 18, 0.68)",
  },
  cameraOverlayText: {
    color: "#eef2ff",
    fontSize: 12,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7a8cff",
  },
  primaryButtonText: {
    color: "#091123",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.22)",
  },
  secondaryButtonDisabled: {
    opacity: 0.42,
  },
  secondaryButtonText: {
    color: "#ecf1ff",
    fontSize: 13,
    fontWeight: "700",
  },
  metricGrid: {
    gap: 10,
  },
  metricPill: {
    gap: 4,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  metricLabel: {
    color: "rgba(218, 225, 255, 0.58)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  phaseBlock: {
    gap: 8,
  },
  phaseLabel: {
    color: "#eef2ff",
    fontSize: 13,
    fontWeight: "700",
  },
  diagnosticText: {
    color: "rgba(228, 232, 255, 0.82)",
    fontSize: 12,
    lineHeight: 18,
  },
  signalBars: {
    height: 92,
    paddingHorizontal: 6,
    paddingVertical: 10,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  signalBar: {
    flex: 1,
    minHeight: 10,
    borderRadius: 999,
  },
  signalPlaceholder: {
    minHeight: 92,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.12)",
  },
  signalPlaceholderText: {
    color: "rgba(228, 232, 255, 0.58)",
    fontSize: 13,
    fontWeight: "600",
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
});
