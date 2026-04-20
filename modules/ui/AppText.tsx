/**
 * AppText: обёртка над `Text`, берущая шрифт / цвет / размер из темы по варианту.
 *
 * Любой UI-текст должен рендериться через `AppText`, чтобы смена темы или языка
 * не требовала точечных правок стилей. Прямая передача `style={{ color, fontSize }}`
 * допустима только для позиционных корректировок (gap, margin), но не для внешнего
 * вида текста.
 */
import type { ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import {
  type TypographyTokens,
  textStyleFromToken,
  useTheme,
} from "@/modules/ui/theme";

export type AppTextVariant = keyof TypographyTokens;

export type AppTextTone =
  | "primary"
  | "muted"
  | "faint"
  | "warning"
  | "danger"
  | "accent"
  | "accentOn";

interface AppTextProps {
  children?: ReactNode;
  variant?: AppTextVariant;
  tone?: AppTextTone;
  /** Доп. стили для позиции/отступов. Цвет и размер через вариант/тон. */
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: "text" | "header";
  allowFontScaling?: boolean;
}

export function AppText({
  children,
  variant = "dialogBody",
  tone = "primary",
  style,
  numberOfLines,
  accessibilityRole,
  allowFontScaling = true,
}: AppTextProps) {
  const theme = useTheme();
  const colorMap: Record<AppTextTone, string> = {
    primary: theme.colors.textPrimary,
    muted: theme.colors.textMuted,
    faint: theme.colors.textFaint,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    accent: theme.colors.accent,
    accentOn: theme.colors.accentOnText,
  };
  const token = theme.typography[variant];
  const baseStyle = textStyleFromToken(token, colorMap[tone]);
  return (
    <Text
      style={[baseStyle, style]}
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      allowFontScaling={allowFontScaling}
    >
      {children}
    </Text>
  );
}
