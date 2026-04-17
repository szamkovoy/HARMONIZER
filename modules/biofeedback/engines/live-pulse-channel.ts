/**
 * LivePulseChannel: эмитит события «удар сердца» в режиме реального времени.
 *
 * Контракт (см. план рефакторинга):
 *  - При `tracking` публикуются реально распознанные удары (новые метки в merged-ленте,
 *    которых не было на прошлом кадре).
 *  - При `holding` (последние реальные удары стабильны, но новых нет) — в течение
 *    `LIVE_PULSE_EXTRAPOLATION_MAX_MS` (2 с) канал выдаёт **экстраполированные** тики
 *    с периодом последнего стабильного RR.
 *  - После 2 с без реальных ударов — событие `heartbeatLost` (флаг `lost: true` на следующем push).
 *  - При возврате реальных ударов — флаг `recovered: true` и публикация снова.
 *
 * Интерфейс stateful: на каждый кадр (push) возвращает массив новых событий за этот тик.
 * Bus подписывается и форвардит их потребителям (Breath sync, Mandala pulsation).
 */

import {
  LIVE_PULSE_EXTRAPOLATION_MAX_MS,
  LIVE_PULSE_MIN_INTERVAL_MS,
} from "@/modules/biofeedback/constants";
import type { BeatEvent } from "@/modules/biofeedback/sensors/types";
import type { PulseLockState } from "@/modules/biofeedback/core/types";

export interface LivePulseInput {
  /** Текущее время кадра. */
  timestampMs: number;
  /** Список ударов в merged-ленте за все сэмплы (отсортирован, дедуплицирован). */
  mergedBeats: readonly number[];
  /** Текущее состояние lock пульса. */
  pulseLockState: PulseLockState;
  /** Текущий стабильный RR (мс) — используется для экстраполяции тиков в holding. */
  lastStableRrMs: number;
  /** Камера видит палец прямо сейчас. */
  fingerDetected: boolean;
}

export interface LivePulseTick {
  /** Реальный или экстраполированный удар. */
  beat: BeatEvent;
  /** Удар прибыл с реальным распознанным периодом. */
  isReal: boolean;
}

export interface LivePulseSnapshot {
  /** Новые события удара за этот push (могут быть пустыми). */
  newTicks: LivePulseTick[];
  /** Флаг «связь с пульсом потеряна» — true одноразово, на push после порога. */
  heartbeatLost: boolean;
  /** Флаг «связь восстановлена» — true одноразово, на push при возврате tracking. */
  heartbeatRecovered: boolean;
  /** Время последнего реального удара (мс). */
  lastRealBeatMs: number;
  /** Время последнего опубликованного тика (real или extrapolated). */
  lastEmittedTickMs: number;
}

export class LivePulseChannel {
  private lastEmittedRealBeatMs = 0;
  private lastEmittedTickMs = 0;
  /** Уже сообщили о потере связи — не дублируем флаг до восстановления. */
  private heartbeatLostReported = false;
  /** Сколько ударов было в последнем merged для дельты. */
  private lastMergedLength = 0;
  private lastMergedTail: number[] = [];

  push(input: LivePulseInput): LivePulseSnapshot {
    const { timestampMs, mergedBeats, pulseLockState, lastStableRrMs, fingerDetected } = input;
    const newTicks: LivePulseTick[] = [];

    // 1) Найти реально новые удары (которых нет в lastMergedTail).
    const tail = mergedBeats.slice(-Math.min(mergedBeats.length, 16));
    const realNewBeats: number[] = [];
    for (const t of tail) {
      const seen = this.lastMergedTail.some(
        (prev) => Math.abs(prev - t) <= LIVE_PULSE_MIN_INTERVAL_MS / 2,
      );
      if (!seen && t > this.lastEmittedRealBeatMs + LIVE_PULSE_MIN_INTERVAL_MS / 2) {
        realNewBeats.push(t);
      }
    }
    this.lastMergedTail = [...tail];
    this.lastMergedLength = mergedBeats.length;

    let heartbeatRecovered = false;

    // 2) Опубликовать реальные удары (только при tracking + контакте — иначе ритм недостоверен).
    if (
      pulseLockState === "tracking" &&
      fingerDetected &&
      realNewBeats.length > 0
    ) {
      for (const t of realNewBeats) {
        if (t - this.lastEmittedTickMs >= LIVE_PULSE_MIN_INTERVAL_MS) {
          newTicks.push({
            beat: { timestampMs: t, source: "detected", confidence: 1 },
            isReal: true,
          });
          this.lastEmittedTickMs = t;
          this.lastEmittedRealBeatMs = t;
        }
      }
      if (this.heartbeatLostReported) {
        heartbeatRecovered = true;
        this.heartbeatLostReported = false;
      }
    }

    // 3) Экстраполяция: если новых реальных ударов нет, но стабильный период известен и
    //    потеря не превысила лимит — выдаём «нарисованные» тики с этим периодом.
    let heartbeatLost = false;
    if (
      newTicks.length === 0 &&
      this.lastEmittedTickMs > 0 &&
      lastStableRrMs > 0
    ) {
      const sinceLastReal = timestampMs - this.lastEmittedRealBeatMs;
      const canExtrapolate =
        fingerDetected &&
        sinceLastReal <= LIVE_PULSE_EXTRAPOLATION_MAX_MS &&
        (pulseLockState === "tracking" || pulseLockState === "holding");

      if (canExtrapolate) {
        // Сколько тиков должно было «поместиться» с момента последнего опубликованного?
        const sinceLastEmitted = timestampMs - this.lastEmittedTickMs;
        const ticksToEmit = Math.floor(sinceLastEmitted / lastStableRrMs);
        for (let k = 1; k <= ticksToEmit; k += 1) {
          const tickMs = this.lastEmittedTickMs + lastStableRrMs;
          newTicks.push({
            beat: { timestampMs: tickMs, source: "extrapolated", confidence: 0.6 },
            isReal: false,
          });
          this.lastEmittedTickMs = tickMs;
        }
      } else if (
        sinceLastReal > LIVE_PULSE_EXTRAPOLATION_MAX_MS &&
        !this.heartbeatLostReported &&
        this.lastEmittedRealBeatMs > 0
      ) {
        heartbeatLost = true;
        this.heartbeatLostReported = true;
      }
    }

    return {
      newTicks,
      heartbeatLost,
      heartbeatRecovered,
      lastRealBeatMs: this.lastEmittedRealBeatMs,
      lastEmittedTickMs: this.lastEmittedTickMs,
    };
  }

  reset(): void {
    this.lastEmittedRealBeatMs = 0;
    this.lastEmittedTickMs = 0;
    this.heartbeatLostReported = false;
    this.lastMergedLength = 0;
    this.lastMergedTail = [];
  }
}
