/**
 * HrvBeatAccumulator: единый накопитель валидных для HRV ударов после калибровки.
 *
 * Был внутри `FingerSignalAnalyzer` как `hrvValidBeatTimestampsMs` + `appendNewHrvValidBeats`
 * + `syncBeatEligibilityFromMerged`. Вынесен сюда, чтобы и HrvEngine, и StressEngine, и
 * экспорт смотрели на один источник.
 *
 * Контракт:
 *  - Все добавляемые удары должны быть строго возрастающими.
 *  - В накопитель попадают только удары, помеченные как `eligible` (пришли в фазе tracking),
 *    и только после `markCalibrationComplete()` (когда CalibrationStateMachine достиг ready).
 *  - Несколько кадров подряд могут вернуть один и тот же merged-конец — дубликат фильтруется
 *    по допуску `BEAT_DUPLICATE_TOLERANCE_MS * 0.35`.
 */

import { BEAT_DUPLICATE_TOLERANCE_MS } from "@/modules/biofeedback/constants";

export class HrvBeatAccumulator {
  private readonly beats: number[] = [];
  private accumulationStartMs = 0;
  private calibrationComplete = false;

  /** Вызывается из CalibrationStateMachine при переходе settle → ready. */
  markCalibrationComplete(timestampMs: number): void {
    this.calibrationComplete = true;
    this.accumulationStartMs = timestampMs;
    this.beats.length = 0;
  }

  /**
   * Добавляет новые eligible-удары из merged-ленты (массивы той же длины).
   * Возвращает число фактически добавленных ударов.
   */
  ingest(
    mergedBeats: readonly number[],
    eligibleFlags: readonly boolean[],
    nowTimestampMs: number,
  ): number {
    if (!this.calibrationComplete) {
      return 0;
    }
    const startMs =
      this.accumulationStartMs > 0 ? this.accumulationStartMs : nowTimestampMs;
    let last = this.beats[this.beats.length - 1] ?? 0;
    let added = 0;
    const minGap = BEAT_DUPLICATE_TOLERANCE_MS * 0.35;

    for (let i = 0; i < mergedBeats.length; i += 1) {
      if (!eligibleFlags[i]) {
        continue;
      }
      const t = mergedBeats[i]!;
      if (t < startMs - 1) {
        continue;
      }
      if (last > 0 && t <= last + minGap) {
        continue;
      }
      if (t > last) {
        this.beats.push(t);
        last = t;
        added += 1;
      }
    }
    return added;
  }

  getBeats(): readonly number[] {
    return this.beats;
  }

  getCount(): number {
    return this.beats.length;
  }

  isReady(): boolean {
    return this.calibrationComplete;
  }

  reset(): void {
    this.beats.length = 0;
    this.accumulationStartMs = 0;
    this.calibrationComplete = false;
  }
}
