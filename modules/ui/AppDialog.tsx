/**
 * AppDialog: общий модальный диалог системы.
 *
 * Используется для подтверждений и информационных окон. Всегда рисуется поверх экрана
 * с затемняющим backdrop, цвета/радиусы/типографика — из темы. Кнопки принимает слотом
 * `actions`, чтобы не диктовать порядок/раскладку; стандартный случай — две кнопки в ряд.
 */
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  /**
   * Слот с кнопками. Раскладка определяется `actionsLayout`:
   *  - `row` (по умолчанию) — кнопки в ряд, каждая `flex: 1`;
   *  - `column` — кнопки одна под другой, каждая на всю ширину диалога.
   */
  actions: ReactNode;
  actionsLayout?: "row" | "column";
}

export function AppDialog({
  visible,
  title,
  message,
  actions,
  actionsLayout = "row",
}: AppDialogProps) {
  const theme = useTheme();
  if (!visible) return null;
  return (
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
            actionsLayout === "row" ? styles.actionsRow : styles.actionsColumn,
            { gap: theme.spacing.md },
          ]}
        >
          {actions}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 100,
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
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  actionsColumn: {
    flexDirection: "column",
    alignItems: "stretch",
  },
});
