/**
 * RsaEngine: тонкая обёртка над RSA-частью результата `runCoherenceSessionAnalysis`.
 *
 * Сейчас вся математика RSA (циклы дыхания → размах BPM → медиана активных циклов →
 * нормировка по среднему BPM) реализована в `coherence-session-analysis.ts`. Чтобы не
 * дублировать формулы и сохранить parity, `RsaEngine` принимает готовый результат и
 * выдаёт RSA-only снимок. В будущем, когда дыхательные техники будут произвольной
 * длительности и без полного анализа когерентности, его можно будет наполнить независимой
 * логикой.
 */

import type { CoherenceSessionResult } from "@/modules/breath/core/coherence-session-analysis";

export const RSA_ENGINE_VERSION = "engine/rsa@1.0";

export interface RsaSnapshot {
  /** Медиана размаха BPM по активным дыхательным циклам (уд/мин). null если данных мало. */
  amplitudeBpm: number | null;
  /** RSA / средний BPM × 100 %. null если не считалось. */
  normalizedPercent: number | null;
  /** Число активных циклов (где размах ≥ `RSA_CYCLE_MIN_BPM`). */
  activeCycleCount: number;
  /** Число всех циклов (включая неактивные). */
  totalCycleCount: number;
}

export class RsaEngine {
  fromCoherenceResult(result: CoherenceSessionResult): RsaSnapshot {
    const active = result.rsaCycles.filter((c) => !c.inactive);
    return {
      amplitudeBpm: result.rsaAmplitudeBpm,
      normalizedPercent: result.rsaNormalizedPercent,
      activeCycleCount: active.length,
      totalCycleCount: result.rsaCycles.length,
    };
  }

  reset(): void {}
}
