/**
 * HrvEngine: RMSSD по тиерам ([modules/biofeedback/core/metrics.ts](../core/metrics.ts) :: `computePracticeHrvMetrics`).
 *
 * Поведение полностью повторяет старое из `FingerSignalAnalyzer`:
 *  - Пока в накопителе < `HRV_MIN_VALID_BEATS_FOR_METRICS` (30) ударов — `tier = "none"`.
 *  - Иначе по тиерам: 30..59, 60..89, 90..119, 120..179, 180+.
 *  - Для тиров 120+ возвращаются и «начальные», и «финальные» сегменты.
 *
 * Никакого EMA-сглаживания: цель — выдавать **сырое** значение, чтобы экспорт JSON был
 * прозрачен. Сглаживание для дисплея делается в UI-адаптере.
 */

import {
  computePracticeHrvMetrics,
  computePracticeRmssdHampelDiagnostics,
  type PracticeHrvMetricsResult,
  type PracticeRmssdHampelDiagnostics,
} from "@/modules/biofeedback/core/metrics";
import type { HrvPracticeTier } from "@/modules/biofeedback/core/types";

export const HRV_ENGINE_VERSION = "engine/hrv@1.0";

export interface HrvEngineSnapshot {
  /** RMSSD финального сегмента (мс). 0 если данных мало. */
  rmssdMs: number;
  /** Тиер по числу валидных ударов. */
  tier: HrvPracticeTier;
  /** Число валидных ударов в накопителе. */
  validBeatCount: number;
  /** Расчёт по короткому сегменту — приближён. */
  approximate: boolean;
  /** Доступны раздельные «начало» и «конец» (только для тиров 120+). */
  showInitialFinal: boolean;
  initialRmssdMs: number;
  finalRmssdMs: number;
  /** Полный результат для углубленной диагностики. */
  raw: PracticeHrvMetricsResult;
}

export class HrvEngine {
  push(beats: readonly number[]): HrvEngineSnapshot {
    const r = computePracticeHrvMetrics(beats);
    return {
      rmssdMs: r.rmssdMs,
      tier: r.tier,
      validBeatCount: r.validBeatCount,
      approximate: r.rmssdApproximate,
      showInitialFinal: r.showInitialFinal,
      initialRmssdMs: r.initialRmssdMs,
      finalRmssdMs: r.finalRmssdMs,
      raw: r,
    };
  }

  /** Дополнительная диагностика для экспорта (классический RMSSD vs пайплайн). */
  diagnostics(beats: readonly number[]): PracticeRmssdHampelDiagnostics | null {
    return computePracticeRmssdHampelDiagnostics(beats);
  }

  reset(): void {}
}
