import { Pressable } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { SURFACE_HELP_MODAL } from "@/modules/ui/surfaceCard";

export function ModalHeaderCloseButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          alignItems: "center",
          height: SURFACE_HELP_MODAL.titleLineHeight,
          justifyContent: "center",
          opacity: pressed ? 0.72 : 1,
          width: SURFACE_HELP_MODAL.titleLineHeight,
        },
      ]}
    >
      <AppText variant="sectionTitle" tone="primary">
        ×
      </AppText>
    </Pressable>
  );
}
