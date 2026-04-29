import {
  Image,
  Pressable,
  StyleSheet,
} from "react-native";

import type { CommunicatorStrings } from "@/modules/communicator/i18n/communicator";

const voiceImg = require("@/assets/icons/mode_voice.png");
const txtImg = require("@/assets/icons/mode_txt.png");

export function ModeToggle({
  targetMode,
  onToggle,
  disabled,
  strings,
}: {
  targetMode: "VOICE" | "TXT";
  onToggle: () => void;
  disabled?: boolean;
  strings: CommunicatorStrings;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        targetMode === "VOICE"
          ? strings.switchToVoiceAccessibilityLabel
          : strings.switchToTextAccessibilityLabel
      }
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.hit,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Image
        source={targetMode === "VOICE" ? voiceImg : txtImg}
        style={targetMode === "VOICE" ? styles.imgVoice : styles.imgTxt}
        resizeMode="contain"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  imgVoice: { width: 22, height: 22 },
  imgTxt: { width: 40, height: 22 },
});
