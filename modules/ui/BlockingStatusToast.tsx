/**
 * Compact blocking toast: dimmed page + narrow pill with status text (and optional spinner).
 * Prefer this over AppDialog for short in-progress states like «Идёт перевод…».
 */
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function BlockingStatusToast({
  visible,
  message,
  showSpinner = true,
}: {
  visible: boolean;
  message: string;
  showSpinner?: boolean;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]} pointerEvents="auto">
        <View
          style={[
            styles.pill,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
              borderRadius: theme.radius.full,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.md,
              gap: theme.spacing.sm,
            },
          ]}
        >
          {showSpinner ? <ActivityIndicator color={theme.colors.accent} /> : null}
          <AppText variant="dialogBody" tone="primary" style={styles.message}>
            {message}
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "86%",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  message: {
    flexShrink: 1,
  },
});
