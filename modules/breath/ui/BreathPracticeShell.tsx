import { type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

export interface BreathPracticeShellProps {
  /** Центральный контент (инструкция / мандала). */
  center: ReactNode;
  underlay?: ReactNode;
  dimOpacity?: number;
  /** Идёт ли отсчёт фаз дыхания (после старта практики). */
  isBreathTimingActive: boolean;
  /** Метка времени старта практики (Date.now()); полоска считается от неё. */
  breathSessionStartMs: number | null;
  inhaleMs: number;
  exhaleMs: number;
  /** Нижняя полоса (например optical-сигнал как в пробе ППГ). */
  footer?: ReactNode;
}

function BreathPhaseRail({ progress }: { progress: SharedValue<number> }) {
  const animatedFillStyle = useAnimatedStyle(() => ({
    height: `${Math.min(1, Math.max(0, progress.value)) * 100}%`,
  }));

  return (
    <View style={styles.railOuter} accessibilityLabel="Breath rhythm indicator">
      <View style={styles.railTrack}>
        <Animated.View style={[styles.railFill, animatedFillStyle]} />
      </View>
    </View>
  );
}

/**
 * Оболочка практики: тёмный фон, центр, справа индикатор фазы.
 * Прогресс полоски обновляется на UI-потоке (useFrameCallback), без лишних setState в родителе — меньше дёрганья и конфликтов с Skia.
 */
export function BreathPracticeShell({
  center,
  underlay,
  dimOpacity = 0,
  isBreathTimingActive,
  breathSessionStartMs,
  inhaleMs,
  exhaleMs,
  footer,
}: BreathPracticeShellProps) {
  const progressSV = useSharedValue(0);
  const runSV = useSharedValue(0);
  const startSV = useSharedValue(0);
  const inhaleSV = useSharedValue(inhaleMs);
  const exhaleSV = useSharedValue(exhaleMs);

  useEffect(() => {
    inhaleSV.value = inhaleMs;
    exhaleSV.value = exhaleMs;
  }, [inhaleMs, exhaleMs, inhaleSV, exhaleSV]);

  useEffect(() => {
    if (isBreathTimingActive && breathSessionStartMs != null) {
      startSV.value = breathSessionStartMs;
      runSV.value = 1;
    } else {
      runSV.value = 0;
      progressSV.value = 0;
    }
  }, [isBreathTimingActive, breathSessionStartMs, runSV, startSV, progressSV]);

  useFrameCallback(() => {
    "worklet";
    if (runSV.value < 0.5) {
      return;
    }
    const e = Date.now() - startSV.value;
    const inh = inhaleSV.value;
    const exh = exhaleSV.value;
    const cycle = inh + exh;
    if (cycle <= 0) {
      return;
    }
    const t = e % cycle;
    if (t < inh) {
      progressSV.value = t / inh;
    } else {
      progressSV.value = 1 - (t - inh) / exh;
    }
  });

  return (
    <View style={styles.root}>
      {underlay}
      <View style={styles.centerWrap} pointerEvents="box-none">
        {center}
      </View>
      {footer ? (
        <View style={styles.footer} pointerEvents="box-none">
          {footer}
        </View>
      ) : null}
      <BreathPhaseRail progress={progressSV} />
      <View style={[styles.dim, { opacity: dimOpacity }]} pointerEvents="none" />
    </View>
  );
}

/** Для подписей «вдох/выдох» по грубому таймеру (без 60 Гц setState). */
export function useBreathPhaseLabel(
  elapsedMs: number,
  inhaleMs: number,
  exhaleMs: number,
): { isInhale: boolean } {
  const cycle = inhaleMs + exhaleMs;
  if (cycle <= 0) {
    return { isInhale: true };
  }
  const t = elapsedMs % cycle;
  return { isInhale: t < inhaleMs };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#07080c",
  },
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingRight: 56,
    paddingBottom: 140,
  },
  footer: {
    position: "absolute",
    left: 12,
    right: 56,
    bottom: 20,
    zIndex: 4,
  },
  railOuter: {
    position: "absolute",
    right: 18,
    top: 120,
    bottom: 120,
    width: 14,
    justifyContent: "center",
  },
  railTrack: {
    flex: 1,
    width: 14,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  railFill: {
    width: "100%",
    backgroundColor: "rgba(186, 230, 200, 0.85)",
    borderRadius: 7,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
});
