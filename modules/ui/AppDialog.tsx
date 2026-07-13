/**
 * AppDialog: общий модальный диалог системы.
 *
 * Используется для подтверждений и информационных окон. Всегда рисуется поверх экрана
 * (RN Modal) с затемняющим backdrop по центру viewport — не зависит от ScrollView.
 * Цвета/радиусы/типографика — из темы. Кнопки принимает слотом `actions`.
 */
import type { ReactNode } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /**
   * Слот с кнопками. Раскладка определяется `actionsLayout`:
   *  - `row` (по умолчанию) — кнопки в ряд, центрированные, intrinsic-ширина;
   *  - `column` — кнопки одна под другой, каждая на всю ширину диалога.
   */
  actions: ReactNode;
  actionsLayout?: "row" | "column";
  /** Android back / system dismiss while visible. */
  onRequestClose?: () => void;
}

export function AppDialog({
  visible,
  title,
  message,
  actions,
  actionsLayout = "row",
  onRequestClose,
}: AppDialogProps) {
  const theme = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onRequestClose}
    >
      <View
        style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}
        pointerEvents="auto"
      >
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
            {title}
          </AppText>
          {message ? (
            <AppText variant="dialogBody" tone="primary" style={styles.message}>
              {message}
            </AppText>
          ) : null}
          <View
            style={[
              styles.actionsSlot,
              actionsLayout === "row" ? styles.actionsRow : styles.actionsColumn,
              { gap: theme.spacing.md },
            ]}
          >
            {actions}
          </View>
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
  /** Keep confirm ↔ loading height stable so the card does not jump. */
  actionsSlot: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  actionsColumn: {
    flexDirection: "column",
    alignItems: "stretch",
  },
});
