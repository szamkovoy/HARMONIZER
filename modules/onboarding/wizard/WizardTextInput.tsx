/**
 * TextInput для мастера онбординга.
 *
 * Тонкая обёртка над `TextInput` с `forwardRef` — сохранена для call-сайтов.
 * Логику клавиатуры целиком берёт на себя `WizardShell` (footerInContent +
 * KeyboardAvoidingView + одноразовый scrollToEnd + scrollEnabled=false при
 * открытой клавиатуре). Здесь нет onFocus-скролла и нет measureInWindow.
 */
import { forwardRef, type ComponentProps } from "react";
import { TextInput } from "react-native";

type TextInputProps = ComponentProps<typeof TextInput>;

export const WizardTextInput = forwardRef<TextInput, TextInputProps>(function WizardTextInput(
  props,
  ref,
) {
  return <TextInput {...props} ref={ref} />;
});
