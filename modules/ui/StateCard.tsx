import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

type StateCardTone = "default" | "warning" | "danger";

export function StateCard({
  title,
  message,
  tone = "default",
  loading = false,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
  style,
}: {
  title?: string;
  message?: string;
  tone?: StateCardTone;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const titleTone = tone === "warning" ? "warning" : tone === "danger" ? "danger" : "primary";

  return (
    <SurfaceCardView tone={tone} style={[styles.card, style]}>
      {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
      {title ? (
        <AppText variant="sectionTitle" tone={titleTone} style={styles.centerText}>
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText variant="screenHint" tone="muted" style={styles.centerText}>
          {message}
        </AppText>
      ) : null}
      {children}
      {actionLabel && onAction ? <AppButton label={actionLabel} variant="secondary" onPress={onAction} /> : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <AppButton label={secondaryActionLabel} variant="secondary" onPress={onSecondaryAction} />
      ) : null}
    </SurfaceCardView>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
  },
  centerText: {
    textAlign: "center",
  },
});
