/**
 * StressEngine: индекс Баевского по тиерам.
 *
 * Использует тот же `computePracticeHrvMetrics`: внутри — Хампель с импутацией медианой
 * (для Баевского), `calculateBaevskyStressIndexRaw`, медиана по блокам, нормировка
 * `mapBaevskyStressToPercent` (`BAEVSKY_STRESS_PERCENT_DIVISOR = 220`).
 *
 * EMA-сглаживание (12 s τ) — в UI-адаптере, не здесь.
 */

import { computePracticeHrvMetricsFullSession } from "@/modules/biofeedback/core/metrics";
import type { HrvPracticeTier } from "@/modules/biofeedback/core/types";

export const STRESS_ENGINE_VERSION = "engine/stress@1.1-fullsession";

export interface StressEngineSnapshot {
  /** Финальный процент Баевского (0..100). 0 если данных мало. */
  percent: number;
  /** Сырой индекс Баевского (до нормировки). */
  rawIndex: number;
  tier: HrvPracticeTier;
  approximate: boolean;
  showInitialFinal: boolean;
  initialPercent: number;
  initialRawIndex: number;
  finalPercent: number;
  finalRawIndex: number;
  validBeatCount: number;
}

export class StressEngine {
  push(beats: readonly number[]): StressEngineSnapshot {
    const r = computePracticeHrvMetricsFullSession(beats);
    return {
      percent: r.stressPercent,
      rawIndex: r.stressRaw,
      tier: r.tier,
      approximate: r.stressApproximate,
      showInitialFinal: r.showInitialFinal,
      initialPercent: r.initialStressPercent,
      initialRawIndex: r.initialStressRaw,
      finalPercent: r.finalStressPercent,
      finalRawIndex: r.finalStressRaw,
      validBeatCount: r.validBeatCount,
    };
  }

  reset(): void {}
}
