/** Параметры по спецификации «Когерентное дыхание» (PDF). */

export const TACHO_SAMPLE_RATE_HZ = 4;

/**
 * Маппинг raw coherence ratio -> UI percent.
 *
 * В реальных сессиях `pwin / ptotal` около 0.40–0.60 оказался слишком «щедро» растянут:
 * старая пара (0.6, 0.7) давала 80–100 % почти на любой хорошей практике. Затем мы
 * перекрутили шкалу в другую сторону (0.9, 2.0), и умеренно хорошие сессии с заметной
 * RSA стали выглядеть как 5–10 %. Текущая калибровка — компромисс под пользовательскую
 * шкалу приложения:
 *   < 15%   — слабо
 *   15–40%  — нормально
 *   40–75%  — хорошо
 *   > 75%   — отлично
 */
export const COHERENCE_MASTER_RATIO = 0.75;
export const COHERENCE_STRETCH_EXPONENT = 1.25;

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

/**
 * Знаменатель когерентности: полная мощность в этом диапазоне (Гц). Окно pwin обязательно обрезается до этого же интервала.
 *
 * По PDF «Когерентное дыхание» (§5): Ptotal = сумма спектральной мощности от 0.0033 Гц до 0.4 Гц
 * (классический TotalPower HRV = VLF + LF + HF). Ранее нижняя граница была ошибочно 0.04 Гц (только LF+HF),
 * что занижало ptotal и давало систематически завышенный pwin/ptotal → завышенную «когерентность».
 *
 * На 60-с FFT-окне минимальная представимая частота ≈ 1/60 ≈ 0.0167 Гц; установка MIN_HZ = 0.0033
 * означает «включать все низкочастотные бины начиная от первого после DC», что математически корректно.
 */
export const PTOTAL_MIN_HZ = 0.0033;
export const PTOTAL_MAX_HZ = 0.4;

export const PRODUCTION_WINDOW_SECONDS = 60;
export const PRODUCTION_WINDOW_SKIP_SECONDS = 60;

/** Скользящее окно FFT/когерентности в тестовой сессии пранаямы (120 с). */
export const TEST120_WINDOW_SECONDS = 60;
/**
 * «Разогрев» по PDF, п. 8: не включать первые 60 с в агрегат Average/Max когерентности.
 * В 120-с тесте это даёт агрегат по секундам 61..120 (полностью заполненные 60-с FFT-окна).
 */
export const TEST120_WINDOW_SKIP_SECONDS = 60;

/**
 * Для валидной оценки когерентности в 60-с окне FFT требуется, чтобы окно было покрыто
 * реальными тахограмма-точками хотя бы на эту долю (0.85 → 51 из 60 с). Окна, где точек
 * меньше, трактуются как coherenceRatio = 0 и coherenceMappedPercent = 0.
 */
export const COHERENCE_WINDOW_MIN_COVERAGE_FRAC = 0.85;

/**
 * Максимальный разрыв между соседними beat-точками на тахограмме. Если между двумя
 * соседними ударами пауза больше этого значения — промежуток на 4 Гц сетке
 * **не заполняется** интерполяцией (палец оторвался, реальных данных нет).
 *
 * 1800 мс ≈ 2–3 пропущенных удара при 60 BPM. При коротком holding (до 2 с) канал
 * экстраполированного пульса ещё покрывает дыру, а здесь тахограмма уже фиксирует
 * «дырку», и coverage окна падает → insufficientCoverage → coherence этой секунды = 0.
 */
export const TACHO_MAX_INTERBEAT_GAP_MS = 1800;

/** Протокол старта (только экран когерентности): прогрев без записи в pulseLog. */
export const COHERENCE_WARMUP_MS = 10_000;
/**
 * Окно проверки качества пульса после прогрева (QC). 10 с даёт 10–15 ударов
 * при 60–90 BPM — этого достаточно для оценки стабильного медианного RR и
 * разброса BPM; больший QC утомляет пользователя и не добавляет точности.
 */
export const COHERENCE_QUALITY_WINDOW_MS = 10_000;
/** Удары из успешного QC включаются в тахограмму как буфер перед T=0. */
export const COHERENCE_PREFLIGHT_BUFFER_MS = 5000;

/**
 * QC-пороги для «прошло / не прошло».
 *
 *  - `QC_MIN_BEATS = 6` — минимум ударов за QC-окно (при 36+ BPM = 6 ударов за 10 с).
 *  - `QC_BPM_STDEV_MAX = 6` — допустимый размах BPM в окне (уд/мин). RSA даёт 2–5 BPM,
 *    всё, что выше — либо потеря трекинга, либо лишние пики.
 */
export const QC_MIN_BEATS = 6;
export const QC_BPM_STDEV_MAX = 6;

/**
 * Общая длительность warmup + QC для прогресс-индикатора обратного отсчёта на экране.
 * UI показывает круговой таймер 20 с = 10 warmup + 10 QC.
 */
export const COHERENCE_PREP_TOTAL_MS = COHERENCE_WARMUP_MS + COHERENCE_QUALITY_WINDOW_MS;

/** Предупреждение о доле артефактов RR в пранаяме — только если ≥ этого порога (мягкая очистка). */
export const RR_COHERENCE_WARN_FRACTION = 0.15;

/**
 * Жёсткий порог: при такой доле «подозрительных» RR метрики пранаямы **withheld**.
 * Даже если тахограмма успела заполниться на 120 с, высокая доля подменённых RR означает,
 * что спектр сформирован не реальным дыхательным ритмом, а его сглаженной подделкой.
 */
export const RR_COHERENCE_HARD_WITHHOLD_FRACTION = 0.2;

/**
 * Жёсткий порог для secondsWithInsufficientCoverage: если больше половины 60-с FFT-окон
 * не набрали ≥ 85 % реальной тахограммы — практика проведена с рваным сигналом, метрики
 * withheld.
 */
export const COHERENCE_MAX_INSUFFICIENT_SECONDS_FRAC = 0.5;

/** RSA: цикл «неактивен», если размах &lt; 2 уд/мин (PDF). */
export const RSA_CYCLE_MIN_BPM = 2;

/** Минимум секунд с BPM &gt; 0 на тахограмме для расчёта итоговых метрик (режим test120s). */
export const COHERENCE_MIN_VALID_SECONDS_FOR_METRICS = 60;

export const COHERENCE_ALGORITHM_VERSION = "1.1.9";
