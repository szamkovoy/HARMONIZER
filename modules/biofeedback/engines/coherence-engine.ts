/**
 * CoherenceEngine: stateful обёртка над `runCoherenceSessionAnalysis`.
 *
 * Контракт:
 *  - Engine не считает математику сам — вся логика (дедуп, очистка RR, тахограмма 4 Гц,
 *    FFT по секундам, медианный фильтр 3 с, RSA, время вхождения) живёт в
 *    [modules/breath/core/coherence-session-analysis.ts](../../breath/core/coherence-session-analysis.ts).
 *  - На каждый удар (`appendBeat`) или периодически (`tick`) engine может пересчитать
 *    результат для активной сессии.
 *  - При завершении сессии (`finalize`) выдаёт полный `CoherenceSessionResult`.
 *
 * Это даёт нам гарантированную parity с текущей реализацией коги/RSA: формулы не дублируются.
 */

import { COHERENCE_BEAT_DEDUPE_MS } from "@/modules/breath/core/coherence-constants";
import {
  buildCoherenceExportJson,
  dedupeBeatTimestampsMs,
  runCoherenceSessionAnalysis,
  type BreathAnalysisMode,
  type CoherenceExportDebug,
  type CoherencePulseLogEntry,
  type CoherenceSessionInput,
  type CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";

export const COHERENCE_ENGINE_VERSION = "engine/coherence@1.0";

export interface CoherenceSessionStartOptions {
  sessionStartedAtMs: number;
  inhaleMs: number;
  exhaleMs: number;
  mode: BreathAnalysisMode;
  /** Метки из QC-окна перед T=0 (для тахограммы — буфер). */
  preflightBeats?: readonly number[];
  bufferMsBeforeSession?: number;
}

export class CoherenceEngine {
  private active = false;
  private sessionStartedAtMs = 0;
  private inhaleMs = 5000;
  private exhaleMs = 5000;
  private mode: BreathAnalysisMode = "test120s";
  private bufferMsBeforeSession = 0;
  /** Полный merged ряд ударов за сессию (с буфером QC). Растёт от каждого `appendBeat`. */
  private sessionBeats: number[] = [];
  /** Маска принудительных нулей по секундам (плохой сигнал → BPM = 0 на тахограмме). */
  private secondBpmForcedZero: boolean[] = [];
  /** Последний кэшированный результат (для интервалов между finalize). */
  private cachedResult: CoherenceSessionResult | null = null;

  /** Стартует новую сессию. Очищает накопители. */
  startSession(opts: CoherenceSessionStartOptions): void {
    this.active = true;
    this.sessionStartedAtMs = opts.sessionStartedAtMs;
    this.inhaleMs = opts.inhaleMs;
    this.exhaleMs = opts.exhaleMs;
    this.mode = opts.mode;
    this.bufferMsBeforeSession = opts.bufferMsBeforeSession ?? 0;
    this.sessionBeats = [];
    if (opts.preflightBeats?.length) {
      this.sessionBeats.push(...opts.preflightBeats);
    }
    this.secondBpmForcedZero = [];
    this.cachedResult = null;
  }

  /** Добавляет новые удары из merged-ленты в активную сессию (сам дедуплицирует). */
  appendBeats(merged: readonly number[]): void {
    if (!this.active) return;
    this.sessionBeats = dedupeBeatTimestampsMs(
      [...this.sessionBeats, ...merged],
      COHERENCE_BEAT_DEDUPE_MS,
    );
  }

  /** Помечает секунду относительно session start как «не считать BPM» (плохой сигнал). */
  forceSecondBpmZero(secondIndex: number, totalSeconds: number): void {
    if (!this.active) return;
    if (this.secondBpmForcedZero.length < totalSeconds) {
      const fill = new Array(totalSeconds - this.secondBpmForcedZero.length).fill(false);
      this.secondBpmForcedZero.push(...fill);
    }
    if (secondIndex >= 0 && secondIndex < this.secondBpmForcedZero.length) {
      this.secondBpmForcedZero[secondIndex] = true;
    }
  }

  /** Снапшот текущей когерентности (для UI: «вот сейчас столько процентов»). */
  snapshot(nowMs: number): CoherenceSessionResult | null {
    if (!this.active) return null;
    return this.runAnalysis(nowMs);
  }

  /** Финализирует сессию: вызывается по окончании практики; результат кэшируется. */
  finalize(sessionEndedAtMs: number): CoherenceSessionResult {
    if (!this.active) {
      throw new Error("CoherenceEngine.finalize() called without active session");
    }
    this.active = false;
    this.cachedResult = this.runAnalysis(sessionEndedAtMs);
    return this.cachedResult;
  }

  /** Полный JSON для экспорта (legacy v2 schema). v3 — отдельный SessionExporter. */
  buildExportJson(
    sessionEndedAtMs: number,
    options?: {
      dataSource?: "fingerPpg" | "simulated";
      debug?: CoherenceExportDebug;
      pulseLog?: readonly CoherencePulseLogEntry[];
    },
  ) {
    const result = this.cachedResult ?? this.finalize(sessionEndedAtMs);
    const input: CoherenceSessionInput = {
      sessionStartedAtMs: this.sessionStartedAtMs,
      sessionEndedAtMs,
      beatTimestampsMs: this.sessionBeats,
      inhaleMs: this.inhaleMs,
      exhaleMs: this.exhaleMs,
      mode: this.mode,
      bufferMsBeforeSession: this.bufferMsBeforeSession,
      secondBpmForcedZero: this.secondBpmForcedZero,
    };
    return buildCoherenceExportJson(input, result, options);
  }

  /** Полный набор сырых ударов за сессию (для экспорта v3). */
  getSessionBeats(): readonly number[] {
    return this.sessionBeats;
  }

  /**
   * Из snapshot'а текущей сессии вытаскивает **последний завершённый** RSA-цикл —
   * используется `BreathPhasePlanner` для корректировки длительностей следующего цикла.
   * null — если активной сессии нет или ни один цикл ещё не закрыт.
   *
   * Трактовка: в `CoherenceSessionResult` фиксируются `hrMax`/`hrMin` на окне одного
   * дыхательного цикла; «вдох в начале цикла» приводит к подъёму HR → `hrMax ≈ hrInhale`,
   * «выдох во второй половине» — к спаду → `hrMin ≈ hrExhale`.
   */
  extractLastCompletedRsaCycle(snapshotResult: CoherenceSessionResult | null):
    | { hrInhale: number; hrExhale: number; rsaBpm: number; durationMs: number }
    | null {
    if (!snapshotResult) return null;
    for (let i = snapshotResult.rsaCycles.length - 1; i >= 0; i -= 1) {
      const c = snapshotResult.rsaCycles[i]!;
      if (c.inactive) continue;
      return {
        hrInhale: c.hrMax,
        hrExhale: c.hrMin,
        rsaBpm: c.rsaBpm,
        durationMs: c.endMs - c.startMs,
      };
    }
    return null;
  }

  reset(): void {
    this.active = false;
    this.sessionStartedAtMs = 0;
    this.inhaleMs = 5000;
    this.exhaleMs = 5000;
    this.mode = "test120s";
    this.bufferMsBeforeSession = 0;
    this.sessionBeats = [];
    this.secondBpmForcedZero = [];
    this.cachedResult = null;
  }

  isActive(): boolean {
    return this.active;
  }

  private runAnalysis(endMs: number): CoherenceSessionResult {
    const input: CoherenceSessionInput = {
      sessionStartedAtMs: this.sessionStartedAtMs,
      sessionEndedAtMs: endMs,
      beatTimestampsMs: this.sessionBeats,
      inhaleMs: this.inhaleMs,
      exhaleMs: this.exhaleMs,
      mode: this.mode,
      bufferMsBeforeSession: this.bufferMsBeforeSession,
      secondBpmForcedZero: this.secondBpmForcedZero,
    };
    return runCoherenceSessionAnalysis(input);
  }
}
