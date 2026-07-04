/**
 * BreathOverlayControlPanel: всплывающая снизу панель управления дыхательной практикой.
 *
 * Тонкая обёртка над общим шеллом `PracticeOverlayPanel`: передаёт в его слот
 * `controls` дыхательные элементы — крестик закрытия и центральную пилюлю ритма
 * со стрелками ±. Шелл (карта, заголовок, полоса прогресса, slide-анимация,
 * тема) — общий с медитацией, поэтому визуально и поведенчески панели идентичны.
 *
 * Родитель отвечает за:
 *  - показать/скрыть (`visible`) и auto-hide по бездействию (`onInteraction`
 *    продлевает таймер на стороне родителя);
 *  - подтверждение досрочного выхода — панель только зовёт `onRequestClose()`;
 *  - применение изменений «базового числа ударов на фазу» к планировщику.
 *
 * Центральный дисплей настройки ритма параметризован как `displayMode`: одиночная
 * цифра для когерентного дыхания или кортеж через дефис для «треугольник/квадрат».
 */

import { Pressable, StyleSheet, View } from "react-native";

import { PracticeOverlayPanel } from "@/modules/ui/PracticeOverlayPanel";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/**
 * Что именно рисуется в центральной «пилюле» панели.
 *  - `single` — одна цифра (например, `5` для симметричного когерентного дыхания).
 *  - `triple` — три значения через дефис (например, `4-16-8` для треугольника).
 * Если `highlightIndex` указан и позиция соответствует «нормальному» значению —
 * эта часть числа подсвечивается акцентным цветом темы. Для рисунков без
 * оптимального ритма оставляйте `highlightIndex = null`.
 */
export type BeatsDisplayMode =
  | { type: "single"; value: number; isHighlighted: boolean }
  | { type: "triple"; values: [number, number, number]; highlightIndex: 0 | 1 | 2 | null };

export interface BreathOverlayControlPanelProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  totalMs: number;
  elapsedMs: number;
  minutesShortLabel: string;
  beatsDisplay: BeatsDisplayMode;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onRequestClose: () => void;
  onInteraction: () => void;
  accessibilityLabel?: string;
}

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
            style={[styles.beatsValue, { color: beats.highlightIndex === index ? accent : regular }]}
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

  const canDecrement = typeof onDecrement === "function";
  const canIncrement = typeof onIncrement === "function";
  const isTriple = beatsDisplay.type === "triple";
  const beatsPillRadius = isTriple ? theme.radius.md : theme.radius.pill;

  const controls = (
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
  );

  return (
    <PracticeOverlayPanel
      visible={visible}
      title={title}
      subtitle={subtitle}
      totalMs={totalMs}
      elapsedMs={elapsedMs}
      minutesShortLabel={minutesShortLabel}
      onInteraction={onInteraction}
      controls={controls}
    />
  );
}

const styles = StyleSheet.create({
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
