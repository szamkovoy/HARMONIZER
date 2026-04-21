import { requireOptionalNativeModule } from "expo-modules-core";
import { VisionCameraProxy, type Frame } from "react-native-vision-camera";

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

type ThermalStateEvent = { state: ThermalState };

type ThermalSubscription = { remove(): void };

type BiofeedbackFingerFrameProcessorNative = {
  setBackTorchLevel?(level: number): Promise<boolean>;
  turnOffBackTorch?(): Promise<boolean>;
  getThermalState?(): Promise<ThermalState>;
  addListener?(eventName: string, listener: (event: ThermalStateEvent) => void): ThermalSubscription;
};

const nativeModule = requireOptionalNativeModule<BiofeedbackFingerFrameProcessorNative>(
  "BiofeedbackFingerFrameProcessor",
);

/**
 * Задаёт уровень задней вспышки (torch) для PPG-замеров.
 *
 * Платформенная реализация: iOS вызывает `AVCaptureDevice.setTorchModeOn(level:)`
 * с clamp'ом в [0.05, 1.0]. Android пока игнорируется (возвращает false) —
 * VisionCamera на Android управляет torch только в on/off, и большинство
 * OEM прошивок не дают программный контроль яркости LED через Camera2.
 *
 * Возвращает `true`, если уровень реально применён. `false` — если
 * нативный модуль недоступен, у устройства нет torch, либо не удалось
 * захватить lock (например, пока VisionCamera-сессия не активна).
 */
export async function setBackTorchLevel(level: number): Promise<boolean> {
  if (!nativeModule?.setBackTorchLevel) return false;
  try {
    return await nativeModule.setBackTorchLevel(level);
  } catch {
    return false;
  }
}

export async function turnOffBackTorch(): Promise<boolean> {
  if (!nativeModule?.turnOffBackTorch) return false;
  try {
    return await nativeModule.turnOffBackTorch();
  } catch {
    return false;
  }
}

/**
 * Возвращает текущий уровень теплового состояния (iOS ProcessInfo.thermalState).
 *
 * Уровни: "nominal" | "fair" | "serious" | "critical".
 *  - `nominal` — троттлинга нет.
 *  - `fair` — ОС готовится снижать частоты CPU/GPU (первый «звонок»).
 *    Гибридный контроллер переключает сессию в эмуляцию пульса на этом
 *    уровне, чтобы предотвратить лаг ДО того, как он станет заметным.
 *  - `serious` — частоты снижены, приложение уже подтормаживает.
 *  - `critical` — экстренное состояние, система может убить процесс.
 *
 * На Android / в симуляторе / при отсутствии native-модуля всегда
 * возвращает `"nominal"`. В таком режиме гибридный контроллер опирается
 * только на временной кэп (см. `hybrid-measurement-controller`).
 */
export async function getThermalState(): Promise<ThermalState> {
  if (!nativeModule?.getThermalState) return "nominal";
  try {
    return await nativeModule.getThermalState();
  } catch {
    return "nominal";
  }
}

/**
 * Подписка на изменения теплового состояния. iOS шлёт событие один раз
 * при переходе между уровнями (nominal ↔ fair ↔ serious ↔ critical).
 *
 * Используется гибридным контроллером для мгновенной реакции: как только
 * система повысила уровень до `fair`, контроллер готов переключать сессию
 * в эмуляцию (если также соблюдены min-time и достаточно данных).
 */
export function subscribeThermalState(
  listener: (state: ThermalState) => void,
): { remove(): void } {
  if (!nativeModule?.addListener) {
    return { remove() {} };
  }
  const subscription = nativeModule.addListener("onThermalStateChanged", (event) => {
    listener(event.state);
  });
  return {
    remove() {
      subscription.remove();
    },
  };
}

export type FingerFrameProcessorOptions = {
  roiScale?: number;
  sampleStride?: number;
};

export type FingerFrameProcessorResult = {
  timestampMs: number;
  width: number;
  height: number;
  redMean: number;
  greenMean: number;
  blueMean: number;
  lumaMean: number;
  redDominance: number;
  darknessRatio: number;
  saturationRatio: number;
  motion: number;
  sampleCount: number;
  roiAreaRatio: number;
};

const fingerFrameProcessorPlugin = VisionCameraProxy.initFrameProcessorPlugin("analyzeFingerRoi", {});

export function isFingerFrameProcessorAvailable() {
  return fingerFrameProcessorPlugin != null;
}

export function analyzeFingerRoi(
  frame: Frame,
  options: FingerFrameProcessorOptions = {},
): FingerFrameProcessorResult | null {
  "worklet";

  if (fingerFrameProcessorPlugin == null) {
    return null;
  }

  return fingerFrameProcessorPlugin.call(frame, options) as FingerFrameProcessorResult | null;
}
