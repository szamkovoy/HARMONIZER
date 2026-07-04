/**
 * PracticeOverlayPanel: общая всплывающая снизу панель управления практикой.
 *
 * Шелл-компонент, разделяемый дыхательной практикой (`BreathOverlayControlPanel`)
 * и медитацией (`SacredSymbolStreamScreen`). Один код → одинаковый внешний вид
 * и поведение (slide-up/down, карта, заголовок, полоса прогресса, тайминги).
 *
 * Владеет:
 *  - анимацией въезда/отъезда (Reanimated `withTiming`,
 *    `PANEL_HIDDEN_TRANSLATE_Y`, `SLIDE_DURATION_MS`);
 *  - карточкой (theme `surface` / `surfaceBorder` / `radius.lg`);
 *  - центральным блоком заголовка (title + опц. subtitle);
 *  - строкой времени (totalLabel слева, `-m:ss` справа);
 *  - полосой прогресса 4px (theme `controlButtonBg` / `accent`);
 *  - слотом `controls` — что рисуется под полосой (X + пилюля ритма для дыхания,
 *    кнопка «Завершить» для медитации).
 *
 * Таймер авто-скрытия — на стороне родителя через общий хук
 * `useImmersiveOverlayAutohide`; `onInteraction` продлевает таймер.
 */

import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "@/modules/ui/AppText";
import { defaultTheme } from "@/modules/ui/theme";

export interface PracticeOverlayPanelProps {
  /** true — панель въезжает снизу; false — уезжает вниз и не ловит нажатия. */
  visible: boolean;
  /** Название практики (жирный, первая строка). */
  title: string;
  /** Подзаголовок (опц., тонким шрифтом). */
  subtitle?: string;
  /** Полная длительность практики, мс. */
  totalMs: number;
  /** Сколько мс уже прошло от старта. */
  elapsedMs: number;
  /** Суффикс единицы длительности («минут»/«min»). */
  minutesShortLabel: string;
  /** Контент под полосой прогресса (кнопки/контролы конкретной практики). */
  controls: ReactNode;
  /** Любое касание по панели — колбэк продлевает таймер авто-скрытия у родителя. */
  onInteraction: () => void;
}

export const PANEL_HIDDEN_TRANSLATE_Y = 260;
export const PANEL_SLIDE_DURATION_MS = 320;
/**
 * Полупрозрачная заливка карточки панели. Раньше бралась из `theme.colors.surface`
 * (`rgba(30,32,38,0.92)` — почти непрозрачная). На медитации за панелью чёрный
 * canvas + тёмная мандала, поэтому 0.92 читалась как глухо-чёрная. Снижаем alpha
 * до 0.72 — и дыхательная, и медитативная панели одинаково полупрозрачны: сквозь
 * них мягко просвечивает фон (footer-дебаг у дыхания, мандала у медитации).
 */
const PANEL_CARD_BACKGROUND = "rgba(20, 22, 28, 0.72)";

function formatRemaining(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `-${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PracticeOverlayPanel(props: PracticeOverlayPanelProps) {
  const {
    visible,
    title,
    subtitle,
    totalMs,
    elapsedMs,
    minutesShortLabel,
    controls,
    onInteraction,
  } = props;

  // Базовая панель практики всегда тёмная (иммерсивный оверлей поверх чёрного
  // полотна), независимо от системной цветовой схемы / ThemeProvider выше. Иначе
  // на телефоне в light-режиме панель медитации становилась светлой, а дыхательная
  // нет (она оборачивается в <ThemeProvider value={defaultTheme}> на уровне экрана).
  // Используем defaultTheme напрямую, чтобы базовый элемент был самодостаточен.
  const theme = defaultTheme;

  const translateY = useSharedValue(PANEL_HIDDEN_TRANSLATE_Y);

  useEffect(() => {
    // Плавнее, чем кубик 220мс: длиннее (320мс) и мягче кривая (ease-out/in-quint).
    // До этого въезд/отъезд ощущались «жёстко» на медитации.
    translateY.value = withTiming(visible ? 0 : PANEL_HIDDEN_TRANSLATE_Y, {
      duration: PANEL_SLIDE_DURATION_MS,
      easing: visible
        ? Easing.bezier(0.22, 1, 0.36, 1)
        : Easing.bezier(0.5, 0, 0.75, 0),
    });
  }, [visible, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity:
      translateY.value < PANEL_HIDDEN_TRANSLATE_Y
        ? 1
        : Math.max(0, 1 - translateY.value / PANEL_HIDDEN_TRANSLATE_Y),
  }));

  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const remainingLabel = formatRemaining(remainingMs);
  const totalMinutes = Math.max(1, Math.round(totalMs / 60_000));
  const totalLabel = `${totalMinutes} ${minutesShortLabel}`;
  const progress = Math.min(1, Math.max(0, elapsedMs / Math.max(1, totalMs)));

  return (
    <Animated.View
      pointerEvents={visible ? "box-none" : "none"}
      style={[styles.wrap, animatedStyle]}
    >
      <SafeAreaView edges={["bottom"]} style={styles.safe}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: PANEL_CARD_BACKGROUND,
              borderRadius: theme.radius.lg,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
          onPress={onInteraction}
        >
          <View style={styles.titleBlock}>
            <AppText
              variant="sectionTitle"
              tone="primary"
              style={styles.title}
              numberOfLines={1}
            >
              {title}
            </AppText>
            {subtitle ? (
              <AppText
                variant="statPillLabel"
                tone="muted"
                style={styles.subtitle}
                numberOfLines={1}
              >
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <View style={styles.timeRow}>
            <AppText variant="statPillLabel" tone="muted">
              {totalLabel}
            </AppText>
            <AppText variant="statPillLabel" tone="muted">
              {remainingLabel}
            </AppText>
          </View>
          <View
            style={[styles.progressTrack, { backgroundColor: theme.colors.controlButtonBg }]}
          >
            <View
              style={{
                height: "100%",
                width: `${progress * 100}%`,
                backgroundColor: theme.colors.accent,
                borderRadius: 2,
              }}
            />
          </View>
          {controls}
        </Pressable>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    zIndex: 40,
  },
  safe: {
    width: "100%",
  },
  card: {
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  titleBlock: {
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    marginTop: 2,
    fontWeight: "400",
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 14,
  },
});
