/**
 * Web-заглушка: `react-native-vision-camera` не поддерживается в браузере.
 * Без этого файла Metro при сборке web / SSR тянет `VisionCameraProxy` и
 * падает с «VisionCamera currently does not work on web» → HTTP 500 на `/`.
 *
 * Нативная реализация — в `index.native.ts`.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

type ThermalStateEvent = { state: ThermalState };

type ThermalSubscription = { remove(): void };

type BiofeedbackFingerFrameProcessorNative = {
  setBackTorchLevel?(level: number): Promise<boolean>;
  turnOffBackTorch?(): Promise<boolean>;
  getThermalState?(): Promise<ThermalState>;
  getMemoryUsageMb?(): Promise<number>;
  getBatteryLevelPct?(): Promise<number>;
  addListener?(eventName: string, listener: (event: ThermalStateEvent) => void): ThermalSubscription;
};

const nativeModule = requireOptionalNativeModule<BiofeedbackFingerFrameProcessorNative>(
  "BiofeedbackFingerFrameProcessor",
);

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

export async function getThermalState(): Promise<ThermalState> {
  if (!nativeModule?.getThermalState) return "nominal";
  try {
    return await nativeModule.getThermalState();
  } catch {
    return "nominal";
  }
}

export async function getNativeMemoryMb(): Promise<number | null> {
  if (!nativeModule?.getMemoryUsageMb) return null;
  try {
    const v = await nativeModule.getMemoryUsageMb();
    return Number.isFinite(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

export async function getBatteryLevelPct(): Promise<number | null> {
  if (!nativeModule?.getBatteryLevelPct) return null;
  try {
    const v = await nativeModule.getBatteryLevelPct();
    return Number.isFinite(v) && v >= 0 ? v : null;
  } catch {
    return null;
  }
}

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

/** Заглушка типа кадра: на web frame processor не используется. */
export type Frame = Record<string, never>;

export function isFingerFrameProcessorAvailable() {
  return false;
}

export function analyzeFingerRoi(
  _frame: Frame,
  _options: FingerFrameProcessorOptions = {},
): FingerFrameProcessorResult | null {
  return null;
}
