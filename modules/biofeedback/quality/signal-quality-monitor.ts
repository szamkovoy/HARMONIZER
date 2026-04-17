/**
 * SignalQualityMonitor: тонкая обёртка вокруг `calculateSignalQuality` + хранение трендов.
 *
 * Сейчас почти не имеет состояния (вся математика в `OpticalRingBuffer`), но является явной
 * точкой расширения: гистерезис, EMA качества, флаги ситуаций.
 */

import {
  HRV_QUALITY_THRESHOLD,
  QUALITY_HYSTERESIS_DROP,
  STABLE_LOCK_QUALITY_THRESHOLD,
} from "@/modules/biofeedback/constants";

export interface QualitySnapshot {
  value: number;
  /** Качество достаточно для tracking сейчас (с учётом гистерезиса по последнему tracking). */
  enoughForTracking: boolean;
  /** Качество достаточно для расчёта HRV. */
  enoughForHrv: boolean;
  /** Сколько мс назад последний раз была качественная фаза tracking (0 если сейчас). */
  msSinceLastTracking: number;
}

export class SignalQualityMonitor {
  private lastTrackingTimestampMs = 0;

  push(
    timestampMs: number,
    quality: number,
    isCurrentlyTracking: boolean,
  ): QualitySnapshot {
    if (isCurrentlyTracking) {
      this.lastTrackingTimestampMs = timestampMs;
    }

    const recentlyTracking =
      this.lastTrackingTimestampMs > 0 &&
      timestampMs - this.lastTrackingTimestampMs < 2_000;
    const effectiveTrackingThreshold = recentlyTracking
      ? QUALITY_HYSTERESIS_DROP
      : STABLE_LOCK_QUALITY_THRESHOLD;

    return {
      value: quality,
      enoughForTracking: quality >= effectiveTrackingThreshold,
      enoughForHrv: quality >= HRV_QUALITY_THRESHOLD,
      msSinceLastTracking:
        this.lastTrackingTimestampMs > 0
          ? timestampMs - this.lastTrackingTimestampMs
          : Number.POSITIVE_INFINITY,
    };
  }

  reset(): void {
    this.lastTrackingTimestampMs = 0;
  }
}
