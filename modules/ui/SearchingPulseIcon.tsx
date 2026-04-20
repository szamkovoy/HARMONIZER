/**
 * SearchingPulseIcon: визуальный аналог «ищем сигнал» — пульсирующий круг с точкой.
 *
 * Показывается на экране «Активация пульсометра» в момент, когда палец ещё не
 * закрыл нужный объектив. Как только контакт найден, компонент заменяется на
 * `CountdownRing` — поэтому рендер может быть статичным/минимальным.
 */
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useTheme } from "@/modules/ui/theme";

interface SearchingPulseIconProps {
  /** Диаметр пиктограммы (px). Совпадает с диаметром CountdownRing, чтобы переход был плавным. */
  size?: number;
  /** Цвет акцентных элементов. По умолчанию — accent из темы. */
  color?: string;
}

export function SearchingPulseIcon({ size = 96, color }: SearchingPulseIconProps) {
  const theme = useTheme();
  const resolved = color ?? theme.colors.accent;

  const pulseSv = useSharedValue(0);
  useEffect(() => {
    pulseSv.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulseSv]);

  const outerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.85 + pulseSv.value * 0.2 }],
    opacity: 0.25 + (1 - pulseSv.value) * 0.35,
  }));
  const middleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + pulseSv.value * 0.15 }],
    opacity: 0.45 + (1 - pulseSv.value) * 0.25,
  }));

  const outerSize = size;
  const middleSize = size * 0.7;
  const dotSize = size * 0.18;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Animated.View
        style={[
          styles.ring,
          {
            width: outerSize,
            height: outerSize,
            borderRadius: outerSize / 2,
            borderColor: resolved,
          },
          outerStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {
            width: middleSize,
            height: middleSize,
            borderRadius: middleSize / 2,
            borderColor: resolved,
          },
          middleStyle,
        ]}
      />
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: resolved,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    borderWidth: 2,
  },
});
