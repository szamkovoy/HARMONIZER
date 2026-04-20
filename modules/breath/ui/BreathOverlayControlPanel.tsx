/**
 * BreathOverlayControlPanel: всплывающая снизу панель управления дыхательной практикой.
 *
 * Слой задуман независимым: визуально сидит над «чёрным полотном» (мандала + индикатор
 * + debug-футер) и не знает ничего про сам дыхательный ритм. Родитель отвечает за:
 *  - показать/скрыть (`visible`) и auto-hide по бездействию (`onInteraction` дёргает
 *    таймер на стороне родителя);
 *  - подтверждение досрочного выхода — панель только зовёт `onRequestClose()`, сам диалог
 *    рендерится родителем;
 *  - применение изменений «базового числа ударов на фазу» к планировщику.
 *
 * Внешний вид — из центральной темы (`@/modules/ui/theme`). Никаких захардкоженных цветов/
 * размеров внутри: редизайн меняется в одном месте. Центральный дисплей настройки ритма
 * параметризован как `displayMode`: одиночная цифра для когерентного дыхания или
 * кортеж через дефис для рисунков «треугольник/квадрат» (например, `4-16-8`).
 */

import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/**
 * Что именно рисуется в центральной «пилюле» панели.
 *  - `single` — одна цифра (например, `5` для симметричного когерентного дыхания).
 *  - `triple` — три значения через дефис (например, `4-16-8` для треугольника).
 * Если `highlightIndex` указан и позиция соответствует «нормальному» значению —
 * эта часть числа подсвечивается акцентным цветом темы (в остальных случаях цвет
 * обычный). Для рисунков без оптимального ритма оставляйте `highlightIndex = null`.
 */
export type BeatsDisplayMode =
  | { type: "single"; value: number; isHighlighted: boolean }
  | { type: "triple"; values: [number, number, number]; highlightIndex: 0 | 1 | 2 | null };

export interface BreathOverlayControlPanelProps {
  /** true — панель въезжает снизу; false — уезжает вниз и не ловит нажатия. */
  visible: boolean;
  /** Название дыхательного упражнения (жирный, первая строка). */
  title: string;
  /** Подзаголовок (санскрит) — опционально, тонким шрифтом. */
  subtitle?: string;
  /** Полная длительность практики, мс. */
  totalMs: number;
  /** Сколько мс уже прошло от старта. */
  elapsedMs: number;
  /** Суффикс единицы длительности («минут»/«min»). */
  minutesShortLabel: string;
  /** Что рисуется в центральной пилюле с ритмом. */
  beatsDisplay: BeatsDisplayMode;
  /** Стрелка «вправо» — увеличение; кнопка дизейблится, если колбэк опущен. */
  onIncrement?: () => void;
  /** Стрелка «влево» — уменьшение; аналогично. */
  onDecrement?: () => void;
  /** Нажатие по крестику — показать диалог подтверждения завершения. */
  onRequestClose: () => void;
  /**
   * Любое касание по панели (или по её элементам) — зовёт этот колбэк, чтобы родитель
   * мог продлить таймер авто-скрытия.
   */
  onInteraction: () => void;
  /** Accessibility-подсказка для центрального счётчика. */
  accessibilityLabel?: string;
}

const PANEL_HIDDEN_TRANSLATE_Y = 260;
const SLIDE_DURATION_MS = 220;

function formatRemaining(remainingMs: number): string {
  const clamped = Math.max(0, remainingMs);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `-${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Рендерит содержимое центральной пилюли. Нормальные части — обычным цветом,
 * выделенная — акцентом темы.
 */
function BeatsDisplay({
  beats,
  accent,
  regular,
}: {
  beats: BeatsDisplayMode;
  accent: string;
  regular: string;
}) {
  if (beats.type === "single") {
    return (
      <AppText
        variant="sectionTitle"
        tone="primary"
        style={[styles.beatsValue, { color: beats.isHighlighted ? accent : regular }]}
      >
        {beats.value}
      </AppText>
    );
  }
  // triple
  const dash = (
    <AppText
      variant="sectionTitle"
      tone="primary"
      style={[styles.beatsValue, { color: regular }]}
    >
      -
    </AppText>
  );
  return (
    <View style={styles.tripleRow}>
      {beats.values.map((value, index) => (
        <View key={index} style={styles.tripleRow}>
          {index > 0 ? dash : null}
          <AppText
            variant="sectionTitle"
            tone="primary"
            style={[
              styles.beatsValue,
              { color: beats.highlightIndex === index ? accent : regular },
            ]}
          >
            {value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function BreathOverlayControlPanel(props: BreathOverlayControlPanelProps) {
  const {
    visible,
    title,
    subtitle,
    totalMs,
    elapsedMs,
    minutesShortLabel,
    beatsDisplay,
    onIncrement,
    onDecrement,
    onRequestClose,
    onInteraction,
    accessibilityLabel,
  } = props;

  const theme = useTheme();

  const translateY = useSharedValue(PANEL_HIDDEN_TRANSLATE_Y);

  useEffect(() => {
    translateY.value = withTiming(visible ? 0 : PANEL_HIDDEN_TRANSLATE_Y, {
      duration: SLIDE_DURATION_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
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

  const canDecrement = typeof onDecrement === "function";
  const canIncrement = typeof onIncrement === "function";
  const isTriple = beatsDisplay.type === "triple";
  // Для триплета радиус слегка прямоугольнее — «сильно скруглённый прямоугольник» (ТЗ).
  const beatsPillRadius = isTriple ? theme.radius.md : theme.radius.pill;

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
              backgroundColor: theme.colors.surface,
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
            style={[
              styles.progressTrack,
              { backgroundColor: theme.colors.controlButtonBg },
            ]}
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
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onInteraction();
                onRequestClose();
              }}
              style={({ pressed }) => [
                styles.iconBtn,
                styles.closeBtnNudge,
                {
                  backgroundColor: pressed
                    ? theme.colors.controlButtonPressedBg
                    : theme.colors.controlButtonBg,
                  borderRadius: theme.radius.pill,
                },
              ]}
              hitSlop={12}
            >
              <AppText variant="sectionTitle" tone="primary" style={styles.iconClose}>
                ✕
              </AppText>
            </Pressable>
            <View style={styles.beatsGroup} accessibilityLabel={accessibilityLabel}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onInteraction();
                  if (canDecrement) onDecrement!();
                }}
                disabled={!canDecrement}
                style={({ pressed }) => [
                  styles.chevBtn,
                  pressed && { backgroundColor: theme.colors.controlButtonBg },
                  !canDecrement && styles.chevDisabled,
                ]}
                hitSlop={10}
              >
                <AppText variant="sectionTitle" tone="primary" style={styles.chev}>
                  ‹
                </AppText>
              </Pressable>
              <View
                style={[
                  styles.beatsPill,
                  {
                    backgroundColor: theme.colors.controlButtonBg,
                    borderRadius: beatsPillRadius,
                    paddingHorizontal: isTriple ? 14 : 16,
                  },
                ]}
                accessibilityLiveRegion="polite"
              >
                <BeatsDisplay
                  beats={beatsDisplay}
                  accent={theme.colors.accent}
                  regular={theme.colors.textPrimary}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onInteraction();
                  if (canIncrement) onIncrement!();
                }}
                disabled={!canIncrement}
                style={({ pressed }) => [
                  styles.chevBtn,
                  pressed && { backgroundColor: theme.colors.controlButtonBg },
                  !canIncrement && styles.chevDisabled,
                ]}
                hitSlop={10}
              >
                <AppText variant="sectionTitle" tone="primary" style={styles.chev}>
                  ›
                </AppText>
              </Pressable>
            </View>
          </View>
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
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  /** Сдвигаем крестик на 1–2 мм вправо от левого края карточки. */
  closeBtnNudge: {
    marginLeft: 6,
  },
  iconClose: {
    fontSize: 14,
    lineHeight: 16,
  },
  beatsGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  chevBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
  },
  chevDisabled: {
    opacity: 0.35,
  },
  chev: {
    fontSize: 22,
    lineHeight: 24,
  },
  beatsPill: {
    minWidth: 44,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  beatsValue: {
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  tripleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
});
