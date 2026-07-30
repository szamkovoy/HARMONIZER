/**
 * AppButton: единая кнопка с вариантами `primary`/`secondary`.
 *
 * Цвет и типографика берутся из темы. Размер подстраивается под контекст — по
 * умолчанию кнопка занимает доступную ширину (как кнопки в диалогах/idle-экране).
 * Когда нужно «в ряд», оборачивайте несколько кнопок в `flexDirection: row` и задавайте
 * `flex: 1` через `style`.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type AppButtonVariant = "primary" | "secondary";

interface AppButtonProps {
  label?: string;
  children?: ReactNode;
  variant?: AppButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  /** In-flight work: not pressable, but keep full opacity so status label stays readable. */
  busy?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AppButton({
  label,
  children,
  variant = "primary",
  onPress,
  disabled,
  busy,
  accessibilityLabel,
  style,
  testID,
}: AppButtonProps) {
  const theme = useTheme();
  const isPrimary = variant === "primary";
  const inactive = Boolean(disabled || busy);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderRadius: theme.radius.md,
          backgroundColor: isPrimary ? theme.colors.buttonPrimaryBg : "transparent",
          borderWidth: isPrimary ? 0 : 1,
          borderColor: theme.colors.buttonSecondaryBorder,
          // busy: keep label readable; plain disabled: dim
          opacity: busy ? 1 : disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {children ?? (
        <AppText
          variant="buttonLabel"
          tone={isPrimary ? "accentOn" : "primary"}
          style={styles.label}
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    textAlign: "center",
  },
});
