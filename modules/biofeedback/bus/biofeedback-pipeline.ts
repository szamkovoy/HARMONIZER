/**
 * BiofeedbackPipeline: связывает sensor → signal → quality → engines → BiofeedbackBus.
 *
 * Это «сборщик»: он не содержит математики, только маршрутизацию между уже извлечёнными
 * слоями. На каждый сырой optical-сэмпл от сенсора:
 *   1) проходит через `OpticalRingBuffer` (детренд + качество);
 *   2) `ContactMonitor` решает состояние контакта;
 *   3) `SignalQualityMonitor` проставляет hysteresis;
 *   4) при достаточном прогреве — `PeakDetector` ищет пики, `BeatMerger` сливает с историей;
 *   5) `CalibrationStateMachine` обновляет фазу (warmup/settle/ready/lost);
 *   6) `LivePulseChannel` эмитит beat-события (real / extrapolated);
 *   7) `PulseBpmEngine` пересчитывает текущий средний BPM;
 *   8) После калибровки удары попадают в `HrvBeatAccumulator`, и `HrvEngine`/`StressEngine`
 *      пересчитывают свои метрики;
 *   9) Если активна сессия `CoherenceEngine` — удары добавляются туда, и периодически
 *      выдаётся снимок когерентности.
 *
 * Все ключевые события публикуются в `BiofeedbackBus`. UI ничего не знает про engines.
 *
 * Этот класс — единственная точка, которой `BreathFingerCapture` (и `BiofeedbackProbeScreen`)
 * передаёт сырые сэмплы. Внутри pipeline удерживает все state'ы, а unmount / переход экрана
 * вызывает `pipeline.reset()`.
 */

import { bandpassPpgForPeakDetection } from "@/modules/biofeedback/signal/ppg-bandpass";
import { detectBeats } from "@/modules/biofeedback/signal/peak-detector";
import {
  collapseSplitMergedBeats,
  mergeBeatTimestampsPhase1,
  repairMissedMergedBeats,
  stabilizeAlternatingJitterBeats,
  syncEligibilityByNearestTime,
  trimBeatHistory,
} from "@/modules/biofeedback/signal/beat-merger";
import {
  OpticalRingBuffer,
  calculateFingerPresenceConfidence,
  isFingerDetected,
  movingAverage3,
  type AnalyzerPoint,
} from "@/modules/biofeedback/signal/optical-pipeline";

import { ContactMonitor } from "@/modules/biofeedback/quality/contact-monitor";
import { SignalQualityMonitor } from "@/modules/biofeedback/quality/signal-quality-monitor";
import {
  CalibrationStateMachine,
  type CalibrationSnapshot,
} from "@/modules/biofeedback/quality/calibration-state-machine";

import {
  BEAT_DUPLICATE_TOLERANCE_MS,
  BEAT_HISTORY_WINDOW_MS,
  CONTACT_LOST_GRACE_MS,
  HRV_RR_HARD_MAX_MS,
  HRV_RR_HARD_MIN_MS,
} from "@/modules/biofeedback/constants";

import { LivePulseChannel } from "@/modules/biofeedback/engines/live-pulse-channel";
import { PulseBpmEngine } from "@/modules/biofeedback/engines/pulse-bpm-engine";
import { HrvBeatAccumulator } from "@/modules/biofeedback/engines/hrv-beat-accumulator";
import { HrvEngine, HRV_ENGINE_VERSION } from "@/modules/biofeedback/engines/hrv-engine";
import { StressEngine, STRESS_ENGINE_VERSION } from "@/modules/biofeedback/engines/stress-engine";
import { CoherenceEngine, COHERENCE_ENGINE_VERSION } from "@/modules/biofeedback/engines/coherence-engine";
import { RsaEngine, RSA_ENGINE_VERSION } from "@/modules/biofeedback/engines/rsa-engine";

import { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";

import type {
  BiofeedbackCaptureConfig,
  PulseLockState,
} from "@/modules/biofeedback/core/types";
import {
  summarizeFingerSignalTrust,
  type BiofeedbackSignalTrustSummary,
} from "@/modules/biofeedback/core/signal-trust";
import { smoothBeatTimestampsMedian3ForMetrics } from "@/modules/biofeedback/core/rr-smoothing";
import type { PulseSourceKind } from "@/modules/biofeedback/engines/types";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

const PULSE_LOCK_RECENT_TRACKING_MS = 2_000;

/**
 * Стабильная «пустая» ссылка для устаревшего поля `smoothedSeries`. Поле больше не
 * используется в live-пути (серия считается только в `finalize()`), но тип канала
 * этого требует. Переиспользуем один и тот же пустой массив, чтобы не плодить GC.
 */
const EMPTY_SERIES: readonly number[] = Object.freeze([]);

export interface PipelineEngineVersions {
  hrv: string;
  stress: string;
  coherence: string;
  rsa: string;
}

export const PIPELINE_ENGINE_VERSIONS: PipelineEngineVersions = {
  hrv: HRV_ENGINE_VERSION,
  stress: STRESS_ENGINE_VERSION,
  coherence: COHERENCE_ENGINE_VERSION,
  rsa: RSA_ENGINE_VERSION,
};

export class BiofeedbackPipeline {
  // Stateful слои:
  private readonly optical = new OpticalRingBuffer();
  private readonly contact = new ContactMonitor();
  private readonly quality = new SignalQualityMonitor();
  private readonly calibration = new CalibrationStateMachine();
  private readonly livePulse = new LivePulseChannel();
  private readonly pulseBpm = new PulseBpmEngine();
  private readonly hrvAccumulator = new HrvBeatAccumulator();
  private readonly hrv = new HrvEngine();
  private readonly stress = new StressEngine();
  private readonly coherence = new CoherenceEngine();
  private readonly rsa = new RsaEngine();

  // Внутреннее состояние трекинга пульса:
  private mergedBeats: number[] = [];
  private canonicalBeats: number[] = [];
  private beatEligible: boolean[] = [];
  private lastStableRrMs = 0;
  private lastMedianRrMs = 0;
  private readonly sessionFingerGapEvents: Array<{
    resumeBeatTimestampMs: number;
    gapMs: number;
  }> = [];
  private mirroredAccumulatorGapEventCount = 0;
  private sessionFingerLostAtMs: number | null = null;
  private lockState: PulseLockState = "searching";
  private lastPulseBpmPublishMs = 0;
  private lastCoherenceSnapshotMs = 0;
  /** Последнее опубликованное `revision` live-снимка CoherenceEngine — чтобы не дублировать. */
  private lastCoherenceRevisionPublished = 0;
  /**
   * Последнее время вычисления RMSSD / стресса. Hampel-фильтр внутри линейно растёт
   * по длине RR-ряда (O(N×W), где W — окно Hampel, ~9). За сессию из ~1500 beats это
   * даёт десятки тысяч операций на каждый push, плюс создание window-slice массивов
   * (GC-давление). UI показывает RMSSD/стресс в footer и меняется медленно, поэтому
   * троттлим до 10 с — разницы на глаз нет, а нагрузка падает в 10 раз. Финальные
   * значения всё равно считаются заново из `computePracticeHrvMetricsFullSession()`
   * в `finalize()` — это даёт точный результат по всем beats практики.
   */
  private lastHrvStressComputeMs = 0;
  private static readonly HRV_STRESS_LIVE_INTERVAL_MS = 10_000;
  /**
   * Минимальный интервал между запусками peak-detection + bandpass по оптике.
   *
   * Сама камера присылает сэмплы 30 Гц, и раньше на КАЖДОМ сэмпле мы прогоняли
   * `bandpassPpgForPeakDetection` (4 прохода по окну 12 с × 30 fps = 1440 ops SOS)
   * + `movingAverage3` + `detectBeats`. Это давало постоянную базовую нагрузку в
   * ~1 млн ops/с, плюс аллокация нескольких массивов ~360 элементов за кадр —
   * сильный GC pressure. Через 10 минут на телефоне это складывалось с
   * `torch + camera + JS-таймеры + ре-рендеры` и приводило к thermal throttling
   * CPU → мандала замирала, индикатор дыхания начинал прыгать.
   *
   * Пиковый детектор ищет удары с минимальным RR ~450 мс. Запускать его чаще,
   * чем каждые ~67 мс (15 Гц), бессмысленно — один и тот же пик будет найден
   * повторно, и merge его всё равно схлопнет. Между запусками `detectedBeatsThisFrame`
   * остаётся пустым; merged/eligible пересчёт уже O(N) от окна и проходит быстро.
   */
  private static readonly PEAK_DETECT_MIN_INTERVAL_MS = 66;
  private lastPeakDetectMs = 0;
  /**
   * Минимальный интервал между «полными» пересчётами среднего BPM и
   * публикацией события `pulseBpm`. Движок `PulseBpmEngine` каждый раз делает
   * O(N) по всему окну ударов + несколько медиан/копий массивов; запускать его
   * 30 раз в секунду не имеет смысла — UI и дыхательный планировщик
   * опрашивают BPM на порядки реже (≤ 2 Гц). Раньше на каждом кадре камеры
   * (30 Hz) создавалось 7-9 временных массивов RR-измерений — на длинных
   * практиках это складывалось в ощутимую GC-нагрузку.
   */
  private static readonly PULSE_BPM_COMPUTE_INTERVAL_MS = 250;
  private lastPulseBpmComputeMs = 0;
  private lastPulseBpmSnapshot: ReturnType<PulseBpmEngine["push"]> | null = null;
  /**
   * Публикация `session` раньше шла на каждый optical-сэмпл (30 Hz) — 36 000
   * событий на 20-минутной практике. Подписчики реагируют только на смену
   * фазы (`phase`) и на одноразовые флаги `becameReady/becameLost`, поэтому
   * публикуем только когда что-то действительно поменялось (+ heartbeat
   * один раз в секунду, чтобы UI-таймеры в фазах warmup/settle могли обновлять
   * прогресс).
   */
  private lastSessionEventPhase: CalibrationSnapshot["phase"] | null = null;
  private lastSessionEventMs = 0;
  private static readonly SESSION_HEARTBEAT_MS = 1_000;
  /**
   * Троттлинг публикации `contact`. Раньше публиковалось каждый кадр (30/15
   * Hz), что создавало 18-36 тыс. событий на 20-минутной практике + заставляло
   * snapshot-adapter делать bump() на каждое, а значит пересчитывать snapshot
   * и гонять 4-Hz ре-рендеры через useBiofeedbackSnapshot.
   *
   * Подписчики в реальности реагируют только на смену `state` (present/absent/weak)
   * и на изменение `signalQuality` (footer UI «биодатчики активны/нет»). Поэтому
   * публикуем либо при смене state, либо когда signalQuality изменился заметно
   * (> 0.05), либо раз в секунду heartbeat, чтобы UI не застревал в устаревших
   * значениях после долгого «нет событий».
   */
  private lastContactStatePublished: "absent" | "weak" | "present" | null = null;
  private lastContactSignalQualityPublished = 0;
  private lastContactEventMs = 0;
  private static readonly CONTACT_HEARTBEAT_MS = 1_000;
  private static readonly CONTACT_QUALITY_EPSILON = 0.05;
  /**
   * Троттлинг публикации `optical`. Raw-сэмпл optical читает только мини-график
   * PPG в фазе warmup/qualityCheck — running/idle/results в нём не нуждаются.
   * Но pipeline не знает текущую фазу дыхательной практики, поэтому мы
   * консервативно публикуем optical ТОЛЬКО при присутствии пальца. Без пальца
   * сэмпл — это шум и публиковать его бессмысленно.
   *
   * Кроме того, при работе камеры на 15 Hz мы получаем ровно 15 событий/с —
   * для ~120-мс throttle в UI этого более чем достаточно.
   */
  private pulseSource: PulseSourceKind = "none";

  /**
   * Если true — `pushOpticalSample()` завершается сразу же, без какой-либо
   * обработки. Используется гибридным режимом измерения на фазе эмуляции
   * пульса: камера с фонариком активны (визуально пользователь видит
   * обычную практику), но pipeline-работа заморожена — процессор отдыхает,
   * телефон остывает. Worklet в FingerPpgCameraSource в этом же режиме
   * тоже ранний-выход, так что сэмплы в pipeline не приходят вовсе;
   * этот флаг — safety-net на случай, если проскочит какой-то кадр
   * в момент переключения состояний.
   */
  private opticalPaused = false;

  /**
   * Гейт «live vs batch»: при true pipeline продолжает считать пульс/RSA
   * (`peakDetector`, `pulseBpmEngine`, `coherence.appendBeats+tickLive` —
   * нужен для `BreathPhasePlanner`), но **не** аккумулирует beats в
   * `HrvBeatAccumulator` и не считает HRV/стресс. Именно HRV-накопление —
   * главный источник прогрессирующей нагрузки, т.к. на каждый кадр
   * фильтрует RR, отбрасывает гэпы > 2 с, держит большой массив.
   *
   * Используется гибридным режимом: в середине практики (окно `emulated`)
   * capture ставится на паузу — показатели RMSSD/Stress/Coherence для
   * отчёта всё равно строятся **только** по двум окнам
   * (`realStart` + `realEnd`), т.е. накопление в середине — мёртвый вес.
   *
   * Важно: `coherence.appendBeats` не гейтится, потому что его
   * `sessionBeats` — единственный источник для `tickLive` → RSA
   * индикатора. Массив в CoherenceEngine невелик (≤ 2000 чисел за
   * 20 мин) и не пересчитывает окна, только push.
   */
  private metricsCapturePaused = false;

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS — счётчик вызовов `pushOpticalSample` после
   * проверки паузы (реальная обработка кадра ППГ). Для сравнения нагрузки с
   * гибридной фазой `emulated`.
   */
  private perfDiagnosticOpticalPushCount = 0;

  // Диагностика детектора пиков (аккумулируется для экспорта):
  private dicroticRejectedTotal = 0;
  private splitArtifactRejectedTotal = 0;
  private peakWindowsObserved = 0;
  private lastRefractoryAdaptiveMs = 0;
  private lastMedianRrInPeakWindowMs = 0;

  constructor(
    private readonly bus: BiofeedbackBus,
    private readonly config: BiofeedbackCaptureConfig,
  ) {}

  /** Получает доступ к engine когерентности (для startSession/finalize в UI). */
  getCoherenceEngine(): CoherenceEngine {
    return this.coherence;
  }

  /** Получает доступ к накопителю HRV (для экспорта v3). */
  getHrvAccumulator(): HrvBeatAccumulator {
    return this.hrvAccumulator;
  }

  /**
   * Beat-series used for final HRV/stress diagnostics. Finger camera goes through an
   * additional median-of-3 RR smoothing pass; wearable/other beat sources stay raw.
   */
  getMetricBeatTimestamps(): readonly number[] {
    const beats = this.hrvAccumulator.getBeats();
    return this.pulseSource === "fingerCamera"
      ? smoothBeatTimestampsMedian3ForMetrics(beats)
      : beats;
  }

  getMetricBeatTimestampsInRange(startMs: number, endMs: number): readonly number[] {
    const beats = this.hrvAccumulator
      .getBeats()
      .filter((beat) => beat >= startMs - 1 && beat <= endMs + 1);
    return this.pulseSource === "fingerCamera"
      ? smoothBeatTimestampsMedian3ForMetrics(beats)
      : beats;
  }

  getMetricBeatTimestampsInTailWindow(windowMs: number): readonly number[] {
    const beats = this.getMetricBeatTimestamps();
    if (beats.length < 2 || windowMs <= 0) {
      return beats;
    }
    const endMs = beats[beats.length - 1]!;
    const startMs = endMs - windowMs;
    const startIndex = beats.findIndex((beat) => beat >= startMs);
    return startIndex <= 0 ? beats : beats.slice(startIndex);
  }

  getRecentReliableMetricBeats(options?: {
    candidateWindowMs?: readonly number[];
    minWindowMs?: number;
  }): readonly number[] | null {
    const beats = this.getMetricBeatTimestamps();
    if (beats.length < 2) {
      return null;
    }
    if (this.pulseSource !== "fingerCamera") {
      return beats;
    }

    const candidateWindowMs = options?.candidateWindowMs ?? [180_000, 120_000, 90_000];
    const minWindowMs = options?.minWindowMs ?? 90_000;
    const fullStartMs = beats[0]!;
    const fullEndMs = beats[beats.length - 1]!;
    const fullDurationMs = fullEndMs - fullStartMs;
    if (fullDurationMs < minWindowMs) {
      return null;
    }

    for (const windowMs of candidateWindowMs) {
      if (windowMs < minWindowMs || windowMs > fullDurationMs + 1) {
        continue;
      }
      const tailBeats = this.getMetricBeatTimestampsInTailWindow(windowMs);
      if (tailBeats.length < 30) {
        continue;
      }
      const tailStartMs = tailBeats[0]!;
      const tailEndMs = tailBeats[tailBeats.length - 1]!;
      const trust = this.getSignalTrustSummary({
        startMs: tailStartMs,
        endMs: tailEndMs,
      });
      if (trust.level !== "pulse_only") {
        return tailBeats;
      }
    }

    return null;
  }

  getSignalTrustSummary(range?: {
    startMs: number;
    endMs: number;
    applyInitialGraceWindow?: boolean;
  }): BiofeedbackSignalTrustSummary {
    if (this.pulseSource !== "fingerCamera") {
      const beats = range
        ? this.hrvAccumulator
            .getBeats()
            .filter((beat) => beat >= range.startMs - 1 && beat <= range.endMs + 1)
        : this.hrvAccumulator.getBeats();
      return {
        level: "full_biometrics",
        gapEventCount: 0,
        totalGapMs: 0,
        longestGapMs: 0,
        rawBeatCount: beats.length,
        metricBeatCount: beats.length,
        meanAbsDrrRawMs: 0,
        p90AbsDrrRawMs: 0,
        meanAbsDrrMetricMs: 0,
        p90AbsDrrMetricMs: 0,
        reasons: [],
      };
    }

    const rawBeats = range
      ? this.hrvAccumulator
          .getBeats()
          .filter((beat) => beat >= range.startMs - 1 && beat <= range.endMs + 1)
      : this.hrvAccumulator.getBeats();
    const metricBeats = range
      ? this.getMetricBeatTimestampsInRange(range.startMs, range.endMs)
      : this.getMetricBeatTimestamps();
    return summarizeFingerSignalTrust({
      rawBeats,
      metricBeats,
      gapEvents: this.getSessionFingerGapEvents(),
      startMs: range?.startMs ?? null,
      endMs: range?.endMs ?? null,
      applyInitialGraceWindow: range?.applyInitialGraceWindow ?? !range,
    });
  }

  /** Текущий источник ударов пульса. */
  getPulseSource(): PulseSourceKind {
    return this.pulseSource;
  }

  /**
   * Удары идут из эмулятора (75→65 BPM без датчика) → все HRV/когерентность метрики
   * должны быть withheld: ритм детерминирован и не отражает реального состояния пользователя.
   * `simulated` — debug-источник Expo Go с живой RR-модуляцией; метрики по нему имеют смысл
   * (для проверки пайплайна), поэтому здесь он emulated НЕ считается.
   */
  isPulseEmulated(): boolean {
    return this.pulseSource === "emulated";
  }

  /**
   * Явно пометить источник пульса (вызывается сенсорами при старте).
   * Публикует событие на канал `pulseSource`, чтобы UI/engines могли реагировать.
   */
  setPulseSource(kind: PulseSourceKind): void {
    if (this.pulseSource === kind) return;
    this.pulseSource = kind;
    // Different pulse sources may report timestamps in different time bases
    // (camera CMTime vs wall-clock synthetic/BLE beats). Reset time-based throttles
    // so a source switch cannot freeze downstream publications on a large backward jump.
    this.lastPulseBpmPublishMs = 0;
    this.lastPulseBpmComputeMs = 0;
    this.lastHrvStressComputeMs = 0;
    this.lastCoherenceSnapshotMs = 0;
    this.lastSessionEventMs = 0;
    this.lastContactEventMs = 0;
    this.lastPulseBpmSnapshot = null;
    this.pulseBpm.reset();
    this.bus.publish("pulseSource", {
      kind,
      isEmulated: kind === "emulated",
    });
  }

  /**
   * Включить/выключить паузу для optical-пути (используется гибридным
   * режимом измерения). См. комментарий к полю `opticalPaused`.
   */
  setOpticalPaused(paused: boolean): void {
    this.opticalPaused = paused;
  }

  isOpticalPaused(): boolean {
    return this.opticalPaused;
  }

  /**
   * Включить/выключить «тяжёлую» ветвь (HRV accumulator + финальные
   * метрики). См. комментарий к `metricsCapturePaused`.
   */
  setMetricsCapturePaused(paused: boolean): void {
    this.metricsCapturePaused = paused;
  }

  isMetricsCapturePaused(): boolean {
    return this.metricsCapturePaused;
  }

  /**
   * Диагностика размеров коллекций — отдаём в UI для runtimeDiagnostics,
   * чтобы было видно, что именно растёт за практику.
   */
  getCollectionSizes(): {
    mergedBeats: number;
    canonicalBeats: number;
    sessionBeatsInCoherence: number;
    hrvAccumulatorBeats: number;
  } {
    return {
      mergedBeats: this.mergedBeats.length,
      canonicalBeats: this.canonicalBeats.length,
      sessionBeatsInCoherence: this.coherence.getSessionBeatsLength(),
      hrvAccumulatorBeats: this.hrvAccumulator.getBeats().length,
    };
  }

  /** TAG_REMOVE_PERF_DIAGNOSTICS — см. `perfDiagnosticOpticalPushCount`. */
  getPerfDiagnosticOpticalPushCount(): number {
    return this.perfDiagnosticOpticalPushCount;
  }

  /** Текущий merged-список ударов (только для чтения). */
  getMergedBeats(): readonly number[] {
    return this.mergedBeats;
  }

  /** Канонический ряд ударов после pulse RR filter — использовать для downstream-метрик. */
  getCanonicalBeats(): readonly number[] {
    return this.canonicalBeats;
  }

  /** Последний стабильный RR (мс) — для UI и debug. */
  getLastStableRrMs(): number {
    return this.lastStableRrMs;
  }

  /** Текущий медианный RR (мс) из PulseBpmEngine — для планировщика дыхания. */
  getLastMedianRrMs(): number {
    return this.lastMedianRrMs;
  }

  /** Накопленная диагностика детектора пиков — для экспорта. */
  getPeakDetectorDiagnostics(): {
    dicroticRejectedTotal: number;
    splitArtifactRejectedTotal: number;
    peakWindowsObserved: number;
    lastRefractoryAdaptiveMs: number;
    lastMedianRrInPeakWindowMs: number;
  } {
    return {
      dicroticRejectedTotal: this.dicroticRejectedTotal,
      splitArtifactRejectedTotal: this.splitArtifactRejectedTotal,
      peakWindowsObserved: this.peakWindowsObserved,
      lastRefractoryAdaptiveMs: this.lastRefractoryAdaptiveMs,
      lastMedianRrInPeakWindowMs: this.lastMedianRrInPeakWindowMs,
    };
  }

  /**
   * TAG_REMOVE_PERF_DIAGNOSTICS
   *
   * Снимок текущего состояния pipeline для **отладки активации пульсометра**.
   * Используется `CoherenceBreathScreen` для ручной кнопки «Диагностика»
   * на экране активации: пользователь держит палец ~20-60 с, затем жмёт —
   * JSON с полным содержимым окна идёт разработчику.
   *
   * Включает:
   *  - `opticalSamples` — ВЕСЬ окно сырых сэмплов из `OpticalRingBuffer`
   *    (последние ~12 с), с redMean/greenMean/blueMean/opticalValue/
   *    quality/timestampMs и всеми сопутствующими метриками качества
   *    (lumaMean, darknessRatio, saturationRatio, motion, redDominance).
   *    Ровно этого достаточно, чтобы оффлайн восстановить весь signal
   *    path (baseline, detrend, bandpass, peak detection);
   *  - `mergedBeats` — весь список ударов с timestamps;
   *  - `peakDetectorDiagnostics` — счётчики дикротика/split-артефактов,
   *    последний refractory.
   *
   * Сам детектор запускается троттлом ~15 Hz в `pushOpticalSample`, а не
   * здесь — этот метод чисто read-only и в прямую память не копирует
   * (возвращает reference на внутренний массив).
   */
  getActivationDiagnostic(): {
    opticalSamples: readonly AnalyzerPoint[];
    mergedBeats: readonly number[];
    peakDetectorDiagnostics: ReturnType<BiofeedbackPipeline["getPeakDetectorDiagnostics"]>;
    lastStableRrMs: number;
    lastMedianRrMs: number;
    opticalPushCount: number;
  } {
    return {
      opticalSamples: this.optical.getSamples(),
      mergedBeats: this.mergedBeats,
      peakDetectorDiagnostics: this.getPeakDetectorDiagnostics(),
      lastStableRrMs: this.lastStableRrMs,
      lastMedianRrMs: this.lastMedianRrMs,
      opticalPushCount: this.perfDiagnosticOpticalPushCount,
    };
  }

  /** Время последнего поступившего сэмпла/удара в шкале источника (camera time / Date.now). */
  getLastSourceTimestampMs(): number {
    const samples = this.optical.getSamples();
    const last = samples[samples.length - 1]?.timestampMs ?? 0;
    const lastBeat = this.mergedBeats[this.mergedBeats.length - 1] ?? 0;
    return Math.max(last, lastBeat);
  }

  /**
   * Источник готовых ударов (симулятор / Apple Watch / BLE / Edge-AI). Минует все стадии
   * signal/quality, кроме merge — сразу обновляет mergedBeats и engines, для которых
   * имеет смысл (LivePulse / PulseBpm / HRV / Stress / Coherence).
   *
   * Контракт: для таких источников вызывающий ОТВЕЧАЕТ за то, что:
   *  - калибровка не требуется (engines сразу активны), либо вызывающий явно вызовет
   *    `markCalibrationCompleteForBeatSource()`;
   *  - eligibility = `true` для каждого удара (это уже валидированный источник).
   */
  pushBeatEvent(timestampMs: number, beatTimestampMs: number): void {
    const merged = [...this.mergedBeats];
    const eligible = [...this.beatEligible];
    const lastMergedBeat = merged[merged.length - 1];
    const metricEligible = this.pulseSource !== "emulated" && !this.metricsCapturePaused;
    // Готовые beat-источники (BLE / watch / synthetic) уже приходят как единичные
    // committed timestamps. Им не нужен phase-1 reanalysis merge, который уместен
    // для оптики и исторически пересобирает «хвост окна». Иначе wearable-path
    // схлопывает merged-ленту почти до одного удара и HRV перестаёт накапливать
    // полный ряд на длинной практике.
    if (
      lastMergedBeat == null ||
      beatTimestampMs - lastMergedBeat > BEAT_DUPLICATE_TOLERANCE_MS
    ) {
      merged.push(beatTimestampMs);
      eligible.push(metricEligible);
    } else if (
      Math.abs(beatTimestampMs - lastMergedBeat) <= BEAT_DUPLICATE_TOLERANCE_MS &&
      beatTimestampMs > lastMergedBeat
    ) {
      merged[merged.length - 1] = beatTimestampMs;
      eligible[eligible.length - 1] = (eligible[eligible.length - 1] ?? false) || metricEligible;
    }
    const cutoffMs = timestampMs - BEAT_HISTORY_WINDOW_MS;
    const trimmedMerged: number[] = [];
    const trimmedEligible: boolean[] = [];
    for (let i = 0; i < merged.length; i += 1) {
      const beat = merged[i]!;
      if (beat >= cutoffMs) {
        trimmedMerged.push(beat);
        trimmedEligible.push(eligible[i] ?? metricEligible);
      }
    }
    this.mergedBeats = trimmedMerged;
    this.beatEligible = trimmedEligible;
    const metricBeats = this.mergedBeats.filter((_, index) => this.beatEligible[index]);
    this.canonicalBeats = this.pulseSource === "wearable" ? metricBeats : [...this.mergedBeats];

    // Live pulse: для готовых источников всегда tracking.
    const liveSnap = this.livePulse.push({
      timestampMs,
      mergedBeats: this.mergedBeats,
      pulseLockState: "tracking",
      lastStableRrMs: this.lastStableRrMs,
      fingerDetected: true,
    });
    for (const tick of liveSnap.newTicks) {
      this.bus.publish("beat", { beat: tick.beat });
    }

    // BPM (throttle 500 ms).
    if (timestampMs - this.lastPulseBpmPublishMs >= 500) {
      this.lastPulseBpmPublishMs = timestampMs;
      const bpmSnap = this.pulseBpm.push({
        timestampMs,
        mergedBeats: this.mergedBeats,
        sourceKind: this.pulseSource,
      });
      this.lastStableRrMs = bpmSnap.medianRrMs || this.lastStableRrMs;
      this.lastMedianRrMs = bpmSnap.medianRrMs || this.lastMedianRrMs;
      // Chest strap уже отдаёт валидные RR; PPG-фильтр PulseBpmEngine (450–1400 ms,
      // sequential deviation) здесь только режет длину merged-ленты и ломает coherence.
      this.canonicalBeats =
        this.pulseSource === "wearable"
          ? metricBeats
          : bpmSnap.filteredBeatTimestampsMs;
      this.bus.publish("pulseBpm", {
        bpm: bpmSnap.bpm,
        rawBpm: bpmSnap.rawBpm,
        windowSeconds: bpmSnap.windowSeconds,
        lockState: "tracking",
        hasFreshBeat: true,
        confidence: bpmSnap.looksCoherent ? 1 : 0.6,
        medianRrMs: bpmSnap.medianRrMs,
        rrCount: bpmSnap.rrCount,
        jitterMs: bpmSnap.jitterMs,
        looksCoherent: bpmSnap.looksCoherent,
        reacquiring: false,
      });
    }

    // HRV/Stress/Coherence: при эмулированном пульсе (SimulatedSensor / EmulatedPulseSensor)
    // вычислять их бессмысленно — ритм заранее известен и задан синтетически. Чтобы UI не
    // показывал «фантомные» метрики, ничего не публикуем. Симулятор в Expo Go остаётся
    // прежним (там есть RR-модуляция, метрики полезны для отладки пайплайна) — поэтому
    // исключение только для `emulated`.
    const shouldSkipDerivedMetrics =
      this.pulseSource === "emulated" || this.metricsCapturePaused;

    if (this.hrvAccumulator.isReady() && !shouldSkipDerivedMetrics) {
      this.hrvAccumulator.ingest(
        this.canonicalBeats,
        this.canonicalBeats.map(() => true),
        timestampMs,
      );
      if (
        timestampMs - this.lastHrvStressComputeMs >=
        BiofeedbackPipeline.HRV_STRESS_LIVE_INTERVAL_MS
      ) {
        this.lastHrvStressComputeMs = timestampMs;
        const beats = this.hrvAccumulator.getBeats();
        const hrvSnap = this.hrv.push(beats);
        const stressSnap = this.stress.push(beats);
        if (hrvSnap.tier !== "none") {
          this.bus.publish("rmssd", {
            rmssdMs: hrvSnap.rmssdMs,
            segment: hrvSnap.showInitialFinal ? "final" : "all",
            tier: hrvSnap.tier,
            validBeatCount: hrvSnap.validBeatCount,
            approximate: hrvSnap.approximate,
          });
        }
        if (stressSnap.tier !== "none") {
          const tier =
            stressSnap.tier === "beats_180_plus" || stressSnap.tier === "beats_90_119"
              ? "stable90"
              : "fast60";
          this.bus.publish("stress", {
            percent: stressSnap.percent,
            rawIndex: stressSnap.rawIndex,
            segment: stressSnap.showInitialFinal ? "final" : "all",
            tier,
            approximate: stressSnap.approximate,
          });
        }
      }
    }

    if (this.coherence.isActive() && !shouldSkipDerivedMetrics) {
      this.coherence.appendBeats(this.canonicalBeats);
      if (timestampMs - this.lastCoherenceSnapshotMs >= 1000) {
        this.lastCoherenceSnapshotMs = timestampMs;
        this.publishCoherenceIfNew(timestampMs);
      }
    }
  }

  /**
   * Публикует coherence-событие только если `tickLive` вернул **новый** `revision`
   * (т.е. только что закрылся очередной дыхательный цикл). Это резко снижает частоту
   * ре-рендеров UI: раньше каждая секунда вызывала полный re-render `CoherenceBreathScreen`,
   * теперь — только раз в цикл (≈10–15 с). Мандала и индикатор дыхания получают
   * стабильный JS-поток.
   */
  private publishCoherenceIfNew(timestampMs: number): void {
    const live = this.coherence.tickLive(timestampMs);
    if (!live) return;
    if (live.revision === this.lastCoherenceRevisionPublished) return;
    this.lastCoherenceRevisionPublished = live.revision;
    this.bus.publish("coherence", {
      currentPercent: 0,
      averagePercent: 0,
      maxPercent: 0,
      smoothedSeries: EMPTY_SERIES,
      entryTimeSec: null,
      lastCompletedRsaCycle: live.lastCompletedRsaCycle,
    });
  }

  /** Для beat-источников (симулятор, watch): пометить калибровку готовой вручную. */
  markCalibrationCompleteForBeatSource(timestampMs: number): void {
    this.mirroredAccumulatorGapEventCount = 0;
    this.hrvAccumulator.markCalibrationComplete(timestampMs);
  }

  /** Подаёт сырой кадр в конвейер. */
  pushOpticalSample(sample: RawOpticalSample): void {
    // ---- SAFETY NET: гибридный режим эмуляции поставил pipeline на паузу ---
    //
    // На фазе emulated worklet в FingerPpgCameraSource сам не вызывает
    // `analyzeFingerRoi`, так что сюда ничего не приходит. Но в момент
    // переключения состояний может проскочить один-два сэмпла, а также
    // любой код (тест, debug-панель, будущий источник) всё ещё может
    // вызвать этот метод. Один `if` стоит близко к нулю и гарантирует,
    // что pipeline на emulated-фазе полностью не тратит CPU.
    if (this.opticalPaused) return;

    // TAG_REMOVE_PERF_DIAGNOSTICS
    this.perfDiagnosticOpticalPushCount += 1;

    // ---- Быстрая проверка присутствия пальца БЕЗ touching optical ring --
    //
    // `calculateFingerPresenceConfidence` — чистая функция по одному сэмплу
    // (порядка 10 FP-операций). `optical.push()` стоит на порядок дороже:
    // поддержание ring buffer, медиана baseline, amplitude, quality, аллокации.
    // Если пользователь снял палец и история ударов пуста, мы хотим вообще
    // НЕ трогать optical ring (иначе тысячи лишних итераций медианы на
    // бесполезных данных греют процессор — это и есть «тормоза через 2
    // минуты без пальца», о которых сообщал тестировщик).
    const quickPresenceConfidence = calculateFingerPresenceConfidence(sample);
    const quickFingerDetected = isFingerDetected(quickPresenceConfidence);
    const canTakeUltraFastPath =
      !quickFingerDetected && this.mergedBeats.length === 0;

    // ---- ULTRA-FAST-PATH: пальца нет, ударов нет -----------------------
    //
    // Пропускаем:
    //  - `optical.push()` — ring buffer / baseline median / amplitude / FPS.
    //    Без пальца это шум, и держать его в памяти 12 с — только грузить GC.
    //  - `bus.publish("optical")` — никто его в running не слушает, а в
    //    warmup/qualityCheck мы в этот момент ещё не попадём, т.к. без пальца
    //    calibration уходит в contactSearch.
    //  - `SignalQualityMonitor.push` — без пальца quality=0, монитор
    //    просто держит hysteresis; не зовя его, мы экономим ещё ~20 FP-op.
    //
    // Остаются только:
    //  - `contact.push()` (для корректного перехода contact → warmup при
    //    возвращении пальца);
    //  - `calibration.push()` (тот же FSM);
    //  - одна троттленная публикация `contact` (для UI-индикатора);
    //  - `maybePublishSessionEvent` (троттл 1 Hz + events).
    //
    // Это снимает ~90 % нагрузки в «холостом» режиме (без пальца). Раньше
    // эта же «холостая» нагрузка лежала в фоне и ускоряла перегрев.
    if (canTakeUltraFastPath) {
      const contactSnap = this.contact.push(sample.timestampMs, quickPresenceConfidence);
      if (contactSnap.shouldHardReset) {
        // softReset в нашем случае бесплатен — всё и так уже пусто, но
        // сбрасывает optical-кэш и calibration-таймеры.
        this.softReset();
      }
      this.maybePublishContactEvent(
        sample.timestampMs,
        contactSnap.state,
        contactSnap.confidence,
        0, // signalQuality: без пальца 0
        contactSnap.absentForMs,
      );
      const calSnap = this.calibration.push({
        timestampMs: sample.timestampMs,
        contactPresent: false,
        goodSettleTick: false,
        contactLost: true,
      });
      this.maybePublishSessionEvent(sample.timestampMs, calSnap);
      return;
    }

    // ---- Полный путь: либо палец на камере, либо есть накопленная история
    //
    // Здесь уже нужна вся optical-обработка для peak detection и quality
    // monitoring. Единственное, что мы делаем всегда — это обрабатываем
    // сэмпл через ring buffer.
    const opt = this.optical.push(sample);
    // Публикуем optical ТОЛЬКО при присутствии пальца. Без пальца — шум, и
    // единственный подписчик (optical-превью в warmup/qualityCheck) до
    // этой фазы ещё не доходит. Так мы дополнительно отрезаем нейтральные
    // 15 сэмплов/с от «пустой» публикации.
    if (quickFingerDetected) {
      this.bus.publish("optical", sample);
    }

    // 2) Contact + Quality.
    const contactSnap = this.contact.push(sample.timestampMs, opt.fingerPresenceConfidence);

    if (contactSnap.shouldHardReset) {
      this.softReset();
    }

    const qualitySnap = this.quality.push(
      sample.timestampMs,
      opt.signalQuality,
      this.lockState === "tracking",
    );
    this.maybePublishContactEvent(
      sample.timestampMs,
      contactSnap.state,
      contactSnap.confidence,
      qualitySnap.value,
      contactSnap.absentForMs,
    );

    const contactPresent = contactSnap.state === "present";
    const calibrationPhaseBefore = this.calibration.getPhase();

    // ---- FAST-PATH после обновления ring-буфера: пальца всё ещё нет, но
    // mergedBeats не пуст — надо лишь «додонести» калибровку, а пиковую
    // обработку пропустить (см. подробный комментарий ниже).
    if (!contactPresent && this.mergedBeats.length === 0) {
      const calSnap = this.calibration.push({
        timestampMs: sample.timestampMs,
        contactPresent: false,
        goodSettleTick: false,
        contactLost: true,
      });
      this.maybePublishSessionEvent(sample.timestampMs, calSnap);
      return;
    }

    // 3) Peak detection + merge (только после прогрева и при наличии пальца).
    //
    // Если пальца нет (`contactSnap.state !== "present"`), нет смысла гонять
    // `bandpassPpgForPeakDetection` + `detectBeats` — на шуме от торча без пальца
    // детектор ничего осмысленного не вернёт, но SOS-фильтрация по всему окну в 360
    // сэмплов + несколько аллокаций массивов работают впустую каждые 33 мс.
    //
    // Дополнительно троттлим peak detection до 15 Гц — выше частоты камеры он
    // ничего нового не находит (refractory period детектора ≥ 300 мс).
    const inWarmupOrEarlier =
      calibrationPhaseBefore === "idle" ||
      calibrationPhaseBefore === "contactSearch" ||
      calibrationPhaseBefore === "warmup";
    const peakDetectThrottleOk =
      sample.timestampMs - this.lastPeakDetectMs >=
      BiofeedbackPipeline.PEAK_DETECT_MIN_INTERVAL_MS;

    let detectedBeatsThisFrame: number[] = [];
    if (!inWarmupOrEarlier && contactPresent && peakDetectThrottleOk) {
      this.lastPeakDetectMs = sample.timestampMs;
      const samples = this.optical.getSamples();
      // Детрендированные значения строим только сейчас, прямо перед пиковым
      // детектором, и только когда он реально запускается (≈ 15 Hz).
      // OpticalRingBuffer хранит baseline в кэше — это тот же самый baseline,
      // что был возвращён из `optical.push()`.
      const detrendedValues = this.optical.getDetrendedValues();
      const bandpassed = bandpassPpgForPeakDetection(detrendedValues, opt.fps);
      const smoothed = movingAverage3(bandpassed);
      const result = detectBeats(samples, smoothed, this.config, opt.fps);
      detectedBeatsThisFrame = result.beatTimestampsMs;
      this.dicroticRejectedTotal += result.dicroticRejectedCount;
      this.splitArtifactRejectedTotal += result.splitArtifactRejectedCount;
      this.peakWindowsObserved += 1;
      if (result.refractoryMsAdaptive > 0) {
        this.lastRefractoryAdaptiveMs = result.refractoryMsAdaptive;
      }
      if (result.medianRrMsInWindow > 0) {
        this.lastMedianRrInPeakWindowMs = result.medianRrMsInWindow;
      }
    }

    // Мердж делаем только если есть новые удары ИЛИ история непуста и надо её
    // подрезать по окну BEAT_HISTORY_WINDOW_MS. Если обе части пусты — выходим
    // через fast-path выше. Если новых ударов нет, но старая история
    // присутствует, всё равно один раз проходим по trim+collapse: иначе после
    // потери контакта beats «зависают» в памяти до нового реального удара.
    const prevMerged = this.mergedBeats;
    const prevEligible = this.beatEligible;
    let merged: number[];
    let mergedChanged = false;
    if (detectedBeatsThisFrame.length > 0) {
      merged = mergeBeatTimestampsPhase1(
        prevMerged,
        detectedBeatsThisFrame,
        this.optical.getSamples()[0]?.timestampMs ?? sample.timestampMs,
      );
      merged = trimBeatHistory(merged, sample.timestampMs);
      const collapsed = collapseSplitMergedBeats(merged);
      merged = collapsed.beats;
      this.splitArtifactRejectedTotal += collapsed.removedCount;
      if (this.config.source === "fingerCamera") {
        const repaired = repairMissedMergedBeats(merged);
        merged = repaired.beats;
        const stabilized = stabilizeAlternatingJitterBeats(merged);
        merged = stabilized.beats;
      }
      mergedChanged = true;
    } else {
      // Новых ударов в этом кадре нет — просто поддерживаем окно истории.
      // trimBeatHistory — O(N) one-pass; выполним только если хвост реально
      // может «выпасть», иначе вообще ничего не делаем (экономим ~2 мс/кадр
      // на длинных практиках, когда 99% кадров — «без новых ударов»).
      const oldestKeepMs = sample.timestampMs - 2 * 60 * 1000;
      if (prevMerged.length > 0 && prevMerged[0]! < oldestKeepMs) {
        merged = trimBeatHistory(prevMerged, sample.timestampMs);
        mergedChanged = true;
      } else {
        merged = prevMerged as number[];
      }
    }

    if (mergedChanged) {
      this.mergedBeats = merged;
      this.beatEligible = syncEligibilityByNearestTime(
        merged,
        prevMerged,
        prevEligible,
        this.lockState === "tracking",
      );
    }

    // 4) Pulse BPM — троттлим до ~4 Гц. Движок за кадр делает 7-9 аллокаций
    // временных массивов + несколько медиан; 30 Hz на длинных сессиях — это
    // основной источник GC-давления. UI показывает BPM не чаще 2 Hz,
    // LivePulseChannel использует `lastStableRrMs` (обновляется тут же),
    // поэтому учащённый пересчёт бесполезен. Между вычислениями используем
    // кэш последнего снимка `lastPulseBpmSnapshot`.
    const bpmComputeDue =
      mergedChanged ||
      this.lastPulseBpmSnapshot === null ||
      sample.timestampMs - this.lastPulseBpmComputeMs >=
        BiofeedbackPipeline.PULSE_BPM_COMPUTE_INTERVAL_MS;
    let bpmSnap = this.lastPulseBpmSnapshot;
    if (bpmComputeDue) {
      this.lastPulseBpmComputeMs = sample.timestampMs;
      bpmSnap = this.pulseBpm.push({
        timestampMs: sample.timestampMs,
        mergedBeats: merged,
        sourceKind: this.config.source === "wearable" ? "wearable" : "fingerCamera",
      });
      this.lastPulseBpmSnapshot = bpmSnap;
      this.canonicalBeats = bpmSnap.filteredBeatTimestampsMs;
    }

    // Fallback на случай, если bpmSnap всё ещё null (первый кадр): делаем
    // минимальную заглушку, чтобы дальнейший код мог спокойно читать поля.
    if (bpmSnap === null) {
      bpmSnap = {
        bpm: 0,
        rawBpm: 0,
        windowSeconds: 0,
        rrCount: 0,
        medianRrMs: 0,
        jitterMs: 0,
        intervalsMs: [],
        looksCoherent: false,
        lastBeatTimestampMs: 0,
        filteredBeatTimestampsMs: [],
        reacquiring: false,
      };
    }

    // canonicalEligible пересчитываем только когда реально что-то поменялось в
    // merged- или canonical-цепочке — иначе старая eligibility остаётся валидна.
    let canonicalEligible = this.beatEligible;
    if (bpmComputeDue && mergedChanged) {
      canonicalEligible = syncEligibilityByNearestTime(
        this.canonicalBeats,
        merged,
        this.beatEligible,
        this.lockState === "tracking",
      );
    }

    const hasFreshBeat =
      merged.length > 0 && sample.timestampMs - merged[merged.length - 1]! <= 4_200;
    const hasValidBpm =
      bpmSnap.bpm >= this.config.minPulseBpm && bpmSnap.bpm <= this.config.maxPulseBpm;
    const trackingNow =
      contactPresent &&
      qualitySnap.enoughForTracking &&
      hasFreshBeat &&
      hasValidBpm &&
      bpmSnap.looksCoherent;

    if (bpmSnap.medianRrMs > 0) {
      this.lastMedianRrMs = bpmSnap.medianRrMs;
    }
    if (trackingNow) {
      this.lockState = "tracking";
      this.lastStableRrMs = bpmSnap.medianRrMs;
    } else if (this.lockState === "tracking") {
      this.lockState = "holding";
    }

    // 5) Calibration FSM.
    // `contactLost` is debounced: a momentary finger-off (3 s) must NOT collapse the
    // calibration into a full 10 s warmup. Only sustained absence (> CONTACT_LOST_GRACE_MS)
    // is treated as a real loss and routes the FSM to `lost → warmup`. Brief removals keep
    // the FSM in `ready`, so peak detection stays enabled and re-locks within 2–3 s once the
    // finger is back instead of ~15 s.
    const calSnap = this.calibration.push({
      timestampMs: sample.timestampMs,
      contactPresent,
      goodSettleTick: trackingNow,
      contactLost:
        !contactPresent && contactSnap.absentForMs > CONTACT_LOST_GRACE_MS,
    });
    this.maybePublishSessionEvent(sample.timestampMs, calSnap);
    if (calSnap.becameReady) {
      if (this.sessionFingerLostAtMs != null && sample.timestampMs > this.sessionFingerLostAtMs) {
        this.sessionFingerGapEvents.push({
          resumeBeatTimestampMs: sample.timestampMs,
          gapMs: sample.timestampMs - this.sessionFingerLostAtMs,
        });
      }
      this.sessionFingerLostAtMs = null;
      this.mirroredAccumulatorGapEventCount = 0;
      this.hrvAccumulator.markCalibrationComplete(sample.timestampMs);
    }

    // 6) HRV accumulator (только после ready и только если реально появились
    // новые удары — ingest по уже накопленному ряду на каждом кадре только
    // создаёт временные индексы, ничего не добавляя).
    // В «batch-паузе» (фаза emulated гибридного режима) — skip: метрики
    // в отчёте строятся только по началу и концу практики, середина — мёртвый вес.
    if (
      this.hrvAccumulator.isReady() &&
      mergedChanged &&
      !this.metricsCapturePaused
    ) {
      this.hrvAccumulator.ingest(this.canonicalBeats, canonicalEligible, sample.timestampMs);
      this.syncSessionFingerGapEventsFromAccumulator();
    }

    // 7) Live pulse channel — нужен только когда реально трекаем пульс
    // (пальцем) ИЛИ ещё доступна экстраполяция по последнему RR. Без этих
    // условий он всё равно не эмитит тиков, но зато каждый кадр делает
    // slice(16) + spread + Set-проверки. За 20-минутную практику это
    // сотни тысяч бесполезных аллокаций.
    const livePulseNeeded =
      contactPresent ||
      (this.lastStableRrMs > 0 &&
        merged.length > 0 &&
        sample.timestampMs - merged[merged.length - 1]! <=
          PULSE_LOCK_RECENT_TRACKING_MS);
    if (livePulseNeeded) {
      const liveSnap = this.livePulse.push({
        timestampMs: sample.timestampMs,
        mergedBeats: merged,
        pulseLockState: this.lockState,
        lastStableRrMs: this.lastStableRrMs,
        fingerDetected: contactPresent,
      });
      for (const tick of liveSnap.newTicks) {
        this.bus.publish("beat", { beat: tick.beat });
      }
      if (liveSnap.heartbeatLost) {
        this.bus.publish("error", {
          source: "LivePulseChannel",
          message: "heartbeatLost",
        });
      }
    }

    // 8) Pulse BPM publish (~2 Гц throttle).
    if (sample.timestampMs - this.lastPulseBpmPublishMs >= 500) {
      this.lastPulseBpmPublishMs = sample.timestampMs;
      this.bus.publish("pulseBpm", {
        bpm: bpmSnap.bpm,
        rawBpm: bpmSnap.rawBpm,
        windowSeconds: bpmSnap.windowSeconds,
        lockState: this.lockState,
        hasFreshBeat,
        confidence: bpmSnap.looksCoherent ? Math.min(1, bpmSnap.rrCount / 10) : 0,
        medianRrMs: bpmSnap.medianRrMs,
        rrCount: bpmSnap.rrCount,
        jitterMs: bpmSnap.jitterMs,
        looksCoherent: bpmSnap.looksCoherent,
        reacquiring: bpmSnap.reacquiring === true,
      });
    }

    // 9) HRV / Stress (после ready) — троттлим до 10 с.
    // Тоже скипаем при batch-паузе — beats всё равно перестали
    // аккумулироваться, считать заново ту же выборку каждые 10 с
    // незачем.
    if (
      this.hrvAccumulator.isReady() &&
      qualitySnap.enoughForHrv &&
      !this.metricsCapturePaused &&
      sample.timestampMs - this.lastHrvStressComputeMs >=
        BiofeedbackPipeline.HRV_STRESS_LIVE_INTERVAL_MS
    ) {
      this.lastHrvStressComputeMs = sample.timestampMs;
      const beats = this.getMetricBeatTimestamps();
      const trust = this.getSignalTrustSummary();
      const hrvSnap = this.hrv.push(beats);
      const stressSnap = this.stress.push(beats);
      if (trust.level !== "pulse_only" && hrvSnap.tier !== "none") {
        this.bus.publish("rmssd", {
          rmssdMs: hrvSnap.rmssdMs,
          segment: hrvSnap.showInitialFinal ? "final" : "all",
          tier: hrvSnap.tier,
          validBeatCount: hrvSnap.validBeatCount,
          approximate: hrvSnap.approximate,
        });
      }
      if (trust.level !== "pulse_only" && stressSnap.tier !== "none") {
        const tier =
          stressSnap.tier === "beats_180_plus" || stressSnap.tier === "beats_90_119"
            ? "stable90"
            : "fast60";
        this.bus.publish("stress", {
          percent: stressSnap.percent,
          rawIndex: stressSnap.rawIndex,
          segment: stressSnap.showInitialFinal ? "final" : "all",
          tier,
          approximate: stressSnap.approximate,
        });
      }
    }

    // 10) Coherence (только если активна сессия).
    //
    // ГОРЯЧИЙ ПУТЬ / ПЕРЕГРЕВ: `getSignalTrustSummary()` для fingerCamera прогоняет
    // `smoothBeatTimestampsMedian3ForMetrics` по ВСЕЙ растущей истории ударов + считает
    // drr/gap-статистику — это O(N) с аллокациями. Раньше он вызывался на КАЖДЫЙ кадр
    // камеры (~30 Гц) и с ростом сессии всё сильнее грел процессор, хотя нужен лишь как
    // гейт для 1-Гц публикации coherence. Теперь и trust, и `appendBeats` считаются
    // только на такте снапшота (≤1 Гц) и только когда сессия coherence реально активна.
    // Для camera-guidance-only сессия coherence вообще не стартует (экран её не открывает),
    // поэтому весь блок пропускается и горячий путь остаётся минимальным.
    if (
      this.coherence.isActive() &&
      sample.timestampMs - this.lastCoherenceSnapshotMs >= 1000
    ) {
      this.lastCoherenceSnapshotMs = sample.timestampMs;
      if (this.getSignalTrustSummary().level === "full_biometrics") {
        this.coherence.appendBeats(this.hrvAccumulator.getBeats());
        this.publishCoherenceIfNew(sample.timestampMs);
      }
    }
  }

  /**
   * Публикует `contact` только при реальных изменениях: смена `state`
   * (present/absent/weak), заметный сдвиг `signalQuality` (>
   * `CONTACT_QUALITY_EPSILON`) или heartbeat раз в секунду. Раньше событие
   * шло на каждый кадр (15-30 Hz) — за 20 минут это 18-36 тыс. публикаций,
   * и каждая пробуждала `snapshot-adapter`'s bump() → лишние рендеры UI.
   */
  private maybePublishContactEvent(
    timestampMs: number,
    state: "absent" | "weak" | "present",
    confidence: number,
    signalQuality: number,
    absentForMs: number,
  ): void {
    const stateChanged = state !== this.lastContactStatePublished;
    const qualityDelta = Math.abs(signalQuality - this.lastContactSignalQualityPublished);
    const qualityShiftSignificant = qualityDelta >= BiofeedbackPipeline.CONTACT_QUALITY_EPSILON;
    const heartbeatDue =
      timestampMs - this.lastContactEventMs >= BiofeedbackPipeline.CONTACT_HEARTBEAT_MS;
    if (!stateChanged && !qualityShiftSignificant && !heartbeatDue) {
      return;
    }
    this.lastContactStatePublished = state;
    this.lastContactSignalQualityPublished = signalQuality;
    this.lastContactEventMs = timestampMs;
    this.bus.publish("contact", {
      state,
      confidence,
      signalQuality,
      absentForMs,
    });
  }

  /**
   * Публикует `session` только если реально что-то изменилось: поменялась фаза,
   * сработал одноразовый флаг `becameReady/becameLost`, или прошёл «heartbeat»
   * в `SESSION_HEARTBEAT_MS` (для прогресс-индикаторов warmup/settle в UI).
   * Раньше на каждый кадр (30 Hz) публиковалось событие — за 20-минутную
   * практику 36 000 событий, и каждое будило snapshot-bump + обновляло history
   * ring на шине. Теперь — ≤ 1 Hz в стабильной фазе + моментально на смену.
   */
  private maybePublishSessionEvent(
    timestampMs: number,
    calSnap: CalibrationSnapshot,
  ): void {
    if (calSnap.becameLost) {
      this.sessionFingerLostAtMs = timestampMs;
    }
    const phaseChanged = calSnap.phase !== this.lastSessionEventPhase;
    const heartbeatDue =
      timestampMs - this.lastSessionEventMs >= BiofeedbackPipeline.SESSION_HEARTBEAT_MS;
    if (!phaseChanged && !calSnap.becameReady && !calSnap.becameLost && !heartbeatDue) {
      return;
    }
    this.lastSessionEventPhase = calSnap.phase;
    this.lastSessionEventMs = timestampMs;
    this.bus.publish("session", {
      phase: calSnap.phase,
      warmupElapsedMs: calSnap.warmupElapsedMs,
      settleGoodMsAccum: calSnap.settleGoodMsAccum,
      becameReady: calSnap.becameReady,
      becameLost: calSnap.becameLost,
    });
  }

  /**
   * «Мягкий» сброс: накопители ударов и калибровка — в начало, но Bus и подписки сохраняются.
   * Вызывается при потере контакта на > `WARMING_HARD_RESET_MS`.
   */
  softReset(): void {
    this.optical.reset();
    this.quality.reset();
    this.calibration.reset();
    this.livePulse.reset();
    this.hrvAccumulator.reset();
    this.mergedBeats = [];
    this.canonicalBeats = [];
    this.beatEligible = [];
    this.lastStableRrMs = 0;
    this.lastMedianRrMs = 0;
    this.lockState = "searching";
    this.lastPulseBpmPublishMs = 0;
    this.lastCoherenceSnapshotMs = 0;
    this.lastCoherenceRevisionPublished = 0;
    this.lastHrvStressComputeMs = 0;
    this.lastPeakDetectMs = 0;
    this.lastPulseBpmComputeMs = 0;
    this.lastPulseBpmSnapshot = null;
    this.lastSessionEventPhase = null;
    this.lastSessionEventMs = 0;
    this.lastContactStatePublished = null;
    this.lastContactSignalQualityPublished = 0;
    this.lastContactEventMs = 0;
    this.dicroticRejectedTotal = 0;
    this.splitArtifactRejectedTotal = 0;
    this.peakWindowsObserved = 0;
    this.lastRefractoryAdaptiveMs = 0;
    this.lastMedianRrInPeakWindowMs = 0;
    this.perfDiagnosticOpticalPushCount = 0;
    this.metricsCapturePaused = false;
    this.mirroredAccumulatorGapEventCount = 0;
  }

  /** Полный сброс — между экранами / при unmount. */
  reset(): void {
    this.softReset();
    this.contact.reset();
    this.coherence.reset();
    this.opticalPaused = false;
    this.metricsCapturePaused = false;
    this.sessionFingerGapEvents.length = 0;
    this.sessionFingerLostAtMs = null;
  }

  private syncSessionFingerGapEventsFromAccumulator(): void {
    const gapEvents = this.hrvAccumulator.getGapEvents();
    if (gapEvents.length < this.mirroredAccumulatorGapEventCount) {
      this.mirroredAccumulatorGapEventCount = gapEvents.length;
      return;
    }
    if (gapEvents.length === this.mirroredAccumulatorGapEventCount) {
      return;
    }
    for (const event of gapEvents.slice(this.mirroredAccumulatorGapEventCount)) {
      this.sessionFingerGapEvents.push(event);
    }
    this.mirroredAccumulatorGapEventCount = gapEvents.length;
  }

  private getSessionFingerGapEvents() {
    return this.sessionFingerGapEvents;
  }

  /** Проверка валидности RR (для UI / отладки). */
  isPulseRrValid(rrMs: number): boolean {
    return rrMs >= HRV_RR_HARD_MIN_MS && rrMs <= HRV_RR_HARD_MAX_MS;
  }

  /** Текущее состояние lock — для UI и адаптеров. */
  getLockState(): PulseLockState {
    return this.lockState;
  }

  /** Длительность недавнего tracking (для гистерезиса в UI). */
  isRecentlyTracking(nowTimestampMs: number): boolean {
    if (this.lockState === "tracking") return true;
    return false; // upstream check via SignalQualityMonitor.msSinceLastTracking уже учтён
  }

  /** Public ref на pulseLock recent threshold, чтобы не магичить в UI. */
  static readonly RECENT_TRACKING_MS = PULSE_LOCK_RECENT_TRACKING_MS;
}
