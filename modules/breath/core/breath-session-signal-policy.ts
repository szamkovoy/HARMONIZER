/**
 * Единые пороги политики сессии дыхания (сигнал / авто-стоп / застой кадров).
 * См. обсуждение: экстраполяция live-beat ≠ накопление HRV; гибрид real/emulated/real — отдельная ветка.
 */

/** Накопленное время условий авто-прерывания (wall), после чего сессия завершается (мс). */
export const BREATH_SESSION_SIGNAL_ABORT_MS = 12_000;

/**
 * Camera guidance-only: sustained signal loss before switching to emulated pacing.
 * Shorter finger-off gaps stay on interpolation/hold and must not zero measured pulse.
 */
export const BREATH_CAMERA_EMULATED_FALLBACK_MS = 20_000;

/** Minimum BLE prep time after the strap first reports live HR/RR before `running` starts. */
export const BREATH_BLE_PREP_MIN_LIVE_PULSE_MS = 2_000;

/** BLE prep UI: one full ring rotation before auto-start (ms). */
export const BREATH_BLE_PREP_SPIN_MS = 2_500;

/** Camera: beat older than this is not treated as a live measurement (hold/interpolate instead). */
export const BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS = 2_500;

/**
 * Если логическое время камеры (`getLastSourceTimestampMs`) не двигается дольше этого,
 * считаем поток optical «застывшим» (ОС/троттлинг), мс.
 */
export const BREATH_OPTICAL_STALL_HARD_MS = 2_000;
