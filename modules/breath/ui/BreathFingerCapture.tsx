import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import {
  analyzeFingerRoi,
  isFingerFrameProcessorAvailable,
  type FingerFrameProcessorResult,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { FingerSignalAnalyzer } from "@/modules/biofeedback/core/finger-analysis";
import { FINGER_CAMERA_CAPTURE_CONFIG, type FingerSignalSnapshot } from "@/modules/biofeedback/core/types";

type Props = {
  isActive: boolean;
  onSnapshot: (snapshot: FingerSignalSnapshot) => void;
};

/**
 * Скрытый захват задней камеры + ROI-анализ пальца (как в Biofeedback Probe), без дублирования математики пиков.
 */
export function BreathFingerCapture({ isActive, onSnapshot }: Props) {
  const VisionCamera = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const WorkletsCore = require("react-native-worklets-core") as typeof import("react-native-worklets-core");
  const { Camera, useCameraPermission, useCameraDevice, useFrameProcessor, runAtTargetFps } = VisionCamera;
  const { Worklets } = WorkletsCore;

  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchArmed, setTorchArmed] = useState(false);
  const analyzerRef = useRef<FingerSignalAnalyzer | null>(new FingerSignalAnalyzer(FINGER_CAMERA_CAPTURE_CONFIG));
  const { hasPermission, requestPermission } = useCameraPermission();

  const isRenderActive = isFocused && appState === "active" && isActive;
  const device = useCameraDevice("back", { physicalDevices: ["wide-angle-camera"] });
  const shouldEnableTorch = isRenderActive && cameraReady && torchArmed && Boolean(device?.hasTorch);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (s) => setAppState(s));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isRenderActive) {
      setTorchArmed(false);
      return;
    }
    const t = setTimeout(() => setTorchArmed(true), 250);
    return () => clearTimeout(t);
  }, [isRenderActive, cameraReady]);

  /** Сброс анализатора только при remount (key сессии), не при isActive=false — иначе теряем буфер ударов до экспорта. */
  const handleFrame = useCallback(
    (
      width: number,
      height: number,
      pixelFormat: string | undefined,
      fingerSample: FingerFrameProcessorResult | null,
    ) => {
      setCameraReady(true);
      if (fingerSample == null) {
        return;
      }
      if (analyzerRef.current == null) {
        analyzerRef.current = new FingerSignalAnalyzer(FINGER_CAMERA_CAPTURE_CONFIG);
      }
      const snapshot = analyzerRef.current.push(fingerSample);
      onSnapshot(snapshot);
    },
    [onSnapshot],
  );

  const reportFrame = Worklets.createRunOnJS(handleFrame);

  const frameProcessor = useFrameProcessor(
    (frame) => {
      "worklet";
      runAtTargetFps(30, () => {
        "worklet";
        const fingerSample = analyzeFingerRoi(frame, { roiScale: 0.34, sampleStride: 4 });
        reportFrame(frame.width, frame.height, frame.pixelFormat, fingerSample);
      });
    },
    [reportFrame],
  );

  if (!isFingerFrameProcessorAvailable()) {
    return null;
  }

  if (!hasPermission) {
    return null;
  }

  if (!device) {
    return null;
  }

  return (
    <View style={styles.hiddenCamera} pointerEvents="none">
      <Camera
        style={styles.camera}
        device={device}
        isActive={isRenderActive}
        torch={shouldEnableTorch ? "on" : "off"}
        frameProcessor={frameProcessor}
        photo={false}
        video={false}
        audio={false}
        pixelFormat="yuv"
        onInitialized={() => setCameraReady(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenCamera: {
    position: "absolute",
    width: 2,
    height: 2,
    opacity: 0.02,
    overflow: "hidden",
    left: 0,
    top: 0,
    zIndex: 0,
  },
  camera: {
    width: 400,
    height: 400,
  },
});
