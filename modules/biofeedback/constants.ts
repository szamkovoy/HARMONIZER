/**
 * Единая точка правды для всех числовых порогов конвейера Biofeedback.
 * Все значения скопированы из старого `core/finger-analysis.ts` и `core/hrv-practice-constants.ts`
 * с сохранением исходной семантики. См. `docs/biofeedback-parity-contract.md`.
 *
 * Слои:
 *  - SIGNAL  — оптика, пиковый детектор, merge ударов;
 *  - QUALITY — качество, контакт, калибровка;
 *  - PULSE   — окно среднего пульса (10 с);
 *  - HRV     — RMSSD, тиры, Хампель;
 *  - STRESS  — индекс Баевского, дисплей;
 *  - LIVE    — live pulse channel (новое поведение, экстраполяция в holding).
 */

// ───── SIGNAL ─────────────────────────────────────────────────────────────

/** Скользящее окно сырых оптических сэмплов (мс) — для baseline/детренда/качества. */
export const SIGNAL_WINDOW_MS = 12_000;

/** Долгая история merged-ударов (мс): иначе «первые 90» вымываются и RMSSD «плывёт». */
export const BEAT_HISTORY_WINDOW_MS = 45 * 60 * 1000;

/**
 * Допуск дедупликации соседних меток ударов. Используется и в Coherence (`COHERENCE_BEAT_DEDUPE_MS`).
 *
 * Исторически было 220 мс (узкое окно против близнецов от сглаживания). После включения
 * защиты от дикротических зубцов в `peak-detector.ts` подняли до 300 мс: типичный интервал
 * «главный пик → дикротическая зарубка» при 60 BPM составляет 350–450 мс; всё, что короче
 * половины медианного RR, — шум. Это _верхняя граница дедупликации соседних рефлексий
 * одного и того же удара_, не клинический минимум RR (см. HRV_RR_HARD_MIN_MS = 300).
 */
export const BEAT_DUPLICATE_TOLERANCE_MS = 300;

/**
 * Дикротическая заГрузка/фильтр: «подозрительно короткий» RR, который, скорее всего,
 * соответствует дикротическому зубцу, а не настоящему следующему удару. Пики с RR
 * короче `DICROTIC_POST_FILTER_FRACTION × медианный_RR_из_акцептов` подвергаются
 * пост-фильтру (удаляется пик с меньшей prominence).
 *
 * 0.55 соответствует клинически наблюдаемому окну дикротической зарубки (35–55 % от RR).
 */
export const DICROTIC_POST_FILTER_FRACTION = 0.55;

/**
 * Адаптивный refractory для пикового детектора: максимальная доля медианного RR, которая
 * применяется как _нижний порог_ интервала между соседними принятыми пиками. Даёт 450 мс
 * при 60 BPM, 337 мс при 80 BPM, 280 мс (минимум) при ≥ 96 BPM — отдельно от статического
 * `Math.max(280, 60000 / maxPulseBpm)` в [peak-detector.ts].
 */
export const DICROTIC_ADAPTIVE_REFRACTORY_FRAC = 0.45;

/** Сколько мс с момента последнего удара считается «свежим» — для tracking. */
export const BEAT_STALE_TIMEOUT_MS = 4_200;

/** Пиковый детектор: краевая зона (мс). */
export const PEAK_EDGE_MARGIN_MS = 220;

/** Пиковый детектор: окно для вычисления prominence (мс). */
export const PEAK_PROMINENCE_WINDOW_MS = 220;

/** Минимум сырого значения пика (детренд + bandpass). */
export const MIN_ACCEPTED_PEAK_VALUE = 0.0004;

/** Минимум prominence пика. */
export const MIN_ACCEPTED_PEAK_PROMINENCE = 0.00035;

/** Параболическая интерполяция: максимальное смещение по сэмплам. */
export const PARABOLIC_PEAK_DELTA_MAX_SAMPLES = 0.5;

// ───── QUALITY / CONTACT / CALIBRATION ────────────────────────────────────

/** Прогрев перед валидацией пульса (мс). */
export const WARMING_PHASE_MS = 10_000;

/** Окно проверки устойчивости после прогрева. */
export const PULSE_SETTLE_MS = 10_000;

/** Доля «хороших» секунд в окне settle для успеха калибровки. */
export const PULSE_SETTLE_GOOD_FRAC = 0.82;

/** Сколько мс отсутствия пальца в прогреве сбрасывает прогресс. */
export const WARMING_HARD_RESET_MS = 10_000;

/** Льготный период для метрик после потери пульса (метрики не сбрасываются мгновенно). */
export const METRICS_RESET_GRACE_MS = 5_000;

/** Длительность «hold» после потери tracking (для отображения, в текущем анализаторе). */
export const HOLD_LOCK_MS = 5_000;

/** Льготный период для tracking после кратковременного сбоя. */
export const PULSE_VALIDATION_GRACE_MS = 3_000;

/** Время удержания last lock в hold-режиме (мс) — старое поведение анализатора. */
export const PULSE_LOCK_HOLD_MS = 6_000;

/** Порог качества для стабильного lock (tracking). */
export const STABLE_LOCK_QUALITY_THRESHOLD = 0.54;

/** Гистерезис: пока недавно был tracking, понижаем планку. */
export const QUALITY_HYSTERESIS_DROP = 0.44;

/** Минимум качества для удержания lock в hold. */
export const HOLD_LOCK_RELEASE_QUALITY = 0.06;

/** Минимум качества для расчёта HRV. */
export const HRV_QUALITY_THRESHOLD = 0.52;

/** Контакт пальца: уверенный track. */
export const FINGER_PRESENCE_TRACK_THRESHOLD = 0.58;

/** Контакт пальца: hold (можно не терять lock сразу). */
export const FINGER_PRESENCE_HOLD_THRESHOLD = 0.28;

// ───── PULSE BPM ENGINE (10 s window) ─────────────────────────────────────

/** Скользящее окно для среднего BPM. */
export const PULSE_WINDOW_MS = 10_000;

/** Жёсткие границы RR пульса (мс). */
export const PULSE_RR_MIN_MS = 450;
export const PULSE_RR_MAX_MS = 1_400;

/** Минимум RR в окне для считаемого среднего. */
export const PULSE_MIN_RR_COUNT = 5;

/** Sequential-фильтр: размер окна для медианы, контекст, % отклонения. */
export const RR_SEQUENCE_WINDOW_SIZE = 9;
export const RR_SEQUENCE_MIN_CONTEXT = 4;
export const PULSE_RR_DEVIATION_RATIO = 0.16;
export const RR_SEQUENCE_MIN_ALLOWED_DELTA_MS = 100;

// ───── HRV / RMSSD ────────────────────────────────────────────────────────

export {
  HRV_RR_HARD_MIN_MS,
  HRV_RR_HARD_MAX_MS,
  HRV_MIN_VALID_BEATS_FOR_METRICS,
  HRV_PREFIX_BEATS_FOR_SEGMENT,
  HRV_TAIL_BEATS_FINAL_MID,
  HRV_TAIL_BEATS_FINAL_LONG,
  HRV_LATCH_INITIAL_AFTER_BEATS,
  HRV_TIER_MAX_BEATS,
  HRV_INTEGRATION_SINGLE_MEASURE_BEATS,
} from "@/modules/biofeedback/core/hrv-practice-constants";

/** Скользящее окно для отображаемого RMSSD (мс) — старое поведение анализатора. */
export const RMSSD_WINDOW_MS = 60_000;

/** EMA τ для дисплея RMSSD. */
export const HRV_RMSSD_DISPLAY_TAU_MS = 12_000;

/** Hold для RMSSD после потери качества. */
export const HRV_HOLD_MS = 9_000;

// ───── STRESS (Baevsky) ───────────────────────────────────────────────────

/** Быстрый тиер окна стресса. */
export const STRESS_FAST_WINDOW_MS = 60_000;

/** EMA τ для дисплея стресса в режиме начало/конец. */
export const HRV_STRESS_DISPLAY_TAU_MS = 12_000;

/** Hold для стресса после потери качества. */
export const STRESS_HOLD_MS = 12_000;

// ───── LIVE PULSE CHANNEL (новое) ─────────────────────────────────────────

/**
 * Сколько мс после последнего реального удара канал может выдавать **экстраполированные**
 * тики на основе последнего стабильного периода. После — событие `heartbeatLost`.
 */
export const LIVE_PULSE_EXTRAPOLATION_MAX_MS = 2_000;

/**
 * Минимальный jitter-фильтр на live: новый удар не публикуется, если он ближе к предыдущему,
 * чем `LIVE_PULSE_MIN_INTERVAL_MS`. Защита от дребезга при relock.
 */
export const LIVE_PULSE_MIN_INTERVAL_MS = 280;

// ───── DEFAULT FPS/FRAME PARAMETERS ───────────────────────────────────────

/** Целевой FPS захвата (для downsampling в кольцевых буферах). */
export const DEFAULT_TARGET_FPS = 30;

/** Сколько последних оптических сэмплов отдаётся в snapshot/UI для визуализации. */
export const MAX_RENDER_SAMPLES = 48;
