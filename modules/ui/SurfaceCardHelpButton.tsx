import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";

import { SURFACE_CARD_HELP } from "@/modules/ui/surfaceCard";
import { useTheme } from "@/modules/ui/theme";

export function SurfaceCardHelpButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ opacity: pressed ? 0.72 : 1 }]}
    >
      <Ionicons
        name="help-circle-outline"
        size={SURFACE_CARD_HELP.iconSize}
        color={theme.colors.textPrimary}
      />
    </Pressable>
  );
}
