/**
 * Общий визуальный шаблон онбординг-мастера («WizardShell»).
 *
 * Обеспечивает визуальную преемственность всех шагов мастера:
 *  - тонкая полоска прогресса сверху (сегменты, без цифр и слов);
 *  - скроллируемое тело шага (картинка → заголовок → текст → форма);
 *  - нижний слот для кнопки «Далее» и юридической строки.
 *
 * Шаги мастера живут на двух экранах (`/sign-in` — шаг 1, `/onboarding` — шаги 2-7),
 * но благодаря единой оболочке воспринимаются как один непрерывный мастер.
 *
 * Белый фон: все экраны мастера принудительно рисуются на чисто-белом фоне (#ffffff)
 * и в светлой палитре темы — независимо от системной тёмной схемы, чтобы бесшовно
 * сочетаться с изображениями, сохранёнными на белом фоне.
 *
 * `footerInContent` (шаги 1-2, где есть ввод и выезжает клавиатура): кнопка CTA
 *   и юридическая строка помещаются ВНУТРЬ скроллируемого контента, сразу за
 *   последним полем — и поднимаются вместе с контентом ровно на высоту клавиатуры
 *   (KeyboardAvoidingView behavior="padding" на iOS, adjustResize на Android).
 *   Иначе (шаги 3-7, без ввода) footer фиксирован внизу экрана.
 *
 * Добавление/удаление шагов: меняется только `totalSteps` и содержимое шагов у
 * потребителей — шаблон шагов не знает об их смысле.
 */
import { useMemo, type ReactNode } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { StackScreenLayout } from "@/modules/ui/StackScreenLayout";
import { AppText } from "@/modules/ui/AppText";
import { ThemeProvider, buildTheme, useTheme } from "@/modules/ui/theme";

/** Фиксированная высота картинки-героя — единая для всех шагов. Подбирается под ~9:5. */
export const WIZARD_IMAGE_HEIGHT = 200;
/** Рекомендуемый размер исходной картинки-героя (для оптимизации в Photoshop). */
export const WIZARD_IMAGE_TARGET = { width: 1200, height: 600 } as const;

/** Чисто-белый фон мастера (изображения сохранены на белом фоне). */
const WIZARD_BG = "#ffffff";

export function WizardShell({
  totalSteps,
  currentStep,
  children,
  footer,
  statusBarStyle,
  contentStyle,
  footerInContent,
}: {
  totalSteps: number;
  /** 1-индекс текущего шага. Сегменты < currentStep — «пройдены», = currentStep — «активный». */
  currentStep: number;
  children: ReactNode;
  footer?: ReactNode;
  statusBarStyle?: "light" | "dark" | "auto";
  contentStyle?: StyleProp<ViewStyle>;
  /** true — footer живёт внутри скроллируемого контента (шаги 1-2 с клавиатурой);
   *  false/undefined — footer зафиксирован внизу экрана (шаги 3-7). */
  footerInContent?: boolean;
}) {
  // Мастер всегда светлый (белый фон + тёмный текст), независимо от системной схемы.
  const lightTheme = useMemo(() => buildTheme("light"), []);
  // На белом фоне статус-бар должен быть тёмным (тёмный контент на светлом фоне).
  const resolvedStatusBar: "light" | "dark" =
    statusBarStyle === "auto" ? "dark" : statusBarStyle ?? "dark";

  return (
    <ThemeProvider value={lightTheme}>
      <StackScreenLayout
        statusBarStyle={resolvedStatusBar}
        edges={["top", "bottom"]}
        style={{ backgroundColor: WIZARD_BG }}
      >
        <View style={styles.root}>
          <StepProgress
            totalSteps={totalSteps}
            currentStep={currentStep}
            style={styles.progress}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.avoid}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.scroll}
              contentContainerStyle={[styles.scrollContent, contentStyle]}
              showsVerticalScrollIndicator={false}
            >
              {children}
              {footerInContent && footer ? (
                <View style={styles.footer}>{footer}</View>
              ) : null}
            </ScrollView>
            {!footerInContent && footer ? (
              <View style={styles.footer}>{footer}</View>
            ) : null}
          </KeyboardAvoidingView>
        </View>
      </StackScreenLayout>
    </ThemeProvider>
  );
}

/** Полоска прогресса: `totalSteps` сегментов, заполняется слева направо. Без цифр. */
export function StepProgress({
  totalSteps,
  currentStep,
  style,
}: {
  totalSteps: number;
  currentStep: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.progressRow, style]}>
      {Array.from({ length: totalSteps }, (_, i) => {
        const index = i + 1;
        const done = index <= currentStep;
        return (
          <View
            key={i}
            style={[
              styles.segment,
              {
                backgroundColor: done ? theme.colors.textFaint : theme.colors.surfaceBorder,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/** Картинка-герой шага. Масштабируется через `contain` в фиксированной рамке —
 *  исходные файлы могут быть разного размера, на экране выглядят единообразно. */
export function WizardImage({
  source,
  height = WIZARD_IMAGE_HEIGHT,
  rounded = true,
}: {
  source: ImageSourcePropType;
  height?: number;
  rounded?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.imageWrap,
        { height, borderRadius: rounded ? theme.radius.lg : 0 },
      ]}
    >
      <Image
        source={source}
        style={styles.image}
        resizeMode="contain"
        accessibilityRole="image"
      />
    </View>
  );
}

export function WizardTitle({ children }: { children: ReactNode }) {
  return (
    <AppText variant="screenTitle" style={styles.title}>
      {children}
    </AppText>
  );
}

/** Абзац тела шага. Несколько абзацев — несколько `<WizardBody>`. */
export function WizardBody({ children }: { children: ReactNode }) {
  return (
    <AppText variant="screenHint" tone="muted" style={styles.body}>
      {children}
    </AppText>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 8,
    maxWidth: 460,
    width: "100%",
    alignSelf: "center",
    backgroundColor: WIZARD_BG,
  },
  avoid: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 12,
    flexGrow: 1,
  },
  progress: {
    paddingHorizontal: 0,
    paddingTop: 8,
  },
  progressRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 0,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 999,
  },
  imageWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  title: {
    textAlign: "center",
  },
  body: {
    textAlign: "center",
  },
  footer: {
    paddingTop: 4,
    paddingBottom: 4,
    gap: 12,
  },
});
