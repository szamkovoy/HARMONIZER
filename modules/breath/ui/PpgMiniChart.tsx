/**
 * PpgMiniChart: минимальный визуальный индикатор optical-сигнала.
 *
 * Это упрощённая версия прежнего «Optical Series» из RMSSD probe: только сам график
 * в тонкой рамке, без заголовка, подписей и debug-строк. Показывается на экране
 * активации пульсометра, когда палец уже закрыл объектив и идёт обратный отсчёт.
 * Цвета и радиусы берутся из центральной темы.
 */
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";
import { computeOpticalValue, median } from "@/modules/biofeedback/signal/optical-pipeline";
import { useTheme } from "@/modules/ui/theme";

interface PpgMiniChartProps {
  samples: readonly RawOpticalSample[];
  beatTimestampsMs?: readonly number[];
  /** Высота графика в px. */
  height?: number;
}

type ChartPoint = {
  leftPct: number;
  topPct: number;
};

export function PpgMiniChart({
  samples,
  beatTimestampsMs = [],
  height = 72,
}: PpgMiniChartProps) {
  const theme = useTheme();

  const chart = useMemo(() => {
    if (samples.length < 4) {
      return { points: [] as ChartPoint[], beatMarkers: [] as number[] };
    }
    const optical = samples.map((sample) => computeOpticalValue(sample));
    const baseline = median(optical);
    const detrended = optical.map((value) => value - baseline);
    const amplitude = Math.max(...detrended.map((value) => Math.abs(value)), 1e-6);
    const firstTs = samples[0]!.timestampMs;
    const lastTs = samples[samples.length - 1]!.timestampMs;
    const spanMs = Math.max(1, lastTs - firstTs);
    const points: ChartPoint[] = samples.map((sample, index) => ({
      leftPct: (index / Math.max(1, samples.length - 1)) * 100,
      topPct: 50 - (detrended[index]! / amplitude) * 42,
    }));
    const beatMarkers = beatTimestampsMs
      .filter((timestampMs) => timestampMs >= firstTs && timestampMs <= lastTs)
      .map((timestampMs) => ((timestampMs - firstTs) / spanMs) * 100);
    return { points, beatMarkers };
  }, [beatTimestampsMs, samples]);

  if (chart.points.length === 0) {
    return (
      <View
        style={[
          styles.chart,
          {
            height,
            borderRadius: theme.radius.md,
            backgroundColor: "rgba(2,6,23,0.45)",
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.chart,
        {
          height,
          borderRadius: theme.radius.md,
          backgroundColor: "rgba(2,6,23,0.45)",
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.midline} />
      {chart.beatMarkers.map((leftPct, index) => (
        <View
          key={`beat-${index}`}
          style={[
            styles.beatMarker,
            { left: `${leftPct}%`, backgroundColor: `${theme.colors.accent}` },
          ]}
        />
      ))}
      {chart.points.map((point, index) => (
        <View
          key={`pt-${index}`}
          style={[
            styles.point,
            {
              left: `${point.leftPct}%`,
              top: `${Math.max(4, Math.min(96, point.topPct))}%`,
              backgroundColor: theme.colors.textMuted,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
  },
  midline: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(148,163,184,0.25)",
  },
  beatMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    opacity: 0.45,
  },
  point: {
    position: "absolute",
    width: 3,
    height: 3,
    marginLeft: -1.5,
    marginTop: -1.5,
    borderRadius: 1.5,
  },
});
