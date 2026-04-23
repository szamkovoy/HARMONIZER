/**
 * Web: не импортируем `react-native-vision-camera` — иначе Metro при web-сборке
 * падает при инициализации нативного модуля.
 */
import { memo } from "react";
import { View, type ViewStyle } from "react-native";

export type FingerPpgFrameStats = {
  processingMs: number;
  receivedAtMs: number;
};

type Props = {
  isActive: boolean;
  style?: ViewStyle;
  visible?: boolean;
  silent?: boolean;
  onFrameStats?: (stats: FingerPpgFrameStats) => void;
  captureRateHint?: "normal" | "highPrecision";
};

function FingerPpgCameraSourceWebStub(_props: Props) {
  return <View style={{ width: 1, height: 1, opacity: 0 }} pointerEvents="none" />;
}

export const FingerPpgCameraSource = memo(FingerPpgCameraSourceWebStub);
