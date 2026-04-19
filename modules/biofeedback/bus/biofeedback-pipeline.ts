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
  syncEligibilityByNearestTime,
  trimBeatHistory,
} from "@/modules/biofeedback/signal/beat-merger";
import {
  OpticalRingBuffer,
  movingAverage3,
} from "@/modules/biofeedback/signal/optical-pipeline";

import { ContactMonitor } from "@/modules/biofeedback/quality/contact-monitor";
import { SignalQualityMonitor } from "@/modules/biofeedback/quality/signal-quality-monitor";
import { CalibrationStateMachine } from "@/modules/biofeedback/quality/calibration-state-machine";

import {
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
import type { PulseSourceKind } from "@/modules/biofeedback/engines/types";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

const PULSE_LOCK_RECENT_TRACKING_MS = 2_000;

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
  private lockState: PulseLockState = "searching";
  private lastPulseBpmPublishMs = 0;
  private lastCoherenceSnapshotMs = 0;
  private pulseSource: PulseSourceKind = "none";

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
    this.bus.publish("pulseSource", {
      kind,
      isEmulated: kind === "emulated",
    });
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
    const merged = mergeBeatTimestampsPhase1(
      this.mergedBeats,
      [beatTimestampMs],
      this.mergedBeats[0] ?? beatTimestampMs,
    );
    this.mergedBeats = trimBeatHistory(merged, timestampMs);
    this.canonicalBeats = [...this.mergedBeats];
    this.beatEligible = this.mergedBeats.map(() => true);

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
      });
      this.lastStableRrMs = bpmSnap.medianRrMs || this.lastStableRrMs;
      this.lastMedianRrMs = bpmSnap.medianRrMs || this.lastMedianRrMs;
      this.canonicalBeats = bpmSnap.filteredBeatTimestampsMs;
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
      });
    }

    // HRV/Stress/Coherence: при эмулированном пульсе (SimulatedSensor / EmulatedPulseSensor)
    // вычислять их бессмысленно — ритм заранее известен и задан синтетически. Чтобы UI не
    // показывал «фантомные» метрики, ничего не публикуем. Симулятор в Expo Go остаётся
    // прежним (там есть RR-модуляция, метрики полезны для отладки пайплайна) — поэтому
    // исключение только для `emulated`.
    const shouldSkipDerivedMetrics = this.pulseSource === "emulated";

    if (this.hrvAccumulator.isReady() && !shouldSkipDerivedMetrics) {
      this.hrvAccumulator.ingest(this.canonicalBeats, this.beatEligible, timestampMs);
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

    if (this.coherence.isActive() && !shouldSkipDerivedMetrics) {
      this.coherence.appendBeats(this.canonicalBeats);
      if (timestampMs - this.lastCoherenceSnapshotMs >= 1000) {
        this.lastCoherenceSnapshotMs = timestampMs;
        const snap = this.coherence.snapshot(timestampMs);
        if (snap) {
          const last = snap.perSecond[snap.perSecond.length - 1];
          this.bus.publish("coherence", {
            currentPercent: last?.coherenceMappedPercent ?? 0,
            averagePercent: snap.coherenceAveragePercent ?? 0,
            maxPercent: snap.coherenceMaxPercent ?? 0,
            smoothedSeries: snap.perSecondSmoothed.map((s) => s.coherenceMappedPercent),
            entryTimeSec: snap.entryTimeSec,
            lastCompletedRsaCycle: this.coherence.extractLastCompletedRsaCycle(snap),
          });
        }
      }
    }
  }

  /** Для beat-источников (симулятор, watch): пометить калибровку готовой вручную. */
  markCalibrationCompleteForBeatSource(timestampMs: number): void {
    this.hrvAccumulator.markCalibrationComplete(timestampMs);
  }

  /** Подаёт сырой кадр в конвейер. */
  pushOpticalSample(sample: RawOpticalSample): void {
    // 1) Optical pipeline.
    const opt = this.optical.push(sample);
    this.bus.publish("optical", sample);

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
    this.bus.publish("contact", {
      state: contactSnap.state,
      confidence: contactSnap.confidence,
      signalQuality: qualitySnap.value,
      absentForMs: contactSnap.absentForMs,
    });

    // 3) Peak detection + merge (только после прогрева).
    const calibrationPhaseBefore = this.calibration.getPhase();
    const inWarmupOrEarlier =
      calibrationPhaseBefore === "idle" ||
      calibrationPhaseBefore === "contactSearch" ||
      calibrationPhaseBefore === "warmup";

    let detectedBeatsThisFrame: number[] = [];
    if (!inWarmupOrEarlier) {
      const samples = this.optical.getSamples();
      const detrendedValues = samples.map((p) => p.opticalValue - opt.baseline);
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

    const prevMerged = [...this.mergedBeats];
    const prevEligible = [...this.beatEligible];
    let merged = mergeBeatTimestampsPhase1(
      this.mergedBeats,
      detectedBeatsThisFrame,
      this.optical.getSamples()[0]?.timestampMs ?? sample.timestampMs,
    );
    merged = trimBeatHistory(merged, sample.timestampMs);
    const collapsed = collapseSplitMergedBeats(merged);
    merged = collapsed.beats;
    this.splitArtifactRejectedTotal += collapsed.removedCount;
    this.mergedBeats = merged;
    this.beatEligible = syncEligibilityByNearestTime(
      merged,
      prevMerged,
      prevEligible,
      this.lockState === "tracking",
    );

    // 4) Pulse BPM (для обновления lockState и публикации).
    const bpmSnap = this.pulseBpm.push({
      timestampMs: sample.timestampMs,
      mergedBeats: merged,
    });

    this.canonicalBeats = bpmSnap.filteredBeatTimestampsMs;
    const canonicalEligible = syncEligibilityByNearestTime(
      this.canonicalBeats,
      merged,
      this.beatEligible,
      this.lockState === "tracking",
    );

    const hasFreshBeat =
      merged.length > 0 && sample.timestampMs - merged[merged.length - 1]! <= 4_200;
    const hasValidBpm =
      bpmSnap.bpm >= this.config.minPulseBpm && bpmSnap.bpm <= this.config.maxPulseBpm;
    const trackingNow =
      contactSnap.state === "present" &&
      qualitySnap.enoughForTracking &&
      hasFreshBeat &&
      hasValidBpm &&
      bpmSnap.looksCoherent;

    if (bpmSnap.medianRrMs > 0) {
      // Планировщику дыхания полезен свежий median RR даже в holding,
      // чтобы следующий цикл планировался не от устаревшего baseline.
      this.lastMedianRrMs = bpmSnap.medianRrMs;
    }
    if (trackingNow) {
      this.lockState = "tracking";
      this.lastStableRrMs = bpmSnap.medianRrMs;
    } else if (this.lockState === "tracking") {
      // Переход в hold — позволяем engines использовать последний стабильный RR.
      this.lockState = "holding";
    }

    // 5) Calibration FSM.
    const calSnap = this.calibration.push({
      timestampMs: sample.timestampMs,
      contactPresent: contactSnap.state === "present",
      goodSettleTick: trackingNow,
      contactLost: contactSnap.state !== "present",
    });
    this.bus.publish("session", {
      phase: calSnap.phase,
      warmupElapsedMs: calSnap.warmupElapsedMs,
      settleGoodMsAccum: calSnap.settleGoodMsAccum,
      becameReady: calSnap.becameReady,
      becameLost: calSnap.becameLost,
    });
    if (calSnap.becameReady) {
      this.hrvAccumulator.markCalibrationComplete(sample.timestampMs);
    }

    // 6) HRV accumulator (только после ready).
    if (this.hrvAccumulator.isReady()) {
      this.hrvAccumulator.ingest(this.canonicalBeats, canonicalEligible, sample.timestampMs);
    }

    // 7) Live pulse channel.
    const liveSnap = this.livePulse.push({
      timestampMs: sample.timestampMs,
      mergedBeats: merged,
      pulseLockState: this.lockState,
      lastStableRrMs: this.lastStableRrMs,
      fingerDetected: contactSnap.state === "present",
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
      });
    }

    // 9) HRV / Stress (после ready).
    if (this.hrvAccumulator.isReady() && qualitySnap.enoughForHrv) {
      const beats = this.hrvAccumulator.getBeats();
      const hrvSnap = this.hrv.push(beats);
      const stressSnap = this.stress.push(beats);
      // Публикуем только если есть рассчитанный тиер и валидные ударов ≥ minimum.
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

    // 10) Coherence (только если активна сессия).
    if (this.coherence.isActive()) {
      this.coherence.appendBeats(this.canonicalBeats);
      // Публикуем снимок раз в секунду.
      if (sample.timestampMs - this.lastCoherenceSnapshotMs >= 1000) {
        this.lastCoherenceSnapshotMs = sample.timestampMs;
        const snap = this.coherence.snapshot(sample.timestampMs);
        if (snap) {
          const last = snap.perSecond[snap.perSecond.length - 1];
          this.bus.publish("coherence", {
            currentPercent: last?.coherenceMappedPercent ?? 0,
            averagePercent: snap.coherenceAveragePercent ?? 0,
            maxPercent: snap.coherenceMaxPercent ?? 0,
            smoothedSeries: snap.perSecondSmoothed.map((s) => s.coherenceMappedPercent),
            entryTimeSec: snap.entryTimeSec,
            lastCompletedRsaCycle: this.coherence.extractLastCompletedRsaCycle(snap),
          });
        }
      }
    }
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
    this.dicroticRejectedTotal = 0;
    this.splitArtifactRejectedTotal = 0;
    this.peakWindowsObserved = 0;
    this.lastRefractoryAdaptiveMs = 0;
    this.lastMedianRrInPeakWindowMs = 0;
  }

  /** Полный сброс — между экранами / при unmount. */
  reset(): void {
    this.softReset();
    this.contact.reset();
    this.coherence.reset();
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
