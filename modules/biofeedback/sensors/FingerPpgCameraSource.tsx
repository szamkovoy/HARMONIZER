/**
 * FingerPpgCameraSource: монтирует VisionCamera + frame plugin и подаёт сэмплы в Pipeline.
 *
 * Заменяет `BreathFingerCapture` и часть `BiofeedbackProbeScreen`. Не отдаёт snapshot
 * наружу через props — данные идут в Bus, экраны подписываются через `useBiofeedbackChannel`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import {
  analyzeFingerRoi,
  isFingerFrameProcessorAvailable,
  type FingerFrameProcessorResult,
} from "@/modules/biofeedback-finger-frame-processor/src";
import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";

type Props = {
  isActive: boolean;
  /** Стиль контейнера камеры. По умолчанию — невидимая 2x2 точка. */
  style?: ViewStyle;
  /** Если true — контейнер камеры отрисовывается обычным размером (для probe-экрана). */
  visible?: boolean;
};

export function FingerPpgCameraSource({ isActive, style, visible = false }: Props) {
  const VisionCamera = require("react-native-vision-camera") as typeof import("react-native-vision-camera");
  const WorkletsCore = require("react-native-worklets-core") as typeof import("react-native-worklets-core");
  const { Camera, useCameraPermission, useCameraDevice, useFrameProcessor, runAtTargetFps } = VisionCamera;
  const { Worklets } = WorkletsCore;

  const pipeline = useBiofeedbackPipeline();
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchArmed, setTorchArmed] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const permissionRequestedRef = useRef(false);
  const [showOpenSettingsHint, setShowOpenSettingsHint] = useState(false);

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
    pipeline.setPulseSource("fingerCamera");
    const t = setTimeout(() => setTorchArmed(true), 250);
    return () => clearTimeout(t);
  }, [isRenderActive, cameraReady, pipeline]);

  useEffect(() => {
    if (!isRenderActive) {
      permissionRequestedRef.current = false;
      setShowOpenSettingsHint(false);
      return;
    }
    if (hasPermission) {
      setShowOpenSettingsHint(false);
      return;
    }
    if (permissionRequestedRef.current) return;
    permissionRequestedRef.current = true;
    void requestPermission().then((granted) => {
      if (!granted) setShowOpenSettingsHint(true);
    });
  }, [isRenderActive, hasPermission, requestPermission]);

  const handleFrame = useCallback(
    (
      _width: number,
      _height: number,
      _pixelFormat: string | undefined,
      fingerSample: FingerFrameProcessorResult | null,
    ) => {
      setCameraReady(true);
      if (fingerSample == null) return;
      pipeline.pushOpticalSample(fingerSample);
    },
    [pipeline],
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

  if (!isFingerFrameProcessorAvailable()) return null;
  if (!device) return null;

  if (!hasPermission) {
    const gateStyle = visible ? style : [styles.hiddenCamera, style];
    return (
      <View style={gateStyle as ViewStyle} pointerEvents="box-none">
        {showOpenSettingsHint ? (
          <View style={styles.permissionHint} pointerEvents="auto">
            <Text style={styles.permissionHintText}>
              Нужен доступ к камере для измерения пульса. Разрешите камеру в настройках.
            </Text>
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={styles.permissionHintBtn}
              accessibilityRole="button"
            >
              <Text style={styles.permissionHintBtnText}>Открыть настройки</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  const containerStyle = visible ? style : [styles.hiddenCamera, style];

  return (
    <View style={containerStyle as ViewStyle} pointerEvents="none">
      <Camera
        style={visible ? styles.cameraVisible : styles.camera}
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
  cameraVisible: {
    width: "100%",
    height: "100%",
  },
  permissionHint: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 120,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(28,28,30,0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
    zIndex: 50,
  },
  permissionHintText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
  },
  permissionHintBtn: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  permissionHintBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
