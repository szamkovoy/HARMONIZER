/**
 * SimulatedSensor: синтетические удары с RR, модулированной «дыханием» ~0.1 Гц.
 *
 * Используется в Expo Go (без нативного frame plugin) и для тестов / дебага.
 * Не публикует optical-сэмплы (бесполезно без камеры) — сразу выдаёт `BeatEvent`.
 *
 * Sensor сам ведёт таймер и публикует beat'ы через переданный callback.
 */

import type {
  BeatEvent,
  BiofeedbackSensor,
  SensorHandle,
  SensorListeners,
  SensorMeta,
} from "@/modules/biofeedback/sensors/types";
import type { BiofeedbackCaptureConfig } from "@/modules/biofeedback/core/types";

/** Чистая функция: сгенерировать метки ударов на отрезке времени. */
export function generateSimulatedBeatTimestamps(startMs: number, endMs: number): number[] {
  const beats: number[] = [];
  let t = startMs;
  while (t < endMs) {
    const phase = ((t - startMs) / 10_000) * Math.PI * 2;
    const rr = 820 + 48 * Math.sin(phase) + 12 * Math.sin((t - startMs) * 0.0023);
    t += Math.max(400, Math.min(1400, rr));
    if (t <= endMs) {
      beats.push(Math.round(t));
    }
  }
  return beats;
}

export class SimulatedSensor implements BiofeedbackSensor {
  readonly source = "simulated" as const;
  readonly producesOptical = false;
  readonly producesBeats = true;

  async start(
    _config: BiofeedbackCaptureConfig,
    listeners: SensorListeners,
  ): Promise<SensorHandle> {
    const startMs = Date.now();
    let lastEmittedMs = startMs;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const nowMs = Date.now();
      const beats = generateSimulatedBeatTimestamps(lastEmittedMs, nowMs);
      for (const t of beats) {
        const beat: BeatEvent = {
          timestampMs: t,
          source: "detected",
          confidence: 1,
        };
        listeners.onBeatEvent?.(beat);
      }
      lastEmittedMs = nowMs;
      const meta: SensorMeta = {
        source: "simulated",
        sampleCount: 0,
        fps: 0,
        ready: true,
      };
      listeners.onMeta?.(meta);
    };

    const id = setInterval(tick, 250);

    return {
      stop() {
        cancelled = true;
        clearInterval(id);
      },
    };
  }
}
