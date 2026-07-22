/**
 * TextInput для мастера онбординга.
 *
 * Берёт цвета/рамку из `useTheme()` — должен рендериться внутри `WizardShell`
 * (`ThemeProvider` со светлой палитрой). Так поля остаются читаемыми даже когда
 * системная тема устройства тёмная (иначе родительский dark `textPrimary` даёт
 * белый текст на белом фоне мастера — типичный Android-артефакт).
 *
 * Логику клавиатуры целиком берёт на себя `WizardShell`.
 */
import { forwardRef, type ComponentProps } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";

import { useTheme } from "@/modules/ui/theme";

type TextInputProps = ComponentProps<typeof TextInput>;

export const WizardTextInput = forwardRef<TextInput, TextInputProps>(function WizardTextInput(
  { style, placeholderTextColor, underlineColorAndroid, selectionColor, ...rest },
  ref,
) {
  const theme = useTheme();

  return (
    <TextInput
      {...rest}
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? theme.colors.textFaint}
      underlineColorAndroid={underlineColorAndroid ?? "transparent"}
      selectionColor={selectionColor ?? theme.colors.accent}
      // Android: без явного цвета иногда берётся theme окна (белый на белом).
      style={[
        styles.base,
        {
          borderColor: theme.colors.surfaceBorder,
          borderRadius: theme.radius.md,
          color: theme.colors.textPrimary,
          backgroundColor: theme.colors.surfaceElevated,
        },
        Platform.OS === "android" ? styles.androidFix : null,
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    height: 52,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  androidFix: {
    // Часть OEM (Pixel и др.) иначе рисует «невидимый» текст или системный underline.
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
