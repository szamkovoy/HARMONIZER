/**
 * JankDetector — лёгкий rolling-window сенсор деградации приложения.
 *
 * TAG_REMOVE_PERF_DIAGNOSTICS — выключается вместе с флагом
 * `PERF_DIAGNOSTICS_ENABLED` (см. `session-runtime-diagnostics.ts`). Внешнее
 * API не меняется: `getSnapshot()` возвращает `null` во всех полях, а
 * триггер никогда не срабатывает, т.к. `shouldTriggerEmulated()` смотрит
 * только на реально собранные метрики.
 *
 * Что детектируем (независимо от `thermalState`):
 *  - UI FPS (по setInterval или useFrameCallback таймстампам);
 *  - среднюю и p95 задержку нативного frame processor'а;
 *  - «лаг» JS-таймера: `setTimeout(cb, 16)` → реальная задержка минус 16 мс.
 *
 * Почему это важно: `ProcessInfo.thermalState` срабатывает далеко не на
 * каждом устройстве и не во всех условиях (тёплая комната, короткий сеанс).
 * Пока iOS ещё не поднял флаг, приложение уже может заметно тормозить, и
 * это как раз и есть то, что пользователь чувствует. Jank-детектор ловит
 * этот момент напрямую, по проявлению, а не по ожиданию.
 *
 * Архитектура: все буферы — fixed-size ring buffers (без аллокаций в горячем
 * пути). `pushFrameProcLatency` вызывается из JS-колбэка frame processor'а
 * (не из worklet), `onJsTimerTick` — из setInterval в экране, `onUiFrame`
 * — из useFrameCallback через `runOnJS`. Все три — дешёвые push в массивы.
 */

import { PERF_DIAGNOSTICS_ENABLED } from "@/modules/breath/debug/session-runtime-diagnostics";

/** Окно, за которое считаются медианы/перцентили. */
const WINDOW_MS = 5_000;
/** Максимум точек в ring buffer'е (защита от аномального всплеска частоты). */
const MAX_POINTS = 1024;
/**
 * Интервал опроса JS-таймера. Номинально 16 мс ≈ 60 Hz; разница между
 * фактическим dt и 16 мс показывает, насколько JS-loop захлёбывается.
 */
const JS_TIMER_NOMINAL_MS = 16;

type RingPoint = { tMs: number; v: number };

class Ring {
  private points: RingPoint[] = [];
  push(tMs: number, v: number) {
    this.points.push({ tMs, v });
    if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
  }
  values(now: number): number[] {
    const cutoff = now - WINDOW_MS;
    while (this.points.length > 0 && this.points[0]!.tMs < cutoff) this.points.shift();
    return this.points.map((p) => p.v);
  }
  clear() {
    this.points = [];
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(((sorted.length - 1) * p) / 100)));
  return sorted[idx] ?? null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export type JankSnapshot = {
  uiFpsMedian: number | null;
  uiFpsP5: number | null;
  frameProcLatencyMsAvg: number | null;
  frameProcLatencyMsP95: number | null;
  cameraFrameIntervalMsAvg: number | null;
  jsTimerLagMsAvg: number | null;
};

export class JankDetector {
  private uiFrameDeltas = new Ring();
  private frameProcLatencies = new Ring();
  private cameraIntervals = new Ring();
  private jsTimerLags = new Ring();

  private lastUiFrameMs = 0;
  private lastCameraFrameMs = 0;

  /** Вызывать из useFrameCallback через runOnJS (или из setInterval 60 Hz). */
  onUiFrame(tMs: number): void {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (this.lastUiFrameMs > 0) {
      const dt = tMs - this.lastUiFrameMs;
      if (dt > 0 && dt < 1000) this.uiFrameDeltas.push(tMs, dt);
    }
    this.lastUiFrameMs = tMs;
  }

  /**
   * Задержка одного вызова нативного `analyzeFingerRoi` (мс). Измеряется
   * с JS-стороны как разница между временем прихода сэмпла в `reportFrame`
   * и `frame.timestampMs`. Это даёт верхнюю оценку латентности, включая
   * worklet → JS мост. Не идеально точно, но отлично показывает тренд.
   */
  pushFrameProcLatency(nowMs: number, latencyMs: number): void {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    if (latencyMs > 0 && latencyMs < 10_000) {
      this.frameProcLatencies.push(nowMs, latencyMs);
    }
    if (this.lastCameraFrameMs > 0) {
      const dt = nowMs - this.lastCameraFrameMs;
      if (dt > 0 && dt < 2000) this.cameraIntervals.push(nowMs, dt);
    }
    this.lastCameraFrameMs = nowMs;
  }

  /** Прогон лага JS-таймера. `elapsedMs` — фактическое dt от последнего тика. */
  onJsTimerTick(tMs: number, elapsedMs: number): void {
    if (!PERF_DIAGNOSTICS_ENABLED) return;
    const lag = elapsedMs - JS_TIMER_NOMINAL_MS;
    if (lag > -5 && lag < 2000) this.jsTimerLags.push(tMs, lag);
  }

  getSnapshot(): JankSnapshot {
    const now = Date.now();
    const ui = this.uiFrameDeltas.values(now);
    const fp = this.frameProcLatencies.values(now);
    const ci = this.cameraIntervals.values(now);
    const jl = this.jsTimerLags.values(now);

    const uiFpsValues = ui.map((dt) => 1000 / dt).filter((v) => Number.isFinite(v) && v > 0);
    const uiFpsMedian = percentile(uiFpsValues, 50);
    const uiFpsP5 = percentile(uiFpsValues, 5);

    return {
      uiFpsMedian: uiFpsMedian != null ? Math.round(uiFpsMedian * 10) / 10 : null,
      uiFpsP5: uiFpsP5 != null ? Math.round(uiFpsP5 * 10) / 10 : null,
      frameProcLatencyMsAvg: mean(fp),
      frameProcLatencyMsP95: percentile(fp, 95),
      cameraFrameIntervalMsAvg: mean(ci),
      jsTimerLagMsAvg: mean(jl),
    };
  }

  /**
   * Булев сигнал «приложение деградирует, пора уходить в emulated». Считается
   * консервативно: срабатывает, если ИЛИ UI FPS обвалился, ИЛИ frame-proc
   * p95 драматически подскочил, ИЛИ JS-лаг стал системным.
   *
   * Пороги откалиброваны под 60 Hz UI + 15 Hz PPG:
   *  - `uiFpsP5 < 40` — 5% кадров длятся > 25 мс (заметный jank);
   *  - `frameProcLatencyP95 > 80 мс` — нативный плагин считает > 2 длин кадра
   *    (при 15 Hz = 66 мс);
   *  - `jsTimerLagAvg > 40 мс` — JS-loop регулярно пропускает ≥ 2 кадра.
   *
   * Требуется хотя бы `minSamples` наблюдений в каждом рассматриваемом
   * источнике, чтобы ранний шум «холодного старта» не давал false positive.
   */
  shouldTriggerEmulated(opts: { minSamples?: number } = {}): boolean {
    if (!PERF_DIAGNOSTICS_ENABLED) return false;
    const minSamples = opts.minSamples ?? 30;
    const now = Date.now();
    const ui = this.uiFrameDeltas.values(now);
    const fp = this.frameProcLatencies.values(now);
    const jl = this.jsTimerLags.values(now);

    if (ui.length >= minSamples) {
      const uiFpsValues = ui.map((dt) => 1000 / dt).filter((v) => Number.isFinite(v) && v > 0);
      const p5 = percentile(uiFpsValues, 5);
      if (p5 != null && p5 < 40) return true;
    }
    if (fp.length >= Math.floor(minSamples / 2)) {
      const p95 = percentile(fp, 95);
      if (p95 != null && p95 > 80) return true;
    }
    if (jl.length >= minSamples) {
      const avg = mean(jl);
      if (avg != null && avg > 40) return true;
    }
    return false;
  }

  reset(): void {
    this.uiFrameDeltas.clear();
    this.frameProcLatencies.clear();
    this.cameraIntervals.clear();
    this.jsTimerLags.clear();
    this.lastUiFrameMs = 0;
    this.lastCameraFrameMs = 0;
  }
}
