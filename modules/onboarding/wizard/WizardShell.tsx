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
 * КЛАВИАТУРА — два режима, не пересекаются:
 *
 *  A) `footerInContent` (welcome шаг 1, шаг 2 — формы с полями):
 *     CTA (+ legal) внутри скролла под полями. При открытии клавиатуры:
 *       1) iOS — `KeyboardAvoidingView behavior="padding"`; Android — `adjustResize`;
 *       2) один раз `scrollToEnd({ animated: false })`;
 *       3) `scrollEnabled={false}` пока клавиатура открыта (нет jitter при смене фокуса).
 *
 *  B) без `footerInContent` (OTP-confirm, шаги 3–7):
 *     контент НЕ поднимается автоматически; клавиатура перекрывает низ.
 *     ScrollView свободно скроллится пальцем. KAV behavior выключен.
 *     На OTP это важно: клавиатура уже открыта с прошлого подшага, и авто-подъём
 *     обрезал бы картинку сверху.
 *
 * Добавление/удаление шагов: меняется только `totalSteps` и содержимое шагов у
 * потребителей — шаблон шагов не знает об их смысле.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  /**
   * true — режим A: footer внутри скролла, страница поднимается с клавиатурой
   *        (welcome шаг 1, шаг 2).
   * false/undefined — режим B: без авто-подъёма; OTP-confirm и шаги 3–7
   *        (у 3–7 footer зафиксирован внизу, у OTP кнопок в footer нет).
   */
  footerInContent?: boolean;
}) {
  // Мастер всегда светлый (белый фон + тёмный текст), независимо от системной схемы.
  const lightTheme = useMemo(() => buildTheme("light"), []);
  // На белом фоне статус-бар должен быть тёмным (тёмный контент на светлом фоне).
  const resolvedStatusBar: "light" | "dark" =
    statusBarStyle === "auto" ? "dark" : statusBarStyle ?? "dark";

  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  /** Режим A: клавиатура открыта — страница зафиксирована. */
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const keyboardOpenRef = useRef(false);

  useEffect(() => {
    // Режим B (OTP / intro): сбросить состояние подъёма и не слушать клавиатуру.
    if (!footerInContent) {
      keyboardOpenRef.current = false;
      setKeyboardOpen(false);
      return;
    }

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = () => {
      // Только при первом открытии: один мгновенный скролл к кнопке.
      // При переключении полей клавиатура уже открыта — ничего не делаем.
      if (keyboardOpenRef.current) return;
      keyboardOpenRef.current = true;
      setKeyboardOpen(true);
      // rAF: дождаться, пока KeyboardAvoidingView / adjustResize применит inset,
      // затем мгновенно поставить контент (без второй анимированной стадии).
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      });
    };

    const onHide = () => {
      keyboardOpenRef.current = false;
      setKeyboardOpen(false);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [footerInContent]);

  // Нижний safe-area: в режиме A при открытой клавиатуре его даёт inset клавиатуры.
  const rootPaddingBottom =
    footerInContent && keyboardOpen ? 8 : Math.max(insets.bottom, 12);

  return (
    <ThemeProvider value={lightTheme}>
      <StackScreenLayout
        statusBarStyle={resolvedStatusBar}
        edges={["top"]}
        style={{ backgroundColor: WIZARD_BG }}
      >
        <KeyboardAvoidingView
          style={[styles.root, { paddingBottom: rootPaddingBottom }]}
          // Подъём только в режиме A. На OTP/intro behavior выключен — контент
          // остаётся на месте, клавиатура перекрывает низ, скролл ручной.
          behavior={Platform.OS === "ios" && footerInContent ? "padding" : undefined}
        >
          <StepProgress
            totalSteps={totalSteps}
            currentStep={currentStep}
            style={styles.progress}
          />
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              // В режиме формы (A) не растягиваем контент на всю высоту —
              // иначе между полями и CTA появляется пустой «резиновый» зазор.
              !footerInContent ? styles.scrollContentGrow : null,
              contentStyle,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Режим A + клавиатура: фиксируем offset. Режим B: всегда можно скроллить.
            scrollEnabled={!footerInContent || !keyboardOpen}
            automaticallyAdjustKeyboardInsets={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
          >
            {children}
            {footerInContent && footer ? <View style={styles.footer}>{footer}</View> : null}
          </ScrollView>
          {!footerInContent && footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
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
    maxWidth: 460,
    width: "100%",
    alignSelf: "center",
    backgroundColor: WIZARD_BG,
  },
  scroll: {
    flex: 1,
    backgroundColor: WIZARD_BG,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 12,
  },
  scrollContentGrow: {
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
    paddingTop: 12,
    paddingBottom: 4,
    gap: 12,
  },
});
