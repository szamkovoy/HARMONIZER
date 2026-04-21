/**
 * HybridMeasurementController: state-machine для «гибридного» режима практики.
 *
 * Идея (апрель 2026): длинные (20+ мин) практики с непрерывным PPG-замером
 * через камеру телефона приводят к перегреву ISP + торча + CPU, после чего
 * графика интерфейса начинает подёргиваться. При этом пользователю важно
 * получать реальные биометрические данные только в начале и в конце
 * практики — в середине достаточно лишь **среднего пульса** для движения
 * индикатора дыхания. Гибридный режим эксплуатирует это:
 *
 *   realStart  → emulated (~середина практики) → realEnd
 *
 * На фазе `emulated` камера с фонариком остаются активными (пользователь
 * визуально ничего не замечает), но worklet и pipeline не обрабатывают
 * optical-сэмплы → процессор «отдыхает», телефон остывает, графика
 * работает плавно. Baseline BPM заморожен на значении, вычисленном по
 * последней минуте реальных замеров.
 *
 * Переходы (см. `tick()`):
 *  - realStart → emulated:
 *      • прошло ≥ MIN_REAL_START_MS (3 мин — иначе недостаточно данных);
 *      • триггер: thermalState ≥ `fair` **или** прошло ≥ MAX_REAL_START_MS
 *        (8 мин — страховка на холодных девайсах);
 *      • есть запас времени на endWindow + буфер (иначе не переходим,
 *        просто остаёмся в real до конца);
 *  - emulated → realEnd:
 *      • оставшееся время ≤ endWindow;
 *      • endWindow = clamp(realStartDurationMs × 0.6, 4 мин, 7 мин).
 *
 * Контроллер ничего не знает про UI, pipeline, планировщик. Он чистый
 * state-machine: на вход — время и thermalState, на выход — фаза и
 * точные моменты переключения. Интегратор (экран практики) реагирует
 * на смену фазы: замораживает baseline, включает/выключает camera
 * silent-mode, размечает «окна» для dual-finalize метрик.
 */

import type { ThermalState } from "@/modules/biofeedback-finger-frame-processor/src";

export type HybridPhase = "realStart" | "emulated" | "realEnd";

export type HybridTickInput = {
  /** Монотонное время now в мс (логическое, одной шкалы с practiceStartMs). */
  nowMs: number;
  /** Логический старт running-фазы практики (не wall-clock). */
  practiceStartMs: number;
  /** Полная длительность running-фазы практики в мс (из TIMING). */
  practiceTotalMs: number;
  /** Текущий thermalState (iOS). На Android / симуляторе всегда "nominal". */
  thermalState: ThermalState;
};

export type HybridTickOutput = {
  phase: HybridPhase;
  /** true — фаза сменилась на этом tick'е (используется для one-shot эффектов). */
  changed: boolean;
  /** Момент окончания realStart (конец «начального окна» для финальных метрик). */
  realStartEndedAtMs: number | null;
  /** Момент начала realEnd (начало «конечного окна»). */
  realEndStartedAtMs: number | null;
  /** Фактическая длительность endWindow в мс (определяется в момент перехода). */
  endWindowMs: number | null;
};

export type HybridControllerConfig = {
  /**
   * Минимальная длительность начального реального замера до разрешения
   * переключения в emulated. Ниже — недостаточно валидных данных для HRV/RSA.
   * По умолчанию 3 мин.
   */
  minRealStartMs: number;
  /**
   * Верхний кэп начального замера: если thermalState так и не поднялся
   * выше `nominal` (холодный девайс), принудительно переключаемся через
   * этот срок. По умолчанию 8 мин — достаточно для качественных RMSSD/RSA.
   */
  maxRealStartMs: number;
  /**
   * Нижняя граница конечного окна (в минутах: 4 мин). Меньше — не успеет
   * набраться валидных данных после повторного lock'а.
   */
  endWindowMinMs: number;
  /**
   * Верхняя граница конечного окна (в минутах: 7 мин). Больше смысла нет —
   * данные и так наберутся, а телефон начнёт греться.
   */
  endWindowMaxMs: number;
  /**
   * Доля начального realStart, используемая для оценки длительности endWindow.
   * По умолчанию 0.6: если начальный замер длился 5 мин, endWindow = 3 мин,
   * но с clamp к [4, 7] → 4 мин. Пользовательская логика: чем дольше
   * устройство продержалось на реальном PPG, тем оно «холоднее», тем
   * больше endWindow можно себе позволить (до максимума 7 мин).
   */
  endWindowFraction: number;
  /**
   * Дополнительный буфер после end-переключения: если оставшегося времени
   * практики меньше чем `endWindow + buffer`, мы не уходим в emulated
   * вовсе (останемся real до конца — данных в любом случае не успеем
   * перезахватить). По умолчанию 30 с.
   */
  endBufferMs: number;
  /**
   * Минимальный thermalState, при котором разрешается переключение в
   * emulated. По умолчанию "fair" — первый «звонок» ОС о нагреве.
   * "serious" — более консервативная стратегия (переключаемся только
   * когда троттлинг УЖЕ начался и пользователь видит лаги).
   */
  thermalTriggerLevel: ThermalState;
};

export const DEFAULT_HYBRID_CONFIG: HybridControllerConfig = {
  minRealStartMs: 3 * 60_000,
  maxRealStartMs: 8 * 60_000,
  endWindowMinMs: 4 * 60_000,
  endWindowMaxMs: 7 * 60_000,
  endWindowFraction: 0.6,
  endBufferMs: 30_000,
  thermalTriggerLevel: "fair",
};

const THERMAL_ORDER: Record<ThermalState, number> = {
  nominal: 0,
  fair: 1,
  serious: 2,
  critical: 3,
};

function thermalAtLeast(level: ThermalState, threshold: ThermalState): boolean {
  return THERMAL_ORDER[level] >= THERMAL_ORDER[threshold];
}

export class HybridMeasurementController {
  private phase: HybridPhase = "realStart";
  private realStartEndedAtMs: number | null = null;
  private realEndStartedAtMs: number | null = null;
  private endWindowMs: number | null = null;
  private readonly config: HybridControllerConfig;

  constructor(config: Partial<HybridControllerConfig> = {}) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  /** Сброс к начальному состоянию (между практиками). */
  reset(): void {
    this.phase = "realStart";
    this.realStartEndedAtMs = null;
    this.realEndStartedAtMs = null;
    this.endWindowMs = null;
  }

  getPhase(): HybridPhase {
    return this.phase;
  }

  getSnapshot(): Omit<HybridTickOutput, "changed"> {
    return {
      phase: this.phase,
      realStartEndedAtMs: this.realStartEndedAtMs,
      realEndStartedAtMs: this.realEndStartedAtMs,
      endWindowMs: this.endWindowMs,
    };
  }

  /**
   * Вычисляет endWindow для ТЕКУЩЕГО realStartDurationMs.
   * Используется как для внутренней логики, так и для внешней проверки
   * «хватит ли оставшегося времени на осмысленный endWindow».
   */
  computeEndWindowMs(realStartDurationMs: number): number {
    const { endWindowFraction, endWindowMinMs, endWindowMaxMs } = this.config;
    const fraction = realStartDurationMs * endWindowFraction;
    return Math.max(endWindowMinMs, Math.min(endWindowMaxMs, fraction));
  }

  /**
   * Основной шаг контроллера. Вызывается интегратором раз в 1-2 сек
   * во время running-фазы практики. Возвращает текущую фазу и флаг
   * `changed=true` на том tick'е, где произошёл переход (для one-shot
   * побочных эффектов: seedBaseline, setSilent, и т.п.).
   */
  tick(input: HybridTickInput): HybridTickOutput {
    const prev = this.phase;
    const { nowMs, practiceStartMs, practiceTotalMs, thermalState } = input;
    const elapsedMs = Math.max(0, nowMs - practiceStartMs);
    const remainingMs = Math.max(0, practiceTotalMs - elapsedMs);

    if (this.phase === "realStart") {
      const hasEnoughData = elapsedMs >= this.config.minRealStartMs;
      if (hasEnoughData) {
        const thermalTrigger = thermalAtLeast(thermalState, this.config.thermalTriggerLevel);
        const timeTrigger = elapsedMs >= this.config.maxRealStartMs;
        if (thermalTrigger || timeTrigger) {
          // Оцениваем, поместится ли осмысленный endWindow в оставшееся время.
          const endWindow = this.computeEndWindowMs(elapsedMs);
          const haveRoomForEnd = remainingMs >= endWindow + this.config.endBufferMs;
          if (haveRoomForEnd) {
            this.phase = "emulated";
            this.realStartEndedAtMs = nowMs;
            this.endWindowMs = endWindow;
          }
          // Если не помещается — просто остаёмся в realStart, но разрешение
          // стоит выше min-time: значит до конца практики будет непрерывный
          // реальный замер без emulated-середины. Это лучше, чем рискнуть
          // остаться без end-данных.
        }
      }
    } else if (this.phase === "emulated") {
      // Пороговая точка: если до конца практики осталось ≤ endWindow —
      // пора переключаться обратно на реальное PPG, чтобы успеть
      // перезахватить сигнал и набрать данных для финальных метрик.
      const endWindow = this.endWindowMs ?? this.config.endWindowMinMs;
      if (remainingMs <= endWindow) {
        this.phase = "realEnd";
        this.realEndStartedAtMs = nowMs;
      }
    }
    // realEnd — терминальная фаза; дальше переходов нет.

    return {
      phase: this.phase,
      changed: this.phase !== prev,
      realStartEndedAtMs: this.realStartEndedAtMs,
      realEndStartedAtMs: this.realEndStartedAtMs,
      endWindowMs: this.endWindowMs,
    };
  }
}
