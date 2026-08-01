/**
 * AppButton: единая кнопка с вариантами `primary`/`secondary`.
 *
 * Цвет и типографика берутся из темы. Размер подстраивается под контекст — по
 * умолчанию кнопка занимает доступную ширину (как кнопки в диалогах/idle-экране).
 * Когда нужно «в ряд», оборачивайте несколько кнопок в `flexDirection: row` и задавайте
 * `flex: 1` через `style`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

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

/**
 * Always reserves three dots (no layout jump). Visible count cycles 0→1→2→3 by
 * painting “hidden” dots in the button background color so they disappear in place.
 */
function BusyLabel({
  label,
  textColor,
  hiddenDotColor,
}: {
  label: string;
  textColor: string;
  hiddenDotColor: string;
}) {
  const base = label.replace(/[.…]+$/u, "").trimEnd();
  /** 0 = none lit, 1..3 = that many dots in textColor. */
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setLit((n) => (n + 1) % 4);
    }, 420);
    return () => clearInterval(id);
  }, []);

  return (
    <View style={styles.busyRow}>
      <AppText variant="buttonLabel" style={{ color: textColor }}>
        {base}
      </AppText>
      {[0, 1, 2].map((i) => (
        <AppText
          key={i}
          variant="buttonLabel"
          style={{ color: i < lit ? textColor : hiddenDotColor }}
        >
          .
        </AppText>
      ))}
    </View>
  );
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
  const buttonBg = isPrimary ? theme.colors.buttonPrimaryBg : theme.colors.screenBg;
  const labelColor = isPrimary ? theme.colors.buttonPrimaryFg : theme.colors.buttonSecondaryFg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(busy) }}
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
      {children ??
        (busy && label ? (
          <BusyLabel label={label} textColor={labelColor} hiddenDotColor={buttonBg} />
        ) : (
          <AppText
            variant="buttonLabel"
            tone={isPrimary ? "accentOn" : "primary"}
            style={styles.label}
          >
            {label}
          </AppText>
        ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    textAlign: "center",
  },
});
