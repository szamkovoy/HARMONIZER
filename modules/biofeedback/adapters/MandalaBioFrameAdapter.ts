/**
 * MandalaBioFrameAdapter: подписывается на каналы BiofeedbackBus и периодически отдаёт
 * `BioSignalFrame` для рантайма Mandala (Skia-визуализатор).
 *
 * Заменяет старый `core/mandala-adapter.ts`, который требовал «BiofeedbackFrame»-снимок
 * (одно сообщение со всеми полями). Теперь данные приходят асинхронно из разных engines,
 * адаптер агрегирует последние значения и эмитит фреймы по запросу (или подписке).
 *
 * Использование:
 *
 *   const adapter = new MandalaBioFrameAdapter(bus);
 *   const frame = adapter.snapshot();    // текущий фрейм для одного render-кадра
 *   const unsub = adapter.subscribe((frame) => mandalaRuntime.applyBioFrame(frame));
 */

import type { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import {
  normalizeBreathRate,
  normalizePulseRate,
  normalizeRmssd,
  normalizeStressIndex,
} from "@/modules/biofeedback/core/metrics";
import type { BioSignalFrame } from "@/modules/mandala/core/types";

export class MandalaBioFrameAdapter {
  /** Внутренние счётчики «фазы» — для генерации pulsePhase / breathPhase из событий beat. */
  private lastBeatTimestampMs = 0;
  private lastBeatPeriodMs = 1000;
  /** EMA-сглаживание дисплея (можно вынести в опции). */
  private displayPulseBpm = 0;
  private displayRmssdMs = 0;
  private displayStressPercent = 0;
  private displayCoherencePercent = 0;
  private signalQuality = 0;
  /** Задаётся при первом изменении контакта. */
  private fingerPresent = false;

  constructor(private readonly bus: BiofeedbackBus) {}

  /** Подписывается на нужные каналы. Возвращает unsubscribe. */
  attach(): () => void {
    const unsubs: Array<() => void> = [];
    unsubs.push(
      this.bus.subscribe("beat", (e) => {
        if (this.lastBeatTimestampMs > 0) {
          this.lastBeatPeriodMs = Math.max(
            300,
            e.beat.timestampMs - this.lastBeatTimestampMs,
          );
        }
        this.lastBeatTimestampMs = e.beat.timestampMs;
      }),
      this.bus.subscribe("pulseBpm", (e) => {
        this.displayPulseBpm = e.bpm;
      }),
      this.bus.subscribe("rmssd", (e) => {
        this.displayRmssdMs = e.rmssdMs;
      }),
      this.bus.subscribe("stress", (e) => {
        this.displayStressPercent = e.percent;
      }),
      this.bus.subscribe("coherence", (e) => {
        this.displayCoherencePercent = e.currentPercent;
      }),
      this.bus.subscribe("contact", (e) => {
        this.fingerPresent = e.state === "present";
        this.signalQuality = Math.min(1, Math.max(0, e.confidence));
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }

  /** Текущий снимок BioSignalFrame для одного кадра рендера. */
  snapshot(nowMs: number = performance.now()): BioSignalFrame {
    const elapsedSinceBeatMs = nowMs - this.lastBeatTimestampMs;
    const period = Math.max(300, this.lastBeatPeriodMs);
    const pulsePhase =
      this.lastBeatTimestampMs > 0
        ? ((elapsedSinceBeatMs % period) + period) % period / period
        : 0.5;
    return {
      breathPhase: 0.5,
      pulsePhase,
      breathRate: normalizeBreathRate(0),
      pulseRate: normalizePulseRate(this.displayPulseBpm),
      rmssd: normalizeRmssd(this.displayRmssdMs),
      stressIndex: normalizeStressIndex(this.displayStressPercent),
      signalQuality: this.signalQuality,
      source: this.fingerPresent ? "fingerPpg" : "offline",
    };
  }

  /**
   * Подписка с тиком ~60 fps (через requestAnimationFrame) — Mandala получает фрейм
   * каждый раз, когда мы можем что-то обновить. Возвращает функцию остановки.
   */
  subscribe(listener: (frame: BioSignalFrame) => void): () => void {
    let rafId = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      listener(this.snapshot());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }
}
