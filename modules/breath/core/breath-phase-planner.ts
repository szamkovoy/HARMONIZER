/**
 * BreathPhasePlanner: планирует **целиком** следующий дыхательный цикл.
 *
 * Архитектурный контекст (см. план `coherent-breath-rhythm-overhaul`):
 *  - Раньше `phaseDurations` пересчитывались каждые 250 мс на основе live `pulseRateBpm`,
 *    что приводило к «дёрганью» индикатора: смена `cycleMs` внутри цикла сдвигала
 *    позицию `t % cycle` и визуально проявлялась как скачок фазы.
 *  - Теперь план фиксируется на весь цикл на его **старте** и меняется только на
 *    границе цикла (cycle-delayed playback).
 *
 * Два источника входных данных:
 *  1. **Baseline BPM** — медленный EMA (τ ≈ 30 с) по `medianRrMs` из `PulseBpmEngine`.
 *     Он отражает «общий темп пульса» без колебаний RSA и задаёт опорную длительность
 *     цикла: `canonicalCycleMs = Σbeats × 60000 / baselineBpm`.
 *  2. **Последний завершённый `rsaCycle`** из `CoherenceEngine` — даёт `hrInhale`,
 *     `hrExhale`, `rsaBpm`. На его основе длительности фаз внутри цикла
 *     перераспределяются пропорционально полуволне RSA (вдох чуть короче, выдох чуть
 *     длиннее), но суммарная длительность цикла = canonical.
 *
 * Рисунок дыхания задаётся декларативно через `BreathPhaseShape` — это позволяет в
 * будущем масштабировать планировщик на треугольник/квадрат/single-beat:
 *   - равносторонний треугольник: `[inhale 5 beats, hold 5, exhale 5]`;
 *   - квадрат: `[inhale 4, hold 4, exhale 4, hold 4]`;
 *   - single-beat: `[inhale 1, exhale 1]` (масштабирование задерживается на N циклов,
 *     но интерфейс тот же).
 */

import { phaseMsFromBeats } from "@/modules/breath/core/beat-driven-rhythm";

/**
 * EMA τ для baseline BPM. 30 с по ТЗ: «общая линия замедления/ускорения пульса в
 * результате выполнения практики», без RSA-рябины на ±20–40%.
 */
export const BASELINE_BPM_EMA_TAU_MS = 30_000;

/** Ограничения на baseline BPM — защита от аномалий (срыв трекинга, дикротик). */
const BASELINE_BPM_MIN = 35;
const BASELINE_BPM_MAX = 180;

/** Минимальная уверенность в RSA (ударов/цикл), при которой применяем полуволновое перераспределение. */
const RSA_MIN_CYCLE_DURATION_MS = 3_000;
const RSA_MIN_HR_INHALE = 40;
const RSA_MIN_HR_EXHALE = 40;

export type BreathPhaseKind = "inhale" | "exhale" | "hold";

/** Декларация одной фазы в рисунке дыхания. */
export interface BreathPhaseSpec {
  kind: BreathPhaseKind;
  beats: number;
}

/** Полный рисунок дыхания: массив фаз + отметка базовой фазы (для будущего слайдера скорости). */
export interface BreathPhaseShape {
  /** Фазы в порядке проигрывания. */
  phases: readonly BreathPhaseSpec[];
  /**
   * Индекс «базовой» фазы: при ускорении/замедлении ритма эта фаза изменяется на 1 удар,
   * остальные пересчитываются пропорционально. Пока (этап 1) не используется, но
   * сохраняется в плане цикла для прозрачности.
   */
  baseIndex: number;
}

/** Итог планирования одной фазы: когда она начинается и заканчивается внутри цикла. */
export interface PlannedPhase {
  kind: BreathPhaseKind;
  beats: number;
  startMsInCycle: number;
  endMsInCycle: number;
  phaseMs: number;
  /** Эффективный BPM, использованный при расчёте длины фазы. */
  bpmForPhase: number;
}

/** Полностью «замороженный» план цикла. Используется индикатором дыхания as-is. */
export interface PlannedCycle {
  /** Суммарная длительность цикла (мс). */
  cycleMs: number;
  phases: PlannedPhase[];
  /** Снимок baseline BPM, от которого отталкивался план. */
  baselineBpm: number;
  /**
   * Параметры RSA, учтённые при планировании. null — если валидного цикла ещё нет
   * и применяется равномерное распределение по baseline.
   */
  rsaInfo: { rsaBpm: number; hrInhale: number; hrExhale: number } | null;
  /** Отладочная копия shape — удобно для экспорта `phaseDurationsHistory`. */
  shape: BreathPhaseShape;
}

/** Входные данные одного завершённого RSA-цикла из CoherenceEngine. */
export interface RsaCycleForPlanner {
  hrInhale: number;
  hrExhale: number;
  rsaBpm: number;
  durationMs: number;
}

function clampBaseline(bpm: number): number {
  if (!(bpm > 0)) return 0;
  if (bpm < BASELINE_BPM_MIN) return BASELINE_BPM_MIN;
  if (bpm > BASELINE_BPM_MAX) return BASELINE_BPM_MAX;
  return bpm;
}

/**
 * Планировщик фаз дыхания. Stateful, но обновления идут строго порциями — дыхательный
 * индикатор читает только `planNextCycle()` и только на границе цикла.
 */
export class BreathPhasePlanner {
  private baselineBpm = 0;
  private lastBaselineSampleMs = 0;
  private lastRsaCycle: RsaCycleForPlanner | null = null;
  /** Для первого цикла, пока нет ударов. */
  private seedBpm = 60;

  /** Задать стартовый BPM (используется до первого EMA-шага). */
  seedBaseline(bpm: number): void {
    const b = clampBaseline(bpm);
    if (b > 0) {
      this.seedBpm = b;
      this.baselineBpm = b;
    }
  }

  /**
   * Обновить baseline EMA значением «мгновенного» BPM (из `medianRrMs`).
   *  - `nowMs` — текущее время кадра;
   *  - `currentBpm` — свежий BPM (0 игнорируется).
   *
   * Линейный ramp: `dBpm = Δ × dtMs / TAU`, за τ достигается любой диапазон.
   */
  updateBaseline(nowMs: number, currentBpm: number): void {
    const b = clampBaseline(currentBpm);
    if (!(b > 0)) return;

    if (this.baselineBpm <= 0) {
      this.baselineBpm = b;
      this.lastBaselineSampleMs = nowMs;
      return;
    }

    const dtMs = nowMs - this.lastBaselineSampleMs;
    this.lastBaselineSampleMs = nowMs;
    if (!(dtMs > 0)) {
      return;
    }

    const diff = b - this.baselineBpm;
    const maxDelta = (Math.abs(diff) * dtMs) / BASELINE_BPM_EMA_TAU_MS;
    if (maxDelta >= Math.abs(diff)) {
      this.baselineBpm = b;
    } else {
      this.baselineBpm += Math.sign(diff) * maxDelta;
    }
  }

  /** Подать в планировщик последний завершённый RSA-цикл (фильтрация на валидность). */
  ingestCompletedRsaCycle(cycle: RsaCycleForPlanner): void {
    if (
      cycle.durationMs < RSA_MIN_CYCLE_DURATION_MS ||
      !(cycle.hrInhale >= RSA_MIN_HR_INHALE) ||
      !(cycle.hrExhale >= RSA_MIN_HR_EXHALE)
    ) {
      return;
    }
    this.lastRsaCycle = cycle;
  }

  reset(): void {
    this.baselineBpm = 0;
    this.lastBaselineSampleMs = 0;
    this.lastRsaCycle = null;
  }

  getBaselineBpm(): number {
    return this.baselineBpm > 0 ? this.baselineBpm : this.seedBpm;
  }

  getLastRsaCycle(): RsaCycleForPlanner | null {
    return this.lastRsaCycle;
  }

  /**
   * Построить план следующего цикла.
   *
   * Стратегия:
   *  1. Считаем `canonicalCycleMs = Σphase.beats × 60000 / baseline`.
   *  2. Если есть валидный lastRsaCycle — считаем «сырые» длительности фаз по их
   *     ожидаемому HR: inhale → `beats × 60000 / hrInhale`, exhale → по `hrExhale`,
   *     hold → по baseline. Затем масштабируем все фазы до `canonicalCycleMs`.
   *  3. Иначе — равномерно по baseline.
   */
  planNextCycle(shape: BreathPhaseShape): PlannedCycle {
    const baseline = this.getBaselineBpm();
    const canonicalCycleMs = shape.phases.reduce(
      (acc, ph) => acc + phaseMsFromBeats(ph.beats, baseline),
      0,
    );

    const rsa = this.lastRsaCycle;
    const rawPhases = shape.phases.map((ph) => {
      let bpmForPhase = baseline;
      if (rsa) {
        if (ph.kind === "inhale") bpmForPhase = rsa.hrInhale;
        else if (ph.kind === "exhale") bpmForPhase = rsa.hrExhale;
      }
      return {
        kind: ph.kind,
        beats: ph.beats,
        rawMs: phaseMsFromBeats(ph.beats, bpmForPhase),
        bpmForPhase,
      };
    });
    const rawTotal = rawPhases.reduce((acc, p) => acc + p.rawMs, 0);

    const scale = rawTotal > 0 ? canonicalCycleMs / rawTotal : 1;
    let cursorMs = 0;
    const phases: PlannedPhase[] = rawPhases.map((p) => {
      const scaled = p.rawMs * scale;
      const start = cursorMs;
      cursorMs += scaled;
      return {
        kind: p.kind,
        beats: p.beats,
        startMsInCycle: start,
        endMsInCycle: cursorMs,
        phaseMs: scaled,
        bpmForPhase: p.bpmForPhase,
      };
    });

    return {
      cycleMs: cursorMs, // numerically consistent, even при накоплении погрешности
      phases,
      baselineBpm: baseline,
      rsaInfo: rsa
        ? { rsaBpm: rsa.rsaBpm, hrInhale: rsa.hrInhale, hrExhale: rsa.hrExhale }
        : null,
      shape,
    };
  }
}

/** Упрощённый фабричный метод: построить shape для «вдох+выдох» (когерентное дыхание). */
export function buildSimpleInhaleExhaleShape(
  inhaleBeats: number,
  exhaleBeats: number,
): BreathPhaseShape {
  return {
    phases: [
      { kind: "inhale", beats: inhaleBeats },
      { kind: "exhale", beats: exhaleBeats },
    ],
    baseIndex: 0,
  };
}
