import { Animated, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

/** Matches prior `mic_button_on.png` diameter; +20% while recording. */
export const MIC_BUTTON_SIZE = 67;
export const MIC_BUTTON_RECORDING_SCALE = 1.2;
export const MIC_BUTTON_COLOR = "#0d74f1";
export const MIC_CANCEL_COLOR = "#a8a8a8";

const ICON_SIZE = 34;
const CANCEL_ICON_SIZE = 28;

/** Paths from `assets/icons/microphone.svg` (white glyph on drawn circle). */
function MicGlyph({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 9C4.41421 9 4.75 9.33579 4.75 9.75V10.75C4.75 14.7541 7.99594 18 12 18C16.0041 18 19.25 14.7541 19.25 10.75V9.75C19.25 9.33579 19.5858 9 20 9C20.4142 9 20.75 9.33579 20.75 9.75V10.75C20.75 15.3298 17.2314 19.0879 12.75 19.4683V21.75C12.75 22.1642 12.4142 22.5 12 22.5C11.5858 22.5 11.25 22.1642 11.25 21.75V19.4683C6.7686 19.0879 3.25 15.3298 3.25 10.75V9.75C3.25 9.33579 3.58579 9 4 9Z"
        fill={color}
      />
      <Path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C8.82436 2 6.25 4.57436 6.25 7.75V10.75C6.25 13.9256 8.82436 16.5 12 16.5C15.1756 16.5 17.75 13.9256 17.75 10.75V7.75C17.75 4.57436 15.1756 2 12 2ZM14 11.5C14.4142 11.5 14.75 11.1642 14.75 10.75C14.75 10.3358 14.4142 10 14 10H10C9.58579 10 9.25 10.3358 9.25 10.75C9.25 11.1642 9.58579 11.5 10 11.5H14ZM13.75 7.75C13.75 8.16421 13.4142 8.5 13 8.5H11C10.5858 8.5 10.25 8.16421 10.25 7.75C10.25 7.33579 10.5858 7 11 7H13C13.4142 7 13.75 7.33579 13.75 7.75Z"
        fill={color}
      />
    </Svg>
  );
}

/** Soft filled cloud under the button — scale/opacity follow metering (or idle pulse). */
function RecordingAura({ level }: { level: Animated.Value }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.aura,
        {
          backgroundColor: MIC_BUTTON_COLOR,
          opacity: level.interpolate({
            inputRange: [0, 1],
            outputRange: [0.14, 0.36],
          }),
          transform: [
            {
              scale: level.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 1.55],
              }),
            },
          ],
        },
      ]}
    />
  );
}

/** Paths from `assets/icons/cancel.svg` (white glyph on gray circle). */
function CancelGlyph({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path
        d="M19.587 16.001l6.096 6.096c0.396 0.396 0.396 1.039 0 1.435l-2.151 2.151c-0.396 0.396-1.038 0.396-1.435 0l-6.097-6.096-6.097 6.096c-0.396 0.396-1.038 0.396-1.434 0l-2.152-2.151c-0.396-0.396-0.396-1.038 0-1.435l6.097-6.096-6.097-6.097c-0.396-0.396-0.396-1.039 0-1.435l2.153-2.151c0.396-0.396 1.038-0.396 1.434 0l6.096 6.097 6.097-6.097c0.396-0.396 1.038-0.396 1.435 0l2.151 2.152c0.396 0.396 0.396 1.038 0 1.435l-6.096 6.096z"
        fill={color}
      />
    </Svg>
  );
}

export function MicRecordButton({
  active,
  level,
}: {
  /** Recording or arming — circle +20%, aura visible. */
  active: boolean;
  level: Animated.Value;
}) {
  return (
    <View style={styles.wrap} pointerEvents="none">
      {active ? <RecordingAura level={level} /> : null}
      <Animated.View
        style={[
          styles.circle,
          styles.micCircle,
          {
            transform: [{ scale: active ? MIC_BUTTON_RECORDING_SCALE : 1 }],
          },
        ]}
      >
        <MicGlyph color="#FFFFFF" size={ICON_SIZE} />
      </Animated.View>
    </View>
  );
}

/** Busy/cancel control — same diameter as idle mic, gray circle + white X. */
export function MicCancelButton() {
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.circle, styles.cancelCircle]}>
        <CancelGlyph color="#FFFFFF" size={CANCEL_ICON_SIZE} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: MIC_BUTTON_SIZE * MIC_BUTTON_RECORDING_SCALE,
    height: MIC_BUTTON_SIZE * MIC_BUTTON_RECORDING_SCALE,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: MIC_BUTTON_SIZE,
    height: MIC_BUTTON_SIZE,
    borderRadius: MIC_BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  micCircle: {
    backgroundColor: MIC_BUTTON_COLOR,
  },
  cancelCircle: {
    backgroundColor: MIC_CANCEL_COLOR,
  },
  aura: {
    position: "absolute",
    width: MIC_BUTTON_SIZE * MIC_BUTTON_RECORDING_SCALE,
    height: MIC_BUTTON_SIZE * MIC_BUTTON_RECORDING_SCALE,
    borderRadius: 999,
  },
});
