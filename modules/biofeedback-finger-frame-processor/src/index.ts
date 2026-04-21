import { requireOptionalNativeModule } from "expo-modules-core";
import { VisionCameraProxy, type Frame } from "react-native-vision-camera";

type BiofeedbackFingerFrameProcessorNative = {
  setBackTorchLevel?(level: number): Promise<boolean>;
  turnOffBackTorch?(): Promise<boolean>;
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
