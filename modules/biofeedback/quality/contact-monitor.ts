/**
 * ContactMonitor: следит за физическим контактом пальца с камерой по уверенности присутствия
 * с гистерезисом (track > hold) и счётчиком отсутствия (для жёсткого reset калибровки).
 */

import {
  FINGER_PRESENCE_HOLD_THRESHOLD,
  FINGER_PRESENCE_TRACK_THRESHOLD,
  WARMING_HARD_RESET_MS,
} from "@/modules/biofeedback/constants";

export type ContactState = "absent" | "weak" | "present";

export interface ContactSnapshot {
  state: ContactState;
  confidence: number;
  /** Сколько мс палец отсутствует подряд (0, если контакт сейчас есть). */
  absentForMs: number;
  /** Накопленное время контакта (монотонно растёт; сбрасывается только при hard-reset). */
  contactElapsedMs: number;
  /** Достигнут ли порог жёсткого сброса (палец отсутствует ≥ `WARMING_HARD_RESET_MS`). */
  shouldHardReset: boolean;
}

export class ContactMonitor {
  private fingerAbsentSinceMs = 0;
  private contactElapsedMs = 0;
  private lastTimestampMs = 0;

  push(timestampMs: number, presenceConfidence: number): ContactSnapshot {
    const frameDeltaMs =
      this.lastTimestampMs > 0 ? Math.min(timestampMs - this.lastTimestampMs, 500) : 0;
    this.lastTimestampMs = timestampMs;

    const isPresent = presenceConfidence >= FINGER_PRESENCE_TRACK_THRESHOLD;
    const isWeak =
      !isPresent && presenceConfidence >= FINGER_PRESENCE_HOLD_THRESHOLD;

    let absentForMs = 0;
    if (isPresent) {
      this.fingerAbsentSinceMs = 0;
      this.contactElapsedMs += frameDeltaMs;
    } else if (this.contactElapsedMs > 0) {
      if (this.fingerAbsentSinceMs === 0) {
        this.fingerAbsentSinceMs = timestampMs;
      }
      absentForMs = timestampMs - this.fingerAbsentSinceMs;
    }

    const shouldHardReset = absentForMs > WARMING_HARD_RESET_MS;
    if (shouldHardReset) {
      this.contactElapsedMs = 0;
      this.fingerAbsentSinceMs = 0;
    }

    const state: ContactState = isPresent ? "present" : isWeak ? "weak" : "absent";

    return {
      state,
      confidence: presenceConfidence,
      absentForMs,
      contactElapsedMs: this.contactElapsedMs,
      shouldHardReset,
    };
  }

  reset(): void {
    this.fingerAbsentSinceMs = 0;
    this.contactElapsedMs = 0;
    this.lastTimestampMs = 0;
  }
}
