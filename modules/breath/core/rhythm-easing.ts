/**
 * rhythm-easing: чистый worklet-friendly расчёт позиции дыхательного индикатора
 * по текущему времени внутри «замороженного» плана цикла.
 *
 * Ключевые идеи:
 *  - В середине фазы (80 % её длительности) позиция меняется **равномерно** по времени —
 *    чтобы пользователь не видел «рыскания» скорости.
 *  - По краям фазы (первые 10 % и последние 10 %) скорость плавно наращивается и
 *    спадает — это даёт эффект «резинки»: индикатор как будто замедляется подходя
 *    к верху / низу амплитуды и мягко стартует в новую фазу. Математически это
 *    трапециевидный профиль скорости; интеграл сохраняется = 1.
 *  - Решение распространяется и на переходы между фазами в многофазных рисунках
 *    (треугольник, квадрат) — каждая фаза независимо имеет свой ramp-up/ramp-down,
 *    а у границы «сходятся к нулю скорости», что и даёт непрерывность C¹ без скачков.
 *  - Для single-beat режима (каждый удар — один вдох/выдох) оболочка заменяется
 *    вариантом, где микросглаживание применяется раз в N циклов; интерфейс тот же,
 *    здесь нужно только масштабирование времени (см. TODO: single-beat-easing).
 *
 * Файл намеренно не имеет побочных эффектов — функция чистая, совместима с
 * `useFrameCallback` в Reanimated (worklet-marker расставляется в месте
 * использования).
 */

import type {
  BreathPhaseKind,
  PlannedCycle,
  PlannedPhase,
} from "@/modules/breath/core/breath-phase-planner";

/** Доля фазы, отводимая под ramp-up и ramp-down соответственно (10 % + 10 %). */
const EDGE_FRACTION = 0.1;

/**
 * Трапециевидный профиль скорости → интеграл = 1.
 *   v(u) = vMid × u/E          при u ∈ [0, E]
 *   v(u) = vMid                при u ∈ [E, 1 − E]
 *   v(u) = vMid × (1 − u)/E    при u ∈ [1 − E, 1]
 * где vMid = 1 / (1 − E) — так площадь трапеции ровно 1.
 *
 * Интеграл этой скорости (прогресс по фазе) считается аналитически — без циклов.
 */
export function easeTrapezoidalProgress(u: number): number {
  "worklet";
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const E = EDGE_FRACTION;
  const vMid = 1 / (1 - E);
  if (u < E) {
    // ramp-up: ½ × v(u) × u = ½ × (vMid × u / E) × u
    return (0.5 * vMid * u * u) / E;
  }
  if (u < 1 - E) {
    return 0.5 * vMid * E + vMid * (u - E);
  }
  // mirror: ramp-down вычисляется как 1 − integral_of_mirror(ramp-up)
  const mirror = 1 - u;
  return 1 - (0.5 * vMid * mirror * mirror) / E;
}

/**
 * Целевая позиция индикатора по окончании фазы, по договорённости «вдох — поднять».
 *   inhale → 1 (верх)
 *   exhale → 0 (низ)
 *   hold   → позиция на старте фазы (стоим)
 */
function phaseTargetPosition(
  kind: BreathPhaseKind,
  startPosition: number,
): number {
  "worklet";
  if (kind === "inhale") return 1;
  if (kind === "exhale") return 0;
  return startPosition;
}

/**
 * Главная функция: по «замороженному» плану и текущему смещению времени в цикле
 * вычисляет позицию индикатора в [0, 1].
 *
 * Контракт:
 *  - Положение индикатора: 0 — низ, 1 — верх.
 *  - Начало цикла (t = 0) соответствует позиции 0 (начало вдоха).
 *    Для рисунков, начинающихся с выдоха, положение корректно: первая фаза exhale
 *    уйдёт от 0 к 0 — нулевое изменение, это соответствует инициализации.
 *  - Если фаз нет — возвращает 0.
 *
 * Функция помечена `"worklet"` — её можно вызывать из `useFrameCallback`.
 */
export function computeBreathPosition(
  cycle: PlannedCycle,
  tInCycle: number,
): number {
  "worklet";
  const phases = cycle.phases;
  if (phases.length === 0) return 0;

  const t = Math.max(0, Math.min(tInCycle, cycle.cycleMs));
  let positionAtStart = 0;

  for (let i = 0; i < phases.length; i += 1) {
    const ph = phases[i] as PlannedPhase;
    const target = phaseTargetPosition(ph.kind, positionAtStart);
    if (t < ph.endMsInCycle) {
      if (ph.phaseMs <= 0) return target;
      const u = (t - ph.startMsInCycle) / ph.phaseMs;
      const eased = easeTrapezoidalProgress(u);
      return positionAtStart + eased * (target - positionAtStart);
    }
    positionAtStart = target;
  }
  return positionAtStart;
}

/**
 * Для отладки/аналитики: имя текущей фазы на момент времени (не worklet).
 * Не вызывается из UI worklet — чисто для экспорта/трассировки.
 */
export function phaseAtTimeInCycle(
  cycle: PlannedCycle,
  tInCycle: number,
): { phase: PlannedPhase; fractionInPhase: number } | null {
  if (cycle.phases.length === 0) return null;
  const t = Math.max(0, Math.min(tInCycle, cycle.cycleMs));
  for (const ph of cycle.phases) {
    if (t < ph.endMsInCycle) {
      const u = ph.phaseMs > 0 ? (t - ph.startMsInCycle) / ph.phaseMs : 1;
      return { phase: ph, fractionInPhase: Math.max(0, Math.min(1, u)) };
    }
  }
  const last = cycle.phases[cycle.phases.length - 1]!;
  return { phase: last, fractionInPhase: 1 };
}
