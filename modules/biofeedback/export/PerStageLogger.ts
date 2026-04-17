/**
 * PerStageLogger: кольцевой буфер сырых данных на каждом этапе конвейера.
 *
 * Цель — позволить экспорту v3 содержать промежуточные значения (не только финальные
 * метрики), чтобы анализ JSON показывал, где именно в цепочке возникает ошибка.
 *
 * Использование:
 *   const logger = new PerStageLogger({ limit: 512 });
 *   logger.log("optical", { redMean, greenMean, baseline });
 *   logger.log("peakDetector", { acceptedCount, rejectedCount });
 *   ...
 *   const dump = logger.dump(); // { optical: [...], peakDetector: [...], ... }
 *
 * Подключение к Pipeline происходит опционально (через `attach`). Если не подключён —
 * математика и публикации в Bus идут как обычно, без накладных расходов.
 */

export type StageName =
  | "optical"
  | "peakDetector"
  | "beatMerger"
  | "calibration"
  | "livePulse"
  | "pulseBpm"
  | "hrv"
  | "stress"
  | "coherence"
  | "rsa";

export interface PerStageLoggerOptions {
  limit?: number;
}

export class PerStageLogger {
  private readonly buffers: Map<StageName, unknown[]> = new Map();
  private readonly limit: number;

  constructor(opts: PerStageLoggerOptions = {}) {
    this.limit = opts.limit ?? 512;
  }

  log(stage: StageName, entry: unknown): void {
    let arr = this.buffers.get(stage);
    if (!arr) {
      arr = [];
      this.buffers.set(stage, arr);
    }
    arr.push(entry);
    if (arr.length > this.limit) arr.shift();
  }

  /** Снимок всех буферов для включения в экспорт v3. */
  dump(): Record<StageName, unknown[]> {
    const result = {} as Record<StageName, unknown[]>;
    for (const stage of [
      "optical",
      "peakDetector",
      "beatMerger",
      "calibration",
      "livePulse",
      "pulseBpm",
      "hrv",
      "stress",
      "coherence",
      "rsa",
    ] as StageName[]) {
      result[stage] = [...(this.buffers.get(stage) ?? [])];
    }
    return result;
  }

  reset(): void {
    this.buffers.clear();
  }
}
