/**
 * BiofeedbackProvider: единая точка инициализации Bus + Pipeline для экранов.
 *
 * Использование:
 *
 *   <BiofeedbackProvider config={FINGER_CAMERA_CAPTURE_CONFIG}>
 *     <BreathScreen />
 *   </BiofeedbackProvider>
 *
 * Внутри:
 *  - создаёт `BiofeedbackBus` и `BiofeedbackPipeline`;
 *  - предоставляет их через React-контексты;
 *  - на unmount: вызывает `pipeline.reset()` (накопители HRV / Coherence очищаются).
 *
 * Камеру и сенсор провайдер сам не монтирует — это делают отдельные компоненты
 * (`FingerPpgCameraSource`, `SimulatedSensorSource`), чтобы экран мог решать,
 * какой источник использовать.
 */

import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";

import { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import { BiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-pipeline";
import { BiofeedbackBusProvider } from "@/modules/biofeedback/bus/react";
import type { BiofeedbackCaptureConfig } from "@/modules/biofeedback/core/types";

const PipelineContext = createContext<BiofeedbackPipeline | null>(null);

export function BiofeedbackProvider({
  children,
  config,
}: PropsWithChildren<{ config: BiofeedbackCaptureConfig }>) {
  const bus = useMemo(() => new BiofeedbackBus(), []);
  const pipeline = useMemo(() => new BiofeedbackPipeline(bus, config), [bus, config]);

  useEffect(() => {
    return () => {
      pipeline.reset();
    };
  }, [pipeline]);

  return (
    <BiofeedbackBusProvider bus={bus}>
      <PipelineContext.Provider value={pipeline}>{children}</PipelineContext.Provider>
    </BiofeedbackBusProvider>
  );
}

export function useBiofeedbackPipeline(): BiofeedbackPipeline {
  const ctx = useContext(PipelineContext);
  if (ctx == null) {
    throw new Error(
      "useBiofeedbackPipeline(): нет BiofeedbackProvider выше по дереву.",
    );
  }
  return ctx;
}
