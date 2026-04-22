/**
 * Временная телеметрия для расследования торможения UI / перегрева.
 *
 * TAG_REMOVE_PERF_DIAGNOSTICS — всё, что нужно для отключения:
 *   1. В `session-runtime-diagnostics.ts` поставить `PERF_DIAGNOSTICS_ENABLED = false`.
 *   2. (опционально) убрать импорт/вызовы `recordPerfDiagSample` в
 *      `CoherenceBreathScreen.tsx` и `SessionRuntimeDiagnostics` в `pipeline`/
 *      `FingerPpgCameraSource`. Сам сэмплер при `PERF_DIAGNOSTICS_ENABLED=false`
 *      превращается в no-op и ничего не ест, но код можно снести.
 *
 * Поля семпла разделены на три группы:
 *   1. Базовые счётчики работы пайплайна (были с самого начала).
 *   2. Thermal / phase — гибридный контроллер.
 *   3. «Реальная нагрузка» (апрель 2026): FPS, frame-processor latency,
 *      JS-лаг, использование памяти. Все поля nullable: если датчик недоступен
 *      на платформе или выключен, пишется `null`.
 */

import type { ThermalState } from "@/modules/biofeedback-finger-frame-processor/src";
import type { HybridPhase } from "@/modules/breath/core/hybrid-measurement-controller";

/**
 * Главный выключатель. `true` — собираем runtime-диагностику и пишем её в
 * экспорт. `false` — `SessionRuntimeDiagnostics.push` — no-op, `getSeries()`
 * возвращает `[]`, `readJsHeapUsedBytes()` сразу отдаёт `null`. В дереве
 * компонентов jank-детектор тоже опрашивается только когда этот флаг `true`
 * (см. `CoherenceBreathScreen`).
 */
export const PERF_DIAGNOSTICS_ENABLED = true;

/** Максимум точек в серии. При 10-секундном сэмплинге это ~75 мин практики. */
const MAX_SAMPLES = 450;

/**
 * Одна точка телеметрии: «мгновенный портрет» работы приложения в момент
 * сэмплирования. Все поля в одной группе, чтобы JSON был плоский и удобный
 * для grep/node-скриптов.
 */
export type PerfDiagSample = {
  /** Монотонное wall time (Date.now). */
  wallClockMs: number;
  /** Смещение от sessionStartWallMs, мс; null если сессия не стартовала. */
  sessionOffsetMs: number | null;

  // ─── Hybrid state ─────────────────────────────────────────────────────
  thermalState: ThermalState | null;
  hybridPhase: HybridPhase | null;
  /** `silent=true` → worklet без PPG; сессия камеры на 1 fps, torch у VisionCamera. */
  cameraSilent: boolean | null;
  /** `AVCaptureSession` запущена (микрофоны/PPG-путь могут быть приглушены). */
  cameraSessionActive: boolean | null;
  /** Резерв: раньше torch только через native при `isActive=false`; сейчас false. */
  torchHeldByNative: boolean | null;
  /** Оптический путь pipeline на паузе (`setOpticalPaused(true)`). */
  opticalPaused: boolean | null;
  /**
   * Причина последнего перехода фазы гибрида на этом tick'е. `null` во
   * всех сэмплах, кроме того, где произошёл переход. Используется, чтобы
   * post-factum сказать «переключилось в emulated по jank / таймеру / thermal».
   */
  hybridTransitionReason: "thermal" | "timeCap" | "jank" | "endWindow" | null;

  // ─── Реальная нагрузка: датчики деградации (апрель 2026) ──────────────
  /** P5 (нижний перцентиль) UI FPS за последние ~N секунд. 60 Hz = ~60. */
  uiFpsP5: number | null;
  /** Медианный UI FPS за то же окно. */
  uiFpsMedian: number | null;
  /** Средняя задержка одного вызова `analyzeFingerRoi` в worklet, мс. */
  frameProcLatencyMsAvg: number | null;
  /** P95 задержки `analyzeFingerRoi` — «жирные» кадры. */
  frameProcLatencyMsP95: number | null;
  /** Средний интервал между кадрами от камеры (в worklet), мс. ~66 при 15 Hz. */
  cameraFrameIntervalMsAvg: number | null;
  /** Средний лаг `setTimeout(cb, 16)` относительно номинала, мс. Рост = JS захлёбывается. */
  jsTimerLagMsAvg: number | null;

  // ─── Память ──────────────────────────────────────────────────────────
  /** Hermes/Chrome `performance.memory.usedJSHeapSize`; на iOS обычно null. */
  usedJsHeapBytes: number | null;
  /** Нативная RSS (iOS `mach_task_basic_info.resident_size`), МБ. */
  nativeMemoryMb: number | null;

  // ─── Базовые счётчики пайплайна ──────────────────────────────────────
  counters: {
    snapshotCallbacksTotal: number;
    snapshotsWhileRunning: number;
    opticalPipelinePushes: number;
  };
};

/**
 * Буфер сэмплов одной практики. При `PERF_DIAGNOSTICS_ENABLED=false` все
 * методы — no-op, `getSeries()` отдаёт пустой массив, JSON экспорт не
 * раздувается.
 */
export class SessionRuntimeDiagnostics {
  private samples: PerfDiagSample[] = [];

  reset(): void {
    this.samples = [];
  }

  push(sample: PerfDiagSample): void {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (this.samples.length >= MAX_SAMPLES) {
      this.samples.splice(0, 1);
    }
    this.samples.push(sample);
  }

  /**
   * Помечает последнюю запись как момент перехода фазы гибрида. Вызывается
   * один раз после `push` на том тике, где `changed=true`. Если записи ещё
   * нет (или отключено) — no-op.
   */
  markHybridTransition(reason: PerfDiagSample["hybridTransitionReason"]): void {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    const last = this.samples[this.samples.length - 1];
    if (last) last.hybridTransitionReason = reason;
  }

  getSeries(): readonly PerfDiagSample[] {
    return this.samples;
  }
}

/**
 * Читает `performance.memory.usedJSHeapSize` (если доступно). Hermes на iOS
 * обычно возвращает `undefined` → `null`. Web/Chrome DevTools — число.
 */
export function readJsHeapUsedBytes(): number | null {
  if (!PERF_DIAGNOSTICS_ENABLED) return null;
  try {
    const perf = (globalThis as unknown as { performance?: { memory?: { usedJSHeapSize?: number } } })
      .performance;
    const n = perf?.memory?.usedJSHeapSize;
    return typeof n === "number" && n > 0 ? n : null;
  } catch {
    return null;
  }
}
