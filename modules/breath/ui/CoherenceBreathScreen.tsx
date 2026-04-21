import Constants from "expo-constants";
import { cacheDirectory, getContentUriAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated as RNAnimated,
  Easing as RNEasing,
  Platform,
  Pressable,
  Share,
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
import { BreathBinduMandala } from "@/modules/breath/ui/BreathBinduMandala";
import { BreathOverlayControlPanel } from "@/modules/breath/ui/BreathOverlayControlPanel";
import { PpgMiniChart } from "@/modules/breath/ui/PpgMiniChart";
import { AppButton } from "@/modules/ui/AppButton";
import { AppDialog } from "@/modules/ui/AppDialog";
import { AppText } from "@/modules/ui/AppText";
import { CountdownRing } from "@/modules/ui/CountdownRing";
import { defaultTheme, ThemeProvider, useTheme } from "@/modules/ui/theme";

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
/** Панель управления: через сколько мс бездействия автоматически скрыть панель. */
const OVERLAY_AUTOHIDE_MS = 4_000;
/** Пороги независимых конечных автоматов: палец / качество (мс по шкале камеры). */
const PPG_FINGER_LOST_OVERLAY_MS = 1000;
const PPG_QUALITY_GRADE_B_MS = 2000;
const PPG_QUALITY_GRADE_C_MS = 7000;
/** Совпадает с длительностью практики (`TIMING.totalMs`), иначе forceSecondBpmZero не покрывает хвост сессии. */
const PPG_SESSION_SECONDS = Math.round(TIMING.totalMs / 1000);
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

/**
 * Внутренний экран. Использует Bus + Pipeline через context (см. `BiofeedbackProvider`),
 * подписывается на каналы, вместо прямой работы со снимками FingerSignalAnalyzer.
 */
function CoherenceBreathScreenInner({ locale }: { locale: BreathLocale }) {
  const theme = useTheme();
  const str = useMemo(() => getCoherenceBreathStrings(locale), [locale]);
  const pipeline = useBiofeedbackPipeline();
  const bus = useBiofeedbackBus();
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

  /**
   * Текущий выбор дыхательной практики (выбирается на idle-экране). При смене практики
   * на idle shape пересчитывается из дескриптора; в активной сессии пользователь
   * практику не меняет — только базовое число ударов.
   */
  const [practiceId, setPracticeId] = useState<BreathPracticeId>("coherent");
  const practice: BreathPracticeDescriptor = useMemo(
    () => getBreathPracticeById(practiceId),
    [practiceId],
  );

  /**
   * Базовое число ударов пульса на фазу дыхания. Для большинства практик это
   * симметричное 5 (вдох 5, выдох 5 и т.п.). Для дерева задержек/треугольников то же
   * число становится общим масштабом для всех фаз.
   */
  const [baseBeats, setBaseBeats] = useState<number>(TIMING.inhaleBeats);
  // Сбрасываем baseBeats при смене практики на «нормальное» значение, чтобы пользователь
  // видел сразу корректную подсветку и рисунок без ручной корректировки.
  useEffect(() => {
    setBaseBeats(practice.normalBaseBeats);
  }, [practice.id, practice.normalBaseBeats]);

  const coherenceShape = useMemo(
    () => practice.buildShape(baseBeats),
    [practice, baseBeats],
  );
  const coherenceShapeRef = useRef(coherenceShape);
  coherenceShapeRef.current = coherenceShape;
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

  /**
   * Всплывающая снизу панель управления.
   *  - появляется при тапе по «чёрному» полотну экрана (мандала + индикатор);
   *  - если тап попал по самой панели / её контролам → таймер бездействия сбрасывается;
   *  - по истечении `OVERLAY_AUTOHIDE_MS` без касаний панель уезжает вниз.
   */
  const [overlayVisible, setOverlayVisible] = useState(false);
  const overlayHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Диалог подтверждения досрочного выхода из практики (крестик на панели). */
  const [showStopConfirm, setShowStopConfirm] = useState(false);

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
  const ppgBannerHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fingerLostBannerShownThisEpisodeRef = useRef(false);
  const weakSignalBannerShownThisEpisodeRef = useRef(false);
  const prevFingerDetectedForBannerRef = useRef(true);
  const prevBadSignalForBannerRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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
    // idle / results
    blackCurtainSv.value = 0;
    setSensorUiMounted(false);
    setRunningUiRevealed(false);
    setIsBreathTimingActive(false);
    return undefined;
  }, [phase, blackCurtainSv]);

  const blackCurtainStyle = useAnimatedStyle(() => ({ opacity: blackCurtainSv.value }));

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
    if (useSimulatedPpg) return;
    return bus.subscribe("optical", (sample) => {
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
      const snap = snapshotRef.current;
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
        const wall = Date.now();
        if (wall - lastPulseLogWallClockRef.current >= 500) {
          lastPulseLogWallClockRef.current = wall;
          pulseLogRef.current.push({
            cameraTimestampMs: pipeline.getLastSourceTimestampMs(),
            wallClockMs: wall,
            pulseRateBpm: event.bpm,
            signalQuality: snap.signalQuality,
            pulseReady: event.hasFreshBeat,
            fingerDetected: snap.fingerDetected,
            pulseLockState: event.lockState,
            beatTimestampsCount: pipeline.getMergedBeats().length,
          });
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
  }, [bus, pipeline]);

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

      // Ранний успех: после 10 с QC-окна проверяем, достаточно ли устойчив сигнал.
      //  - если да → сразу в практику (короткий путь: warmup 10 + QC 10 = 20 с);
      //  - если нет → ждём до полного окна (COHERENCE_QUALITY_WINDOW_MS = 20 с);
      //  - по истечении полного окна: успех или диалог «не распознан».
      const isEarlyCheck = elapsed < COHERENCE_QUALITY_WINDOW_MS;
      const isFinalCheck = elapsed >= COHERENCE_QUALITY_WINDOW_MS;
      if (!isFinalCheck && elapsed < COHERENCE_QUALITY_WINDOW_EARLY_SUCCESS_MS) return;

      const probeEnd = Math.min(camTs, qcStart + COHERENCE_QUALITY_WINDOW_MS);
      const beatsInWin = pipeline
        .getCanonicalBeats()
        .filter((t) => t >= qcStart && t <= probeEnd);
      const snap = snapshotRef.current;

      const pulseSamples = qcPulseSamplesRef.current.filter(
        (sample) =>
          sample.cameraTimestampMs >= qcStart && sample.cameraTimestampMs <= probeEnd,
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
      // Среднее качество за всё окно — устойчивее к мгновенным просадкам (частое явление,
      // когда живой `snap.signalQuality` скачет ниже 0.7, хотя график явно идёт ровно).
      const meanSignalQuality =
        pulseSamples.length > 0
          ? pulseSamples.reduce((acc, s) => acc + s.signalQuality, 0) / pulseSamples.length
          : 0;

      const ok =
        // Либо моментальное качество ≥ 0.7, либо усреднённое за всё окно ≥ 0.6 —
        // второе условие страхует от коротких просадок, из-за которых раньше первая
        // попытка стабильно не проходила даже при визуально чистом PPG-графике.
        (snap.signalQuality >= 0.7 || meanSignalQuality >= 0.6) &&
        beatsInWin.length >= QC_MIN_BEATS &&
        stableSamples.length >= 3 &&
        stableFraction >= 0.55 &&
        bpmStdev <= QC_BPM_STDEV_MAX;

      if (ok) {
        qcOutcomeRef.current = "ok";
        const anchor = probeEnd;
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
        qualityBadAccumMsRef.current = 0;
        fingerAbsentAccumMsRef.current = 0;
        lastSampleMsRef.current = anchor;
        clearPpgBannerUi();
        setSessionStartWallMs(Date.now());
        setSessionStartLogicalMs(anchor);
        setElapsedMs(0);
        setPhase("running");
      } else if (isFinalCheck) {
        // Полное окно прошло, сигнал всё ещё не устойчивый — показываем диалог.
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
    // ВАЖНО: читаем поля `snapshot` через `snapshotRef`, а не из замыкания,
    // чтобы deps этого useEffect были стабильными. Иначе каждые 250 мс (темп
    // обновления snapshot-адаптера) мы пересоздавали setInterval — это и есть
    // «копится и множится в процессе дыхания»: за 20-минутную практику 4800
    // циклов clearInterval+setInterval, каждый из которых отписывает/подписывает
    // таймер в event loop и создаёт новые closure-объекты для GC.
    const id = setInterval(() => {
      const now = pipeline.getLastSourceTimestampMs();
      if (now <= 0) return;
      pipeline.getCoherenceEngine().appendBeats(pipeline.getCanonicalBeats());

      const lastSample = lastSampleMsRef.current ?? now;
      const delta = Math.max(0, now - lastSample);
      lastSampleMsRef.current = now;

      const snap = snapshotRef.current;
      const fingerOk = snap.fingerDetected;
      const badSignal =
        snap.pulseLockState === "searching" || snap.signalQuality < 0.5;

      if (!fingerOk) {
        fingerAbsentAccumMsRef.current += delta;
        qualityBadAccumMsRef.current = 0;
      } else {
        fingerAbsentAccumMsRef.current = 0;
        if (badSignal) qualityBadAccumMsRef.current += delta;
        else qualityBadAccumMsRef.current = 0;
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

      // Детерминированный расчёт желаемого сообщения. Приоритеты от сильного к слабому:
      //   1) «палец потерян»   — если finger absent ≥ 1 с;
      //   2) «биометрия приостановлена» — если finger есть, но плохой сигнал ≥ 7 с;
      //   3) «слабый сигнал»   — если finger есть, но плохой сигнал ≥ 2 с.
      let desired: string | null = null;
      if (!fingerOk && fingerAbsentAccumMsRef.current >= PPG_FINGER_LOST_OVERLAY_MS) {
        desired = str.ppgFingerLostMessage;
      } else if (fingerOk && badSignal) {
        if (qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_C_MS) {
          desired = str.ppgBiometryPausedMessage;
        } else if (qualityBadAccumMsRef.current >= PPG_QUALITY_GRADE_B_MS) {
          desired = str.ppgWeakSignalMessage;
        }
      }
      setPpgOverlayMessage((prev) => (prev === desired ? prev : desired));
    }, 250);
    return () => clearInterval(id);
  }, [
    phase,
    pipeline,
    sessionStartLogicalMs,
    str.ppgFingerLostMessage,
    str.ppgWeakSignalMessage,
    str.ppgBiometryPausedMessage,
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
    str.simulatedMetricsNote,
  ]);

  /**
   * Инициализация планировщика при переходе в "running": seed BPM + первый план цикла.
   * Дальнейшее — через `handlePhaseChange` (границы фаз от shell) и `updateBaseline`
   * из подписки на `pulseBpm`.
   */
  useEffect(() => {
    if (phase !== "running") return;
    const planner = plannerRef.current;
    const seedBpm = snapshot.pulseRateBpm > 0 ? snapshot.pulseRateBpm : INITIAL_SEED_BPM;
    planner.seedBaseline(seedBpm);
    const firstPlan = planner.planNextCycle(coherenceShapeRef.current);
    setCurrentPlan(firstPlan);
    lastAppliedShapeRef.current = coherenceShapeRef.current;
    // cycleStartMs специально НЕ задаётся здесь — его выставит «штора»-эффект
    // одновременно с `isBreathTimingActive = true` уже после полного появления practice-UI.
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
          // Кап 60 мин × 2 Hz = 7200 точек. На практике pulseBpm может идти и
          // до 5 Hz, поэтому даём запас до 14400 — экспорт не превратится в
          // мегабайты JSON на длинных практиках.
          if (baselineBpmSeriesRef.current.length > 14_400) {
            baselineBpmSeriesRef.current = baselineBpmSeriesRef.current.slice(-14_400);
          }
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
        // Кап на 2000 циклов (~8 часов практики при 15 с/цикл).
        if (rsaCyclesSummaryRef.current.length > 2000) {
          rsaCyclesSummaryRef.current = rsaCyclesSummaryRef.current.slice(-2000);
        }
      }
    });
  }, [phase, bus]);

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
      phaseDurationsHistoryRef.current.push({
        planIndex: phaseDurationsHistoryRef.current.length,
        cycleMs: nextPlan.cycleMs,
        plannedInhaleMs: nextPlan.phases.find((p) => p.kind === "inhale")?.phaseMs ?? 0,
        plannedExhaleMs: nextPlan.phases.find((p) => p.kind === "exhale")?.phaseMs ?? 0,
        baselineBpm: nextPlan.baselineBpm,
        rsaBpm: nextPlan.rsaInfo?.rsaBpm ?? null,
      });
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
    phaseDurationsHistoryRef.current.push({
      planIndex: phaseDurationsHistoryRef.current.length,
      cycleMs: nextPlan.cycleMs,
      plannedInhaleMs: nextPlan.phases.find((p) => p.kind === "inhale")?.phaseMs ?? 0,
      plannedExhaleMs: nextPlan.phases.find((p) => p.kind === "exhale")?.phaseMs ?? 0,
      baselineBpm: nextPlan.baselineBpm,
      rsaBpm: nextPlan.rsaInfo?.rsaBpm ?? null,
    });
  }, []);

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
    phase === "running" && elapsedMs > TIMING.totalMs - TIMING.dimBeforeEndMs
      ? Math.min(
          1,
          (elapsedMs - (TIMING.totalMs - TIMING.dimBeforeEndMs)) / TIMING.dimBeforeEndMs,
        )
      : 0;

  // ─── Панель управления: auto-hide, тап-по-экрану, клик мимо панели ────────

  const clearOverlayTimer = useCallback(() => {
    if (overlayHideTimerRef.current != null) {
      clearTimeout(overlayHideTimerRef.current);
      overlayHideTimerRef.current = null;
    }
  }, []);

  const scheduleOverlayHide = useCallback(() => {
    clearOverlayTimer();
    overlayHideTimerRef.current = setTimeout(() => {
      overlayHideTimerRef.current = null;
      setOverlayVisible(false);
    }, OVERLAY_AUTOHIDE_MS);
  }, [clearOverlayTimer]);

  const handleScreenTap = useCallback(() => {
    if (showStopConfirm) return;
    setOverlayVisible((prev) => {
      const next = !prev;
      if (next) scheduleOverlayHide();
      else clearOverlayTimer();
      return next;
    });
  }, [scheduleOverlayHide, clearOverlayTimer, showStopConfirm]);

  const handleOverlayInteraction = useCallback(() => {
    scheduleOverlayHide();
  }, [scheduleOverlayHide]);

  const handleIncrementBeats = useCallback(() => {
    setBaseBeats((prev) => Math.min(practice.maxBaseBeats, prev + 1));
  }, [practice.maxBaseBeats]);

  const handleDecrementBeats = useCallback(() => {
    setBaseBeats((prev) => Math.max(practice.minBaseBeats, prev - 1));
  }, [practice.minBaseBeats]);

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

  useEffect(() => () => clearOverlayTimer(), [clearOverlayTimer]);

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

  const cameraActive = phase === "warmup" || phase === "qualityCheck" || phase === "running";

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
    const id = setInterval(() => {
      const live = pipeline.getCoherenceEngine().getLiveSnapshot();
      setLiveRsaBpm(live?.rsaMedianBpmRecent ?? null);
    }, 1000);
    return () => clearInterval(id);
  }, [phase, pipeline]);

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
          RSA: {liveRsaBpm != null ? `${Math.round(liveRsaBpm)} уд/мин` : "—"}
        </Text>
        <Text style={styles.opticalMetricsMuted}>
          время практики: {elapsedSec} с из {Math.round(TIMING.totalMs / 1000)} с
        </Text>
      </View>
    );
  }, [
    phase,
    snapshot.pulseRateBpm,
    snapshot.signalQuality,
    snapshot.fingerDetected,
    snapshot.pulseLockState,
    liveRsaBpm,
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
          <AppText variant="screenTitle" tone="primary" style={styles.idleTitle}>
            {str.practiceName[practiceId]}
          </AppText>
          <AppText variant="statPillLabel" tone="muted" style={styles.idleSubtitle}>
            {str.practiceSanskritName[practiceId]}
          </AppText>
          <AppText variant="screenHint" tone="primary" style={styles.idleHint}>
            {str.fingerHint}
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
            label={str.startButton}
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

      {sensorUiMounted ? (
        <View
          style={styles.calib}
          pointerEvents={phase === "running" ? "none" : "auto"}
        >
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
          {/*
           * График показываем всё время, пока sensor-UI смонтирован (включая фазу
           * закрытия чёрной шторы при переходе в `running`). Иначе при смене
           * `phase` на `running` график пропадал скачком — и блок `sensorBackBtn`
           * подтягивался вверх, что визуально ощущалось как «дёрганье окна».
           */}
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
            onPress={() => setPhase("idle")}
            style={styles.sensorBackBtn}
          />
        </View>
      ) : null}

      <AppDialog
        visible={showQcFailedDialog}
        title={str.qcFailedDialogTitle}
        message={str.qcFailedDialogMessage}
        actionsLayout="column"
        actions={
          <>
            <AppButton
              variant="primary"
              label={str.qcFailedRetry}
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
          </>
        }
      />

      {phase === "running" && runningUiRevealed ? (
        <View style={styles.runningAbs}>
          <BreathPracticeShell
            isBreathTimingActive={isBreathTimingActive}
            plannedCycle={currentPlan}
            cycleStartMs={cycleStartMs}
            onPhaseChange={handlePhaseChange}
            dimOpacity={dimOpacity}
            footer={practiceFooter}
            indicatorKind={practice.indicatorKind}
            onScreenTap={handleScreenTap}
            overlay={
              <BreathOverlayControlPanel
                visible={overlayVisible}
                title={str.practiceName[practiceId]}
                subtitle={str.practiceSanskritName[practiceId]}
                totalMs={TIMING.totalMs}
                elapsedMs={elapsedMs}
                minutesShortLabel={str.practiceMinutesShort}
                beatsDisplay={{
                  type: "single",
                  value: baseBeats,
                  isHighlighted: baseBeats === practice.normalBaseBeats,
                }}
                onIncrement={
                  baseBeats < practice.maxBaseBeats ? handleIncrementBeats : undefined
                }
                onDecrement={
                  baseBeats > practice.minBaseBeats ? handleDecrementBeats : undefined
                }
                onRequestClose={handleRequestStop}
                onInteraction={handleOverlayInteraction}
                accessibilityLabel={str.baseBeatsAccessibilityLabel}
              />
            }
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
              </View>
            }
          />
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
        <AppDialog
          visible={showStopConfirm}
          title={str.stopConfirmTitle}
          message={str.stopConfirmMessage}
          actions={
            <>
              <AppButton
                variant="secondary"
                label={str.stopConfirmNo}
                onPress={() => {
                  setShowStopConfirm(false);
                  setOverlayVisible(true);
                  scheduleOverlayHide();
                }}
                style={styles.dialogAction}
              />
              <AppButton
                variant="primary"
                label={str.stopConfirmYes}
                onPress={() => {
                  setShowStopConfirm(false);
                  clearOverlayTimer();
                  setOverlayVisible(false);
                  pipeline.softReset();
                  pipeline.getCoherenceEngine().reset();
                  plannerRef.current.reset();
                  setSessionStartWallMs(null);
                  setSessionStartLogicalMs(null);
                  setAnalysis(null);
                  setExportDebug(null);
                  setFinalRmssdMs(null);
                  setFinalStressPercent(null);
                  setFinalPulseWasEmulated(false);
                  setElapsedMs(0);
                  setCurrentPlan(null);
                  setCycleStartMs(null);
                  setUseEmulatedPulseMode(false);
                  setPhase("idle");
                }}
                style={styles.dialogAction}
              />
            </>
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
    <ThemeProvider value={defaultTheme}>
      <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
        <CoherenceBreathScreenInner locale={locale} />
      </BiofeedbackProvider>
    </ThemeProvider>
  );
}

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
  /**
   * PPG-баннер «Пульс потерян/слабый сигнал» во время практики. Лежит в самом низу поверх
   * всего полотна, чтобы всплывающая панель управления не перекрывала его (панель выезжает
   * над этим баннером, поскольку у неё больший `bottom`).
   */
  runningAbs: { ...StyleSheet.absoluteFillObject },
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
  sensorStatus: {
    textAlign: "center",
    marginBottom: 28,
  },
  sensorChartWrap: {
    minHeight: 72, // совпадает с `height` у PpgMiniChart — резервирует место, чтобы
    // содержимое окна активации не «прыгало», даже если график временно не отрисуется.
    marginBottom: 32,
  },
  sensorBackBtn: {
    alignSelf: "stretch",
  },
  dialogAction: {
    flex: 1,
  },
});
