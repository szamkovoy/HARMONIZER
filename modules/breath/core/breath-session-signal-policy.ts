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

/**
 * Camera guidance-only: START-of-running grace. If the practice has just entered `running`
 * and NO trusted (coherent/bridging) beat has arrived yet, switch to emulated pacing after
 * this much beat-staleness instead of waiting the full 20 s. Reason: on a marginal-PPG start
 * the peak detector can lose lock during settle's tail (last beat ~10 s before `running`),
 * so by t=0 the staleness clock is already ~10 s — the practice would otherwise sit on a
 * gray, non-pacing measurement graph for ~10 s until the 20 s threshold fires. The product
 * spec says a long loss must switch to a synthetic sine wave so breathing continues; at
 * start there is no "brief hiccup to recover from" (no prior live running beat), so a short
 * grace is safe and matches the spec. Once a trusted beat arrives in running, the full 20 s
 * threshold resumes for the rest of the session (mid-session brief losses stay on bridge/hold).
 */
export const BREATH_CAMERA_EMULATED_START_GRACE_MS = 4_000;

/** Minimum BLE prep time after the strap first reports live HR/RR before `running` starts. */
export const BREATH_BLE_PREP_MIN_LIVE_PULSE_MS = 3_000;

/** BLE prep UI: hold on the connection screen before auto-start (ms). */
export const BREATH_BLE_PREP_SPIN_MS = 3_500;

/**
 * Camera: up to this beat age we still treat `holding`/recent `tracking` as a live measured pulse
 * for the practice UI/results. This is intentionally longer than a single-beat freshness check:
 * short finger lifts (~3 s) should stay on interpolation/hold instead of immediately turning into
 * a full gray gap while the optical path is re-locking. Genuine long losses still fall through to
 * non-live/emulated once this window expires.
 */
export const BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS = 5_000;

/**
 * Если логическое время камеры (`getLastSourceTimestampMs`) не двигается дольше этого,
 * считаем поток optical «застывшим» (ОС/троттлинг), мс.
 */
export const BREATH_OPTICAL_STALL_HARD_MS = 2_000;
