/** Параметры по спецификации «Когерентное дыхание» (PDF). */

export const TACHO_SAMPLE_RATE_HZ = 4;

export const COHERENCE_MASTER_RATIO = 0.6;
export const COHERENCE_STRETCH_EXPONENT = 0.7;

export const COHERENCE_ENTRY_THRESHOLD_PERCENT = 40;
export const ENTRY_STABILITY_SECONDS = 15;

export const SMOOTH_WINDOW_SECONDS = 3;

/**
 * Схлопывание соседних меток ударов перед RR (как в finger merge, см. BEAT_DUPLICATE_TOLERANCE_MS).
 * На вход анализа когерентности должен идти один merged-снимок за кадр, без объединения Set по кадрам.
 */
export const COHERENCE_BEAT_DEDUPE_MS = 220;

/** Порог отклонения RR от серии (артефакт) — 30%. */
export const RR_ARTIFACT_DEVIATION = 0.3;
export const RR_ARTIFACT_WINDOW_FRACTION_WARN = 0.1;

/** Диапазон поиска пика дыхания в спектре (Гц). */
export const PWIN_SEARCH_MIN_HZ = 0.04;
export const PWIN_SEARCH_MAX_HZ = 0.2;
/** «Узкое окно» вокруг пика (± Гц). */
export const PWIN_HALF_WIDTH_HZ = 0.015;

/** Знаменатель когерентности: полная мощность в этом диапазоне (Гц). Окно pwin обязательно обрезается до этого же интервала. */
export const PTOTAL_MIN_HZ = 0.04;
export const PTOTAL_MAX_HZ = 0.4;

export const PRODUCTION_WINDOW_SECONDS = 60;
export const PRODUCTION_WINDOW_SKIP_SECONDS = 60;

/** Скользящее окно FFT/когерентности в тестовой сессии пранаямы (120 с). */
export const TEST120_WINDOW_SECONDS = 60;
export const TEST120_WINDOW_SKIP_SECONDS = 0;

/** Протокол старта (только экран когерентности): прогрев без записи в pulseLog. */
export const COHERENCE_WARMUP_MS = 10_000;
/** Окно проверки качества по времени камеры. */
export const COHERENCE_QUALITY_WINDOW_MS = 5000;
/** Удары из успешного QC включаются в тахограмму как буфер перед T=0. */
export const COHERENCE_PREFLIGHT_BUFFER_MS = 5000;

/** Предупреждение о доле артефактов RR в пранаяме — только если ≥ этого порога (мягкая очистка). */
export const RR_COHERENCE_WARN_FRACTION = 0.15;

/** RSA: цикл «неактивен», если размах &lt; 2 уд/мин (PDF). */
export const RSA_CYCLE_MIN_BPM = 2;

/** Минимум секунд с BPM &gt; 0 на тахограмме для расчёта итоговых метрик (режим test120s). */
export const COHERENCE_MIN_VALID_SECONDS_FOR_METRICS = 60;

export const COHERENCE_ALGORITHM_VERSION = "1.1.5";
