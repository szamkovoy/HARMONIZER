import { VisionCameraProxy, type Frame } from "react-native-vision-camera";

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
