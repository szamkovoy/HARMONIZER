/**
 * Утилиты для расчёта длительностей дыхательных фаз по текущему пульсу.
 *
 * Базовый контракт будущих практик:
 *  - Вдох / выдох / задержки выражаются в **ударах сердца**, а не в секундах.
 *  - Длительность одной фазы: `beats * 60000 / bpm(t)`.
 *  - BPM берётся сглаженный (`BreathBpmSmoother`), чтобы не было «метаний» темпа при
 *    дрожании детектора или мгновенных скачках RR.
 *  - Если датчик отсутствует — эмулятор выдаёт 75 → 65 BPM за 3 мин (см. модуль
 *    `biofeedback/sensors/emulated-pulse-sensor.ts`), и длительности фаз строятся по нему.
 *
 * Эта функция — чистая: вся мутация состояния лежит в `BreathBpmSmoother`; здесь только
 * применяется арифметика.
 */

/** Минимальная длина фазы в мс (защита от «BPM = 300 → вдох за 1 с»). */
const MIN_PHASE_MS = 1500;
/** Максимальная длина фазы в мс (защита от обратного случая). */
const MAX_PHASE_MS = 15_000;

export function phaseMsFromBeats(beats: number, bpm: number): number {
  if (!(bpm > 0) || !(beats > 0)) return MIN_PHASE_MS;
  const ms = (beats * 60_000) / bpm;
  if (ms < MIN_PHASE_MS) return MIN_PHASE_MS;
  if (ms > MAX_PHASE_MS) return MAX_PHASE_MS;
  return ms;
}

export interface BreathBeatRhythmConfig {
  /** Число ударов сердца на вдохе. */
  inhaleBeats: number;
  /** Число ударов сердца на выдохе. */
  exhaleBeats: number;
  /** Задержка после вдоха (ударов); 0 — нет задержки. */
  holdAfterInhaleBeats?: number;
  /** Задержка после выдоха (ударов); 0 — нет задержки. */
  holdAfterExhaleBeats?: number;
}

export interface BreathPhaseDurationsMs {
  inhaleMs: number;
  exhaleMs: number;
  holdAfterInhaleMs: number;
  holdAfterExhaleMs: number;
  cycleMs: number;
}

/**
 * Конвертация «ударов на фазу» в миллисекунды для конкретного BPM.
 * BPM подаётся уже сглаженный — см. `BreathBpmSmoother`.
 */
export function computePhaseDurationsMs(
  config: BreathBeatRhythmConfig,
  bpm: number,
): BreathPhaseDurationsMs {
  const inhaleMs = phaseMsFromBeats(config.inhaleBeats, bpm);
  const exhaleMs = phaseMsFromBeats(config.exhaleBeats, bpm);
  const holdAfterInhaleMs = config.holdAfterInhaleBeats && config.holdAfterInhaleBeats > 0
    ? phaseMsFromBeats(config.holdAfterInhaleBeats, bpm)
    : 0;
  const holdAfterExhaleMs = config.holdAfterExhaleBeats && config.holdAfterExhaleBeats > 0
    ? phaseMsFromBeats(config.holdAfterExhaleBeats, bpm)
    : 0;
  return {
    inhaleMs,
    exhaleMs,
    holdAfterInhaleMs,
    holdAfterExhaleMs,
    cycleMs: inhaleMs + exhaleMs + holdAfterInhaleMs + holdAfterExhaleMs,
  };
}
