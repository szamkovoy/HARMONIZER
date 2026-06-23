import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { SURFACE_CARD } from "@/modules/ui/surfaceCard";
import { useTheme } from "@/modules/ui/theme";

type SurfaceCardTone = "default" | "elevated" | "warning" | "danger";

export function SurfaceCardView({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: SurfaceCardTone;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const colors =
    tone === "elevated"
      ? { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }
      : tone === "warning"
        ? { backgroundColor: theme.colors.surface, borderColor: theme.colors.warning }
        : tone === "danger"
          ? { backgroundColor: theme.colors.surface, borderColor: theme.colors.danger }
          : { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder };

  return <View style={[styles.card, colors, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: SURFACE_CARD.borderRadius,
    borderWidth: SURFACE_CARD.borderWidth,
    gap: SURFACE_CARD.gap,
    padding: SURFACE_CARD.padding,
  },
});
