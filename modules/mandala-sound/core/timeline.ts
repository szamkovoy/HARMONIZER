import type { MandalaSoundBand } from "@/modules/mandala-sound/core/types";

/**
 * Источник модели: исследование «Алгоритм светозвуковой стимуляции мозга»
 * (сигмоидальная адаптивная модель аудиовизуального увлечения).
 *
 * Физиологические инварианты:
 * - Стартовая частота 12 Гц — верхняя граница альфа-ритма; легко
 *   захватывается корой, безопасна по фотосенситивности (потолок 13 Гц
 *   исключает бета-диапазон 15–25 Гц, провоцирующий дискомфорт).
 * - Конечная частота f_end(T) — кусочно-линейная функция длительности:
 *   короткие сессии остаются в альфа, длинные доходят до дельта.
 * - Сигмоид f(t) задаёт три фазы: Catch (плавный старт) → Glide
 *   (основное снижение в середине) → Hold (плато у цели). Точка перегиба
 *   t_mid = 0.45·T пролонгирует финальную фазу удержания.
 *
 * Эта функция — единый источник `targetHz` и для мерцания мандалы
 * (`flickerHz`), и для binaural-банды (`band`/`binauralDeltaHz`), поэтому
 * дыхательные и медитативные сессии получают одну и ту же прогрессию.
 */
export const MANDALA_SOUND_START_HZ = 12;
export const MANDALA_SOUND_MIN_TARGET_HZ = 2;
/** Safety cap: никогда не выходим в бета (≤13 Гц). */
export const MANDALA_SOUND_MAX_TARGET_HZ = 13;

/** Точка перегиба сигмоиды как доля длительности (пролонгация Hold). */
const SIGMOID_MID_FRACTION = 0.45;
/** Коэффициент крутизны: k = SIGMOID_K_NUMERATOR / T_sec. */
const SIGMOID_K_NUMERATOR = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Конечная (целевая) частота f_end как кусочно-линейная функция
 * длительности практики в минутах. Соответствует таблице исследования:
 *   1 мин → 11 Гц, 2 → 9.5, 3 → 8, 5 → 6, 8 → 4.5,
 *   10 → 3.5, 15 → 2.75, 20 → 2.
 */
export function getMandalaSoundEndHz(minutes: number): number {
  let fEnd: number;
  if (minutes <= 1) {
    fEnd = 11;
  } else if (minutes <= 3) {
    fEnd = 11 - (minutes - 1) * 1.5;
  } else if (minutes <= 5) {
    fEnd = 8 - (minutes - 3) * 1.0;
  } else if (minutes <= 10) {
    fEnd = 6 - (minutes - 5) * 0.5;
  } else {
    fEnd = 3.5 - (minutes - 10) * 0.15;
  }
  return Math.max(MANDALA_SOUND_MIN_TARGET_HZ, fEnd);
}

/**
 * Мгновенная частота увлечения f(t) по сигмоидальной модели:
 *   f(t) = f_end + (f_start - f_end) / (1 + exp(k · (t - t_mid)))
 *   k = 7 / T_sec, t_mid = 0.45 · T_sec.
 *
 * При t=0 кривая ≈ f_start (12 Гц), при t=T → ≈ f_end. Монотонно
 * убывает; пиковая скорость сброса — в точке t_mid.
 */
export function getMandalaSoundTargetHz(
  elapsedMs: number,
  durationMs: number,
): number {
  const safeDurationMs = Math.max(1, durationMs);
  const Tsec = safeDurationMs / 1000;
  const t = clamp(elapsedMs / 1000, 0, Tsec);

  const fStart = MANDALA_SOUND_START_HZ;
  const fEnd = getMandalaSoundEndHz(safeDurationMs / 60_000);
  const tMid = Tsec * SIGMOID_MID_FRACTION;
  const k = SIGMOID_K_NUMERATOR / Tsec;

  const f = fEnd + (fStart - fEnd) / (1 + Math.exp(k * (t - tMid)));
  return clamp(f, MANDALA_SOUND_MIN_TARGET_HZ, MANDALA_SOUND_MAX_TARGET_HZ);
}

export function getMandalaSoundBand(targetHz: number): MandalaSoundBand {
  if (targetHz < 4) return "delta";
  if (targetHz < 8) return "theta";
  if (targetHz < 13) return "alpha";
  return "beta";
}
