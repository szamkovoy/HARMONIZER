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

/**
 * Если между последним принятым и новым ударом пауза больше этого порога, новый удар
 * **не принимается** в накопитель, а интервал помечается как «рваный» (палец был оторван,
 * реальный RR неизвестен, большой псевдо-RR исказил бы RMSSD/стресс в разы).
 * Это событие увеличивает `gapCount` для downstream-правил withholding.
 */
const HRV_MAX_BEAT_GAP_MS = 2_000;

export class HrvBeatAccumulator {
  private readonly beats: number[] = [];
  private accumulationStartMs = 0;
  private calibrationComplete = false;
  /** Сколько раз пришёл удар после «дыры» > HRV_MAX_BEAT_GAP_MS (для withholding). */
  private gapEventCount = 0;
  /** Суммарная длительность дыр в мс (для отладки). */
  private totalGapMs = 0;

  /** Вызывается из CalibrationStateMachine при переходе settle → ready. */
  markCalibrationComplete(timestampMs: number): void {
    this.calibrationComplete = true;
    this.accumulationStartMs = timestampMs;
    this.beats.length = 0;
    this.gapEventCount = 0;
    this.totalGapMs = 0;
  }

  /** Сколько раз приходил удар после дыры > 2 с (используется для withholding). */
  getGapEventCount(): number {
    return this.gapEventCount;
  }

  /** Суммарное время провалов в мс. */
  getTotalGapMs(): number {
    return this.totalGapMs;
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
        const gap = last > 0 ? t - last : 0;
        // Фиксируем событие большой дыры (палец оторвался) и НЕ принимаем
        // этот удар в накопитель HRV: его «RR» физически неизвестен и внес бы
        // ~1500–3000 мс в пары ΔRR, уведя RMSSD в 150+ мс искусственно.
        if (last > 0 && gap > HRV_MAX_BEAT_GAP_MS) {
          this.gapEventCount += 1;
          this.totalGapMs += gap;
          last = t;
          continue;
        }
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
    this.gapEventCount = 0;
    this.totalGapMs = 0;
  }
}
