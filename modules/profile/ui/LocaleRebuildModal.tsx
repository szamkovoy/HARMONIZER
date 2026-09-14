/**
 * One RN Modal for the whole Profile language-switch flow (probe spinner →
 * confirm/error dialog → translating spinner). iOS drops a second Modal that is
 * presented in the same turn as another Modal dismisses — English often probes
 * faster than German, so the confirm sheet never appeared while the combo
 * already showed the optimistic label.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";

import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

import type { LocaleRebuildPhase } from "@/modules/profile/core/localeRebuild";

export function LocaleRebuildModal(props: {
  phase: LocaleRebuildPhase;
  title: string;
  message: string;
  cancelLabel: string;
  continueLabel: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const theme = useTheme();
  const visible = props.phase !== "idle";
  const busy = props.phase === "probing" || props.phase === "loading";
  const showActions = props.phase === "confirm" || props.phase === "error";
  const [actionsArmed, setActionsArmed] = useState(false);

  useEffect(() => {
    if (!visible || !showActions) {
      setActionsArmed(false);
      return;
    }
    const id = setTimeout(() => setActionsArmed(true), 320);
    return () => {
      clearTimeout(id);
      setActionsArmed(false);
    };
  }, [visible, showActions, props.phase]);

  const label = props.message.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={props.onCancel}
    >
      <View
        style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}
        pointerEvents="auto"
      >
        {busy ? (
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
            <ActivityIndicator color={theme.colors.accent} />
            {label ? (
              <AppText variant="dialogBody" tone="primary" style={styles.pillMessage}>
                {label}
              </AppText>
            ) : null}
          </View>
        ) : (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
                borderRadius: theme.radius.lg,
                padding: theme.spacing.xl,
              },
            ]}
          >
            <AppText variant="dialogTitle" tone="primary" style={styles.title}>
              {props.title}
            </AppText>
            {label ? (
              <AppText variant="dialogBody" tone="primary" style={styles.message}>
                {props.message}
              </AppText>
            ) : null}
            <View
              pointerEvents={actionsArmed ? "auto" : "none"}
              style={[styles.actionsSlot, { gap: theme.spacing.md }]}
            >
              <AppButton label={props.cancelLabel} variant="secondary" onPress={props.onCancel} />
              <AppButton label={props.continueLabel} onPress={props.onContinue} />
            </View>
          </View>
        )}
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
  pillMessage: {
    flexShrink: 1,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
  },
  title: {
    marginBottom: 8,
  },
  message: {
    marginBottom: 16,
  },
  actionsSlot: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
});
