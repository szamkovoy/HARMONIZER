/**
 * SimulatedSensorSource: React-обёртка над `SimulatedSensor`. Запускает таймер при mount,
 * подаёт удары в Pipeline через `pushBeatEvent`. Для использования в Expo Go и debug.
 *
 * При первом mount помечает калибровку готовой (симулятор не требует прогрева).
 */

import { useEffect } from "react";

import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { generateSimulatedBeatTimestamps } from "@/modules/biofeedback/sensors/simulated-sensor";

type Props = {
  isActive: boolean;
};

export function SimulatedSensorSource({ isActive }: Props) {
  const pipeline = useBiofeedbackPipeline();

  useEffect(() => {
    if (!isActive) return;

    const startMs = Date.now();
    pipeline.setPulseSource("simulated");
    pipeline.markCalibrationCompleteForBeatSource(startMs);

    let lastEmittedMs = startMs;
    const id = setInterval(() => {
      const nowMs = Date.now();
      const beats = generateSimulatedBeatTimestamps(lastEmittedMs, nowMs);
      for (const t of beats) {
        pipeline.pushBeatEvent(nowMs, t);
      }
      lastEmittedMs = nowMs;
    }, 250);

    return () => {
      clearInterval(id);
    };
  }, [isActive, pipeline]);

  return null;
}
