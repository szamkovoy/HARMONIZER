/**
 * CountdownRing: круглый таймер обратного отсчёта с анимированным кольцом-прогрессом.
 *
 * Параметры задают «начало» и «длительность» отсчёта в Unix-мс; компонент сам каждый кадр
 * считает оставшееся время и плавно двигает кольцо. Это избавляет от дискретных «рывков»
 * при обновлении `secondsLeft` из родителя раз в 200 мс.
 *
 * Кольцо замыкается ровно к моменту `startedAtMs + totalSeconds × 1000`. Цвет берётся из
 * темы (обычно это тот же `accent`, что и polоска тайминга на панели).
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

interface CountdownRingProps {
  /** Момент (Date.now-мс), когда отсчёт начался. */
  startedAtMs: number;
  /** Общая длительность отсчёта, с. */
  totalSeconds: number;
  /** Внешний диаметр. */
  size?: number;
  /** Толщина кольца. */
  strokeWidth?: number;
  /** Цвет progress-кольца. По умолчанию — accent из темы. */
  color?: string;
  /** Цвет «трека» (неактивной части). */
  trackColor?: string;
  /** Показывать число секунд в центре. */
  showCenterNumber?: boolean;
}

function arcPath(size: number, strokeWidth: number, progress: number): SkPath {
  const path = Skia.Path.Make();
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  if (progress <= 0) return path;
  if (progress >= 0.9995) {
    path.addCircle(cx, cy, radius);
    return path;
  }
  const steps = 96;
  const startAngle = -Math.PI / 2;
  const sweep = progress * 2 * Math.PI;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const a = startAngle + sweep * t;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path;
}

export function CountdownRing({
  startedAtMs,
  totalSeconds,
  size = 96,
  strokeWidth = 4,
  color,
  trackColor,
  showCenterNumber = true,
}: CountdownRingProps) {
  const theme = useTheme();
  const resolvedColor = color ?? theme.colors.accent;
  const resolvedTrackColor = trackColor ?? "rgba(255,255,255,0.1)";

  const totalMs = Math.max(1, totalSeconds * 1000);
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  const startSv = useSharedValue(startedAtMs);
  const totalMsSv = useSharedValue(totalMs);
  useEffect(() => {
    startSv.value = startedAtMs;
  }, [startedAtMs, startSv]);
  useEffect(() => {
    totalMsSv.value = totalMs;
  }, [totalMs, totalMsSv]);

  const pushFrame = (p: number, sLeft: number) => {
    setProgress((prev) => (Math.abs(prev - p) < 0.003 ? prev : p));
    setSecondsLeft((prev) => (prev === sLeft ? prev : sLeft));
  };

  useFrameCallback(() => {
    "worklet";
    const elapsed = Math.max(0, Date.now() - startSv.value);
    const p = Math.min(1, elapsed / totalMsSv.value);
    const leftMs = Math.max(0, totalMsSv.value - elapsed);
    const sLeft = Math.ceil(leftMs / 1000);
    runOnJS(pushFrame)(p, sLeft);
  });

  const trackPath = arcPath(size, strokeWidth, 1);
  const progressPath = arcPath(size, strokeWidth, progress);

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      accessibilityRole="text"
      accessibilityLabel={`${secondsLeft}`}
    >
      <Canvas style={{ width: size, height: size }}>
        <Path
          path={trackPath}
          style="stroke"
          strokeWidth={strokeWidth}
          color={resolvedTrackColor}
        />
        <Path
          path={progressPath}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          color={resolvedColor}
        />
      </Canvas>
      <View style={styles.centerText}>
        {showCenterNumber ? (
          <AppText variant="numericLarge" tone="primary">
            {secondsLeft}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
