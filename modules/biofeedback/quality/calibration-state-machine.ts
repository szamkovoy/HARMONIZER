/**
 * CalibrationStateMachine: единый протокол подготовки к практике.
 *
 *   idle → contactSearch → warmup(10 s) → settle(10 s) → ready
 *
 * Переходы:
 *  - `contactSearch`  : ждём, пока ContactMonitor скажет `present`.
 *  - `warmup`         : 10 s «прогрева» при контакте; при потере контакта возвращаемся в contactSearch.
 *  - `settle`         : 10 s окно проверки tracking; нужно набрать `PULSE_SETTLE_GOOD_FRAC` хороших мс.
 *                       При неудаче окно повторяется с того же warmup-уровня (без нового прогрева).
 *  - `ready`          : калибровка успешна; engines (HRV, Stress, Coherence, RSA) могут начинать.
 *  - `lost`           : после `ready` контакт потерян > порога — engines заморозят свои окна.
 *
 * Это унифицирует три разных «стартовых» протокола, которые раньше жили в разных местах.
 */

import {
  PULSE_SETTLE_GOOD_FRAC,
  PULSE_SETTLE_MS,
  WARMING_PHASE_MS,
} from "@/modules/biofeedback/constants";

export type CalibrationPhase =
  | "idle"
  | "contactSearch"
  | "warmup"
  | "settle"
  | "ready"
  | "lost";

export interface CalibrationSnapshot {
  phase: CalibrationPhase;
  /** Сколько мс прошло в текущей фазе. */
  phaseElapsedMs: number;
  /** Сколько мс прошло в фазе warmup за всю текущую сессию контакта (монотонно растёт). */
  warmupElapsedMs: number;
  /** Сколько мс «хороших» интервалов накоплено в текущем окне settle. */
  settleGoodMsAccum: number;
  /** Стало ли только что `ready` именно сейчас (одноразовый флаг для подписчиков). */
  becameReady: boolean;
  /** Стало ли только что `lost` (сигнал прервался после ready). */
  becameLost: boolean;
}

export interface CalibrationInput {
  timestampMs: number;
  contactPresent: boolean;
  /** Есть ли «хорошая» секунда: tracking + хорошая пара RR в этом кадре. */
  goodSettleTick: boolean;
  /** Контакт потерян (для перехода ready → lost). */
  contactLost: boolean;
}

export class CalibrationStateMachine {
  private phase: CalibrationPhase = "idle";
  private phaseStartTimestampMs = 0;
  private warmupElapsedMs = 0;
  private settleWindowStartTimestampMs = 0;
  private settleGoodMsAccum = 0;
  private lastTimestampMs = 0;

  push(input: CalibrationInput): CalibrationSnapshot {
    const { timestampMs, contactPresent, goodSettleTick, contactLost } = input;
    const frameDeltaMs =
      this.lastTimestampMs > 0 ? Math.min(timestampMs - this.lastTimestampMs, 500) : 0;
    this.lastTimestampMs = timestampMs;

    let becameReady = false;
    let becameLost = false;

    if (this.phase === "idle") {
      this.transition("contactSearch", timestampMs);
    }

    if (this.phase === "contactSearch") {
      if (contactPresent) {
        this.transition("warmup", timestampMs);
      }
    }

    if (this.phase === "warmup") {
      if (!contactPresent) {
        this.transition("contactSearch", timestampMs);
      } else {
        this.warmupElapsedMs += frameDeltaMs;
        if (this.warmupElapsedMs >= WARMING_PHASE_MS) {
          this.transition("settle", timestampMs);
          this.settleWindowStartTimestampMs = timestampMs;
          this.settleGoodMsAccum = 0;
        }
      }
    }

    if (this.phase === "settle") {
      if (!contactPresent) {
        this.transition("contactSearch", timestampMs);
        this.warmupElapsedMs = 0;
      } else {
        if (goodSettleTick) {
          this.settleGoodMsAccum += frameDeltaMs;
        }
        const elapsedInWindow = timestampMs - this.settleWindowStartTimestampMs;
        if (elapsedInWindow >= PULSE_SETTLE_MS) {
          if (this.settleGoodMsAccum >= PULSE_SETTLE_MS * PULSE_SETTLE_GOOD_FRAC) {
            this.transition("ready", timestampMs);
            becameReady = true;
          } else {
            this.settleWindowStartTimestampMs = timestampMs;
            this.settleGoodMsAccum = 0;
          }
        }
      }
    }

    if (this.phase === "ready") {
      if (contactLost) {
        this.transition("lost", timestampMs);
        becameLost = true;
      }
    }

    if (this.phase === "lost") {
      if (contactPresent) {
        this.transition("contactSearch", timestampMs);
        this.warmupElapsedMs = 0;
      }
    }

    return {
      phase: this.phase,
      phaseElapsedMs: timestampMs - this.phaseStartTimestampMs,
      warmupElapsedMs: this.warmupElapsedMs,
      settleGoodMsAccum: this.settleGoodMsAccum,
      becameReady,
      becameLost,
    };
  }

  private transition(next: CalibrationPhase, timestampMs: number): void {
    this.phase = next;
    this.phaseStartTimestampMs = timestampMs;
  }

  /** Текущая фаза без push (для опросов). */
  getPhase(): CalibrationPhase {
    return this.phase;
  }

  /** Полный сброс — например при навигации с экрана. */
  reset(): void {
    this.phase = "idle";
    this.phaseStartTimestampMs = 0;
    this.warmupElapsedMs = 0;
    this.settleWindowStartTimestampMs = 0;
    this.settleGoodMsAccum = 0;
    this.lastTimestampMs = 0;
  }
}
