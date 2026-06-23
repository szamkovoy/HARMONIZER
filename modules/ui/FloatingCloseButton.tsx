import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function FloatingCloseButton({
  onPress,
  accessibilityLabel,
  topOffset = 18,
  rightOffset = 18,
  size = 44,
  style,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  topOffset?: number;
  rightOffset?: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const radius = size / 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [
        styles.button,
        {
          top: insets.top + topOffset,
          right: rightOffset,
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: pressed
            ? theme.colors.controlButtonPressedBg
            : theme.colors.controlButtonBg,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <AppText variant="sectionTitle" tone="primary">
        ×
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
