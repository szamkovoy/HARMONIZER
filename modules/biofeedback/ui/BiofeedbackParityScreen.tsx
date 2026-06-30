import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import Svg, { Polyline } from "react-native-svg";

import { BiofeedbackProvider, useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { useBiofeedbackBus } from "@/modules/biofeedback/bus/react";
import { PULSE_SETTLE_MS, WARMING_PHASE_MS } from "@/modules/biofeedback/constants";
import { computePracticeHrvMetricsFullSession } from "@/modules/biofeedback/core/metrics";
import { FINGER_CAMERA_CAPTURE_CONFIG, WEARABLE_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import { getBiofeedbackDebugStrings } from "@/modules/biofeedback/i18n/debug";
import { FingerPpgCameraSource } from "@/modules/biofeedback/sensors/FingerPpgCameraSource";
import { buildSessionExportV3 } from "@/modules/biofeedback/export/SessionExporter";
import { BleHeartRateSource } from "@/modules/biofeedback/wearables/BleHeartRateSource";
import { useWearablePreferences, updateWearablePreferences } from "@/modules/biofeedback/wearables/preferences";
import type {
  WearableRuntimeSnapshot,
  WearableScanCandidate,
} from "@/modules/biofeedback/wearables/types";
import { WearablePickerDialog } from "@/modules/biofeedback/wearables/WearablePickerDialog";
import {
  runCoherenceSessionAnalysis,
  type CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";
import { DEFAULT_COHERENCE_TEST_TIMING } from "@/modules/breath/core/types";
import { getCoherenceBreathStrings } from "@/modules/breath/i18n/coherence";
import { useAppLocale } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

type SeriesPoint = {
  tSec: number;
  value: number;
};

type SourcePanelState = {
  state: string;
  contact: string;
  lock: string;
  beats: number;
  lastRrMs: number | null;
  rmssdMs: number | null;
  stressPercent: number | null;
  coherencePercent: number | null;
  rsaAmplitudeBpm: number | null;
  bpmSeries: SeriesPoint[];
  rrSeries: SeriesPoint[];
};

type SourcePanelExport = {
  panelState: SourcePanelState;
  exportV3: ReturnType<typeof buildSessionExportV3>;
};

const MAX_SERIES_POINTS = 240;
const CHART_HEIGHT = 96;
const PARITY_WEARABLE_TRIM_START_MS = WARMING_PHASE_MS + PULSE_SETTLE_MS;
const PARITY_COHERENCE_INTERVAL_MS = 1_000;

const EMPTY_STATE: SourcePanelState = {
  state: "idle",
  contact: "—",
  lock: "—",
  beats: 0,
  lastRrMs: null,
  rmssdMs: null,
  stressPercent: null,
  coherencePercent: null,
  rsaAmplitudeBpm: null,
  bpmSeries: [],
  rrSeries: [],
};

function movingAveragePoints(points: readonly SeriesPoint[], radius: number): SeriesPoint[] {
  if (points.length < 3 || radius <= 0) return [...points];
  return points.map((point, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(points.length, index + radius + 1);
    const window = points.slice(start, end);
    const mean = window.reduce((sum, item) => sum + item.value, 0) / window.length;
    return {
      tSec: point.tSec,
      value: mean,
    };
  });
}

function decimatePoints(points: readonly SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints) return [...points];
  const bucketSize = points.length / maxPoints;
  const out: SeriesPoint[] = [];
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(points.length, Math.floor((bucket + 1) * bucketSize));
    const slice = points.slice(start, Math.max(start + 1, end));
    if (!slice.length) continue;
    const meanValue = slice.reduce((sum, point) => sum + point.value, 0) / slice.length;
    const anchor = slice[Math.floor(slice.length / 2)]!;
    out.push({
      tSec: anchor.tSec,
      value: meanValue,
    });
  }
  return out;
}

function recentPoints(points: readonly SeriesPoint[], maxPoints: number): SeriesPoint[] {
  if (points.length <= maxPoints) return [...points];
  return points.slice(points.length - maxPoints);
}

function formatMetric(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function buildSeriesFromBeats(beats: readonly number[]): {
  rrSeries: SeriesPoint[];
  bpmSeries: SeriesPoint[];
  lastRrMs: number | null;
} {
  if (beats.length < 2) {
    return {
      rrSeries: [],
      bpmSeries: [],
      lastRrMs: null,
    };
  }

  const baseTs = beats[0]!;
  const rrSeries: SeriesPoint[] = [];
  const bpmSeries: SeriesPoint[] = [];
  let lastRrMs: number | null = null;

  for (let i = 1; i < beats.length; i += 1) {
    const rrMs = beats[i]! - beats[i - 1]!;
    if (!(rrMs > 0 && rrMs <= 4000)) continue;
    const point = {
      tSec: (beats[i]! - baseTs) / 1000,
      value: rrMs,
    };
    rrSeries.push(point);
    const bpmFromRr = 60_000 / rrMs;
    if (bpmFromRr >= 30 && bpmFromRr <= 220) {
      bpmSeries.push({ tSec: point.tSec, value: bpmFromRr });
    }
    lastRrMs = rrMs;
  }

  return { rrSeries, bpmSeries, lastRrMs };
}

function trimBeatsForParityMetrics(
  beats: readonly number[],
  trimStartMs: number,
): readonly number[] {
  if (trimStartMs <= 0 || beats.length < 2) {
    return beats;
  }
  const base = beats[0]!;
  const startIndex = beats.findIndex((beat) => beat - base >= trimStartMs);
  if (startIndex <= 0) {
    return beats;
  }
  return beats.slice(startIndex);
}

function metricRow(
  label: string,
  value: string,
  theme: ReturnType<typeof useTheme>,
) {
  return (
    <View key={label} style={styles.metricRow}>
      <AppText variant="technicalCaption" tone="muted">
        {label}
      </AppText>
      <AppText variant="technicalCaption" tone="primary" style={{ color: theme.colors.textPrimary }}>
        {value}
      </AppText>
    </View>
  );
}

function buildPolylinePoints(
  points: readonly SeriesPoint[],
  width: number,
  height: number,
  options?: {
    xMode?: "time" | "sequence";
    yDomain?: { min: number; max: number } | null;
  },
): string | null {
  if (points.length < 2 || width <= 0 || height <= 0) return null;
  const xMode = options?.xMode ?? "time";
  const minT = points[0]!.tSec;
  const maxT = points[points.length - 1]!.tSec;
  const spanT =
    xMode === "sequence" ? Math.max(1, points.length - 1) : Math.max(1e-6, maxT - minT);

  let minV: number;
  let maxV: number;
  if (options?.yDomain) {
    minV = options.yDomain.min;
    maxV = options.yDomain.max;
  } else {
    const sortedValues = points.map((point) => point.value).sort((a, b) => a - b);
    const lowerIndex = Math.max(0, Math.floor((sortedValues.length - 1) * 0.05));
    const upperIndex = Math.min(
      sortedValues.length - 1,
      Math.ceil((sortedValues.length - 1) * 0.95),
    );
    minV = sortedValues[lowerIndex] ?? 0;
    maxV = sortedValues[upperIndex] ?? minV;
  }
  if (!(maxV > minV)) {
    const rawValues = points.map((point) => point.value);
    minV = Math.min(...rawValues);
    maxV = Math.max(...rawValues);
  }
  const spanV = Math.max(1e-6, maxV - minV);

  return points
    .map((point) => {
      const x =
        xMode === "sequence"
          ? ((points.indexOf(point)) / spanT) * width
          : ((point.tSec - minT) / spanT) * width;
      const clampedValue = Math.min(maxV, Math.max(minV, point.value));
      const y = height - ((clampedValue - minV) / spanV) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function SeriesChart({
  title,
  points,
  color,
  emptyLabel,
  smoothingRadius = 0,
  maxDisplayPoints = MAX_SERIES_POINTS,
  xMode = "time",
  fixedRecentWindow = 0,
  yDomainMode = "percentile",
}: {
  title: string;
  points: readonly SeriesPoint[];
  color: string;
  emptyLabel: string;
  smoothingRadius?: number;
  maxDisplayPoints?: number;
  xMode?: "time" | "sequence";
  fixedRecentWindow?: number;
  yDomainMode?: "percentile" | "respiratory";
}) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.max(140, Math.min(windowWidth - 64, 620));
  const windowedPoints = useMemo(
    () => (fixedRecentWindow > 0 ? recentPoints(points, fixedRecentWindow) : [...points]),
    [fixedRecentWindow, points],
  );
  const displayPoints = useMemo(
    () => decimatePoints(movingAveragePoints(windowedPoints, smoothingRadius), maxDisplayPoints),
    [maxDisplayPoints, smoothingRadius, windowedPoints],
  );
  const yDomain = useMemo(() => {
    if (yDomainMode !== "respiratory" || displayPoints.length < 2) return null;
    const sorted = displayPoints.map((point) => point.value).sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const halfRange = Math.max(70, Math.min(160, (sorted[sorted.length - 1]! - sorted[0]!) * 0.7));
    return {
      min: mid - halfRange,
      max: mid + halfRange,
    };
  }, [displayPoints, yDomainMode]);
  const polylineOptions = useMemo(
    () => ({ xMode, yDomain }),
    [xMode, yDomain],
  );
  const polyline = useMemo(
    () => buildPolylinePoints(displayPoints, chartWidth, CHART_HEIGHT, polylineOptions),
    [chartWidth, displayPoints, polylineOptions],
  );

  return (
    <View style={styles.chartBlock}>
      <AppText variant="technicalCaption" tone="muted">
        {title}
      </AppText>
      <View
        style={[
          styles.chartShell,
          {
            borderColor: theme.colors.surfaceBorder,
            backgroundColor: "rgba(15,23,42,0.28)",
          },
        ]}
      >
        {polyline ? (
          <Svg width={chartWidth} height={CHART_HEIGHT}>
            <Polyline
              points={polyline}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </Svg>
        ) : (
          <AppText variant="technicalCaption" tone="muted">
            {emptyLabel}
          </AppText>
        )}
      </View>
    </View>
  );
}

function SourcePanel({
  active,
  title,
  stateOverride,
  sourceNode,
  strings,
  sessionKey,
  exportDataRef,
  metricsTrimStartMs = 0,
}: {
  active: boolean;
  title: string;
  stateOverride?: string | null;
  sourceNode: ReactNode;
  strings: ReturnType<typeof getBiofeedbackDebugStrings>;
  sessionKey: number;
  exportDataRef: React.MutableRefObject<SourcePanelExport | null>;
  metricsTrimStartMs?: number;
}) {
  const theme = useTheme();
  const bus = useBiofeedbackBus();
  const pipeline = useBiofeedbackPipeline();
  const [state, setState] = useState<SourcePanelState>(EMPTY_STATE);
  const lastCoherenceAnalysisRef = useRef<CoherenceSessionResult | null>(null);
  const lastCoherenceComputeMsRef = useRef(0);

  useEffect(() => {
    setState(EMPTY_STATE);
    exportDataRef.current = null;
    lastCoherenceAnalysisRef.current = null;
    lastCoherenceComputeMsRef.current = 0;
    pipeline.reset();
  }, [exportDataRef, pipeline, sessionKey]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const unsubPulse = bus.subscribe("pulseBpm", (event) => {
      setState((prev) => ({
        ...prev,
        lock: event.lockState,
      }));
    });

    const unsubContact = bus.subscribe("contact", (event) => {
      setState((prev) => ({ ...prev, contact: event.state }));
    });

    const unsubSession = bus.subscribe("session", (event) => {
      setState((prev) => ({ ...prev, state: event.phase }));
    });

    const samplerId = setInterval(() => {
      const coherenceNowMs = pipeline.getLastSourceTimestampMs() || Date.now();
      const metricBeats = pipeline.getMetricBeatTimestamps();
      const analyzedBeats = trimBeatsForParityMetrics(metricBeats, metricsTrimStartMs);
      const trust = pipeline.getSignalTrustSummary();
      const fallbackBeats =
        trust.level === "pulse_only" ? pipeline.getRecentReliableMetricBeats() : null;
      const metricsBeats =
        trust.level !== "pulse_only"
          ? analyzedBeats
          : fallbackBeats != null
            ? trimBeatsForParityMetrics(fallbackBeats, metricsTrimStartMs)
            : [];
      const metrics =
        metricsBeats.length >= 2 ? computePracticeHrvMetricsFullSession(metricsBeats) : null;
      const { rrSeries, bpmSeries, lastRrMs } = buildSeriesFromBeats(analyzedBeats);
      const showCoherenceMetrics = trust.level === "full_biometrics";
      let coherenceAnalysis = lastCoherenceAnalysisRef.current;
      if (
        showCoherenceMetrics &&
        analyzedBeats.length >= 2 &&
        coherenceNowMs - lastCoherenceComputeMsRef.current >= PARITY_COHERENCE_INTERVAL_MS
      ) {
        lastCoherenceComputeMsRef.current = coherenceNowMs;
        coherenceAnalysis = runCoherenceSessionAnalysis({
          sessionStartedAtMs: analyzedBeats[0]!,
          sessionEndedAtMs: analyzedBeats[analyzedBeats.length - 1]!,
          beatTimestampsMs: analyzedBeats,
          inhaleMs: DEFAULT_COHERENCE_TEST_TIMING.inhaleMs,
          exhaleMs: DEFAULT_COHERENCE_TEST_TIMING.exhaleMs,
          cycleMs: DEFAULT_COHERENCE_TEST_TIMING.inhaleMs + DEFAULT_COHERENCE_TEST_TIMING.exhaleMs,
          mode: "test120s",
          bufferMsBeforeSession: 0,
        });
        lastCoherenceAnalysisRef.current = coherenceAnalysis;
      }
      if (analyzedBeats.length < 2) {
        setState((prev) =>
          prev.beats === analyzedBeats.length &&
          prev.rmssdMs == null &&
          prev.stressPercent == null &&
          prev.coherencePercent == null &&
          prev.rsaAmplitudeBpm == null
            ? prev
            : {
                ...prev,
                beats: analyzedBeats.length,
                rmssdMs: null,
                stressPercent: null,
                coherencePercent: null,
                rsaAmplitudeBpm: null,
                rrSeries: [],
                bpmSeries: [],
                lastRrMs: null,
              },
        );
        return;
      }

      setState((prev) => {
        const nextState = {
          ...prev,
          beats: analyzedBeats.length,
          lastRrMs,
          rmssdMs: metrics?.showRmssd ? metrics.rmssdMs : null,
          stressPercent: metrics?.showStress ? metrics.stressPercent : null,
          coherencePercent:
            showCoherenceMetrics &&
            coherenceAnalysis != null &&
            !coherenceAnalysis.metricsWithheldDueToInsufficientData
              ? coherenceAnalysis.coherenceAveragePercent
              : null,
          rsaAmplitudeBpm:
            showCoherenceMetrics &&
            coherenceAnalysis != null &&
            !coherenceAnalysis.metricsWithheldDueToInsufficientData
              ? coherenceAnalysis.rsaAmplitudeBpm
              : null,
          rrSeries,
          bpmSeries,
        };
        return {
          ...nextState,
        };
      });
    }, 250);

    return () => {
      unsubPulse();
      unsubContact();
      unsubSession();
      clearInterval(samplerId);
    };
  }, [active, bus, metricsTrimStartMs, pipeline]);

  useEffect(() => {
    exportDataRef.current = {
      panelState: state,
      exportV3: buildSessionExportV3({
        bus,
        pipeline,
        dataSource: pipeline.getPulseSource() === "wearable" ? "wearable" : "fingerPpg",
      }),
    };
  }, [bus, exportDataRef, pipeline, state]);

  const effectiveState = stateOverride ?? state.state;

  return (
    <View
      style={[
        styles.sourceCard,
        {
          borderColor: theme.colors.surfaceBorder,
          backgroundColor: theme.colors.surfaceElevated,
        },
      ]}
    >
      {sourceNode}
      <AppText variant="dialogTitle" tone="primary">
        {title}
      </AppText>

      <View style={styles.metricsGrid}>
        {metricRow(strings.stateLabel, effectiveState, theme)}
        {metricRow(strings.contactLabel, state.contact, theme)}
        {metricRow(strings.lockLabel, state.lock, theme)}
        {metricRow(strings.beatsLabel, String(state.beats), theme)}
        {metricRow(strings.lastRrLabel, state.lastRrMs != null ? `${Math.round(state.lastRrMs)} ms` : "—", theme)}
        {metricRow(strings.rmssdLabel, state.rmssdMs != null ? `${formatMetric(state.rmssdMs, 1)} ms` : "—", theme)}
        {metricRow(
          strings.stressLabel,
          state.stressPercent != null ? `${formatMetric(state.stressPercent, 1)}%` : "—",
          theme,
        )}
        {metricRow(
          strings.coherenceLabel,
          state.coherencePercent != null ? `${formatMetric(state.coherencePercent, 1)}%` : "—",
          theme,
        )}
        {metricRow(
          strings.rsaLabel,
          state.rsaAmplitudeBpm != null ? `${formatMetric(state.rsaAmplitudeBpm, 1)} BPM` : "—",
          theme,
        )}
      </View>

      <SeriesChart
        title={strings.pulseChartTitle}
        points={state.bpmSeries}
        color="#38bdf8"
        emptyLabel={strings.emptyChart}
        smoothingRadius={2}
        maxDisplayPoints={72}
        fixedRecentWindow={72}
        xMode="sequence"
      />
      <SeriesChart
        title={strings.rrChartTitle}
        points={state.rrSeries}
        color="#22c55e"
        emptyLabel={strings.emptyChart}
        smoothingRadius={1}
        maxDisplayPoints={64}
        fixedRecentWindow={64}
        xMode="sequence"
        yDomainMode="respiratory"
      />
    </View>
  );
}

function FingerSourceScope({
  active,
  strings,
  sessionKey,
  exportDataRef,
}: {
  active: boolean;
  strings: ReturnType<typeof getBiofeedbackDebugStrings>;
  sessionKey: number;
  exportDataRef: React.MutableRefObject<SourcePanelExport | null>;
}) {
  return (
    <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
      <SourcePanel
        active={active}
        title={strings.fingerSourceTitle}
        sourceNode={<FingerPpgCameraSource isActive={active} visible={false} persistCaptureWhenBlurred={active} />}
        strings={strings}
        sessionKey={sessionKey}
        exportDataRef={exportDataRef}
        metricsTrimStartMs={0}
      />
    </BiofeedbackProvider>
  );
}

function WearableSourceScope({
  active,
  device,
  runtime,
  onRuntimeSnapshot,
  strings,
  sessionKey,
  exportDataRef,
}: {
  active: boolean;
  device: WearableScanCandidate | null;
  runtime: WearableRuntimeSnapshot;
  onRuntimeSnapshot: (snapshot: WearableRuntimeSnapshot) => void;
  strings: ReturnType<typeof getBiofeedbackDebugStrings>;
  sessionKey: number;
  exportDataRef: React.MutableRefObject<SourcePanelExport | null>;
}) {
  return (
    <BiofeedbackProvider config={WEARABLE_CAPTURE_CONFIG}>
      <SourcePanel
        active={active}
        title={strings.wearableSourceTitle}
        stateOverride={runtime.state}
        sourceNode={
          <BleHeartRateSource
            isActive={active}
            deviceId={device?.id ?? null}
            deviceName={device?.name ?? null}
            initialCapabilityTier={device?.capabilityTier ?? "unknown"}
            autoReconnect={true}
            onRuntimeSnapshot={onRuntimeSnapshot}
          />
        }
        strings={strings}
        sessionKey={sessionKey}
        exportDataRef={exportDataRef}
        metricsTrimStartMs={PARITY_WEARABLE_TRIM_START_MS}
      />
    </BiofeedbackProvider>
  );
}

export function BiofeedbackParityScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getBiofeedbackDebugStrings(locale);
  const breathStrings = getCoherenceBreathStrings(locale);
  const wearablePreferences = useWearablePreferences();
  const [active, setActive] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);
  const [showWearablePickerDialog, setShowWearablePickerDialog] = useState(false);
  const [wearableRuntime, setWearableRuntime] = useState<WearableRuntimeSnapshot>({ state: "idle" });
  const [selectedWearableDevice, setSelectedWearableDevice] = useState<WearableScanCandidate | null>(null);
  const fingerExportRef = useRef<SourcePanelExport | null>(null);
  const wearableExportRef = useRef<SourcePanelExport | null>(null);

  useEffect(() => {
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
    selectedWearableDevice?.id,
    wearablePreferences.lastCapabilityTier,
    wearablePreferences.lastDeviceId,
    wearablePreferences.lastDeviceName,
    wearablePreferences.lastProvider,
  ]);

  const handleWearableSelected = useCallback((candidate: WearableScanCandidate) => {
    setSelectedWearableDevice(candidate);
    setWearableRuntime({ state: "idle" });
    setShowWearablePickerDialog(false);
    void updateWearablePreferences({
      preferredSensorMode: "ble",
      lastDeviceId: candidate.id,
      lastDeviceName: candidate.name,
      lastProvider: candidate.provider,
      lastCapabilityTier: candidate.capabilityTier,
    });
  }, []);

  const toggleCapture = useCallback(() => {
    if (active) {
      setActive(false);
      setWearableRuntime({ state: "idle" });
      return;
    }
    if (!selectedWearableDevice?.id) {
      setShowWearablePickerDialog(true);
      return;
    }
    setWearableRuntime({ state: "idle" });
    setSessionKey((value) => value + 1);
    setActive(true);
  }, [active, selectedWearableDevice?.id]);

  const exportComparisonJson = useCallback(async () => {
    const fingerExport = fingerExportRef.current;
    const wearableExport = wearableExportRef.current;
    if (fingerExport == null && wearableExport == null) {
      Alert.alert("Экспорт", "Пока нет данных для выгрузки.");
      return;
    }

    const payload = {
      schemaVersion: 1,
      exportedAtMs: Date.now(),
      screen: "biofeedback-parity",
      wearableRuntime,
      selectedWearableDevice: selectedWearableDevice
        ? {
            id: selectedWearableDevice.id,
            name: selectedWearableDevice.name,
            provider: selectedWearableDevice.provider,
            capabilityTier: selectedWearableDevice.capabilityTier,
          }
        : null,
      finger: fingerExport,
      wearable: wearableExport,
    };

    const base = cacheDirectory;
    if (base == null) {
      Alert.alert("Файлы", "Каталог кэша недоступен.");
      return;
    }
    const path = `${base}biofeedback-parity-export-${Date.now()}.json`;

    try {
      await writeAsStringAsync(path, JSON.stringify(payload, null, 2));
      const title = "Biofeedback parity export";
      if (Platform.OS === "android") {
        const contentUri = await getContentUriAsync(path);
        await Share.share({ title, message: "biofeedback-parity.json", url: contentUri });
      } else {
        const fileUrl = path.startsWith("file://") ? path : `file://${path}`;
        await Share.share({ title, url: fileUrl });
      }
    } catch (error: unknown) {
      Alert.alert("Экспорт", String(error));
    }
  }, [selectedWearableDevice, wearableRuntime]);

  const pickerStrings = useMemo(
    () => ({
      title: breathStrings.wearablePickerTitle,
      searchHint: breathStrings.wearablePickerSearchHint,
      foundHint: breathStrings.wearablePickerFoundHint,
      notFoundHint: breathStrings.wearablePickerNotFoundHint,
      notFoundTips: breathStrings.wearablePickerNotFoundTips,
      bluetoothOffHint: breathStrings.wearableBluetoothOff,
      retryButton: breathStrings.wearableRetryScan,
      closeButton: breathStrings.wearablePickerCloseButton,
      selectButton: breathStrings.wearablePickerSelectButton,
      signalLabel: breathStrings.wearableRssiLabel,
      bluetoothStateLabel: breathStrings.wearableBluetoothLabel,
    }),
    [breathStrings],
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.screenBg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <AppText variant="screenTitle" tone="primary">
          {strings.title}
        </AppText>
        <AppText variant="dialogBody" tone="muted">
          {strings.subtitle}
        </AppText>
        <AppText variant="technicalCaption" tone="muted">
          {selectedWearableDevice?.name
            ? strings.selectedWearable(selectedWearableDevice.name)
            : strings.noWearableSelected}
        </AppText>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={toggleCapture}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: pressed
                  ? theme.colors.controlButtonPressedBg
                  : active
                    ? "#ef4444"
                    : theme.colors.buttonPrimaryBg,
              },
            ]}
          >
            <AppText variant="buttonLabel" tone="accentOn">
              {active ? strings.stopCapture : strings.startCapture}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowWearablePickerDialog(true)}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: pressed
                  ? theme.colors.controlButtonPressedBg
                  : theme.colors.controlButtonBg,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="buttonLabel" tone="primary">
              {selectedWearableDevice ? strings.changeWearable : strings.selectWearable}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void exportComparisonJson()}
            style={({ pressed }) => [
              styles.actionButton,
              {
                backgroundColor: pressed
                  ? theme.colors.controlButtonPressedBg
                  : theme.colors.controlButtonBg,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="buttonLabel" tone="primary">
              {strings.exportCapture}
            </AppText>
          </Pressable>
        </View>

        <AppText variant="technicalCaption" tone="muted">
          {strings.captureHint}
        </AppText>

        <FingerSourceScope
          active={active}
          strings={strings}
          sessionKey={sessionKey}
          exportDataRef={fingerExportRef}
        />
        <WearableSourceScope
          active={active}
          device={selectedWearableDevice}
          runtime={wearableRuntime}
          onRuntimeSnapshot={setWearableRuntime}
          strings={strings}
          sessionKey={sessionKey}
          exportDataRef={wearableExportRef}
        />
      </ScrollView>

      <WearablePickerDialog
        visible={showWearablePickerDialog}
        onClose={() => setShowWearablePickerDialog(false)}
        onSelect={handleWearableSelected}
        strings={pickerStrings}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    padding: 18,
    paddingBottom: 48,
    gap: 12,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  actionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sourceCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 14,
    gap: 12,
  },
  metricsGrid: {
    gap: 8,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  chartBlock: {
    gap: 6,
  },
  chartShell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: CHART_HEIGHT + 20,
  },
});
