/**
 * EmulatedPulseSensorSource: React-обёртка над эмулятором пульса. Используется в Breath,
 * когда пользователь явно выбрал «практиковать без датчика пульса» или когда на этапе
 * прогрева камера не нашла палец и пользователь согласился продолжить без пульсометра.
 *
 * При mount:
 *  - помечает источник пульса как `emulated` (pipeline.setPulseSource) → потребители
 *    withhold-ят все HRV/coherence/RSA/stress метрики (они считаются только для реального
 *    пульса, см. требование к UI результатов практики).
 *  - регистрирует калибровку готовой (эмулятору не нужен прогрев).
 *  - каждые 250 мс подаёт новые beat-события по кривой 75 → 65 BPM за 3 мин
 *    (затем константа 65 BPM).
 *
 * НЕ является обычным сенсором (не имплементирует `BiofeedbackSensor`), потому что сырые
 * удары эмулятора лежат строго внутри pipeline: для них не нужен optical frame plugin,
 * и они не должны проходить через `CalibrationStateMachine` / `PeakDetector`.
 */

import { useEffect, useRef } from "react";

import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import { generateEmulatedPulseBeats } from "@/modules/biofeedback/sensors/emulated-pulse-sensor";

type Props = {
  isActive: boolean;
};

export function EmulatedPulseSensorSource({ isActive }: Props) {
  const pipeline = useBiofeedbackPipeline();
  const emulationStartMsRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const lastEmittedMsRef = useRef(0);

  useEffect(() => {
    if (!isActive) return;

    const startMs = Date.now();
    emulationStartMsRef.current = startMs;
    phaseRef.current = 0;
    lastEmittedMsRef.current = startMs;

    pipeline.setPulseSource("emulated");
    pipeline.markCalibrationCompleteForBeatSource(startMs);

    const id = setInterval(() => {
      const nowMs = Date.now();
      const emuStart = emulationStartMsRef.current ?? nowMs;
      const { beats, phaseAtTo } = generateEmulatedPulseBeats(
        emuStart,
        lastEmittedMsRef.current,
        nowMs,
        phaseRef.current,
      );
      phaseRef.current = phaseAtTo;
      lastEmittedMsRef.current = nowMs;
      for (const t of beats) {
        pipeline.pushBeatEvent(nowMs, t);
      }
    }, 250);

    return () => {
      clearInterval(id);
    };
  }, [isActive, pipeline]);

  return null;
}
