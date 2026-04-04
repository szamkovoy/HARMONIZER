import {
  Image,
  Pressable,
  StyleSheet,
  useColorScheme,
} from "react-native";

const voiceImg = require("@/assets/icons/mode_voice.png");
const txtImg = require("@/assets/icons/mode_txt.png");

export function ModeToggle({
  targetMode,
  onToggle,
  disabled,
}: {
  targetMode: "VOICE" | "TXT";
  onToggle: () => void;
  disabled?: boolean;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        targetMode === "VOICE"
          ? "Переключить на голос"
          : "Переключить на текст"
      }
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.hit,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        isDark && styles.darkImg,
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
  darkImg: { opacity: 0.95 },
  imgVoice: { width: 22, height: 22 },
  imgTxt: { width: 40, height: 22 },
});
