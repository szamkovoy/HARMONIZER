/**
 * PpgMiniChart: визуальный индикатор optical-сигнала на экране активации
 * пульсометра.
 *
 * Раньше были scatter-точки — пользователю казалось «кашей». Потом
 * столбчатая диаграмма от пола с |value| и opacity 0.45 для негативных
 * столбцов — но от этого один удар визуально превращался в два столбика
 * (positive + negative полуволны вокруг baseline), что вводило в
 * заблуждение.
 *
 * Сейчас — **двусторонняя столбчатая диаграмма от центральной линии**:
 *  - если значение выше baseline (systole/пик), столбик идёт ВВЕРХ;
 *  - если ниже (diastole/ложе), столбик идёт ВНИЗ;
 *  - цвет одинаковый для обеих полярностей, высота пропорциональна
 *    |value|/amplitude.
 *
 * Так пользователь видит **реальную форму пульсовой волны** — быстрый
 * подъём + медленный спад, один столбик на один удар (или же явный шум,
 * если positive и negative полуволны одного размера).
 *
 * Реализация простая (View), чтобы не нагружать UI-тред во время активации.
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

type BarDatum = {
  /** Доля амплитуды, 0..1 (уже с учётом минимальной видимой высоты). */
  magnitude: number;
  /** true → столбик идёт ВВЕРХ от midline, false → ВНИЗ. */
  up: boolean;
};

/** Розовый pulse-цвет (как в историческом `SignalBars` из RMSSD probe). */
const BAR_COLOR = "#ff8f9f";
/** Минимальная видимая доля высоты, чтобы даже «почти нулевые» столбики читались. */
const MIN_BAR = 0.06;

export function PpgMiniChart({
  samples,
  beatTimestampsMs = [],
  height = 72,
}: PpgMiniChartProps) {
  const theme = useTheme();

  const { bars, beatMarkers } = useMemo(() => {
    if (samples.length < 4) {
      return { bars: [] as BarDatum[], beatMarkers: [] as number[] };
    }
    const optical = samples.map((sample) => computeOpticalValue(sample));
    const baseline = median(optical);
    const detrended = optical.map((value) => value - baseline);
    const amplitude = Math.max(...detrended.map((value) => Math.abs(value)), 1e-6);

    const firstTs = samples[0]!.timestampMs;
    const lastTs = samples[samples.length - 1]!.timestampMs;
    const spanMs = Math.max(1, lastTs - firstTs);

    const bars: BarDatum[] = detrended.map((value) => ({
      magnitude: Math.min(1, Math.max(MIN_BAR, Math.abs(value) / amplitude)),
      up: value >= 0,
    }));

    const beatMarkers = beatTimestampsMs
      .filter((timestampMs) => timestampMs >= firstTs && timestampMs <= lastTs)
      .map((timestampMs) => ((timestampMs - firstTs) / spanMs) * 100);

    return { bars, beatMarkers };
  }, [beatTimestampsMs, samples]);

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
      {/* midline-фон (сплошная тонкая полоса в центре) */}
      <View style={styles.midline} />

      {beatMarkers.map((leftPct, index) => (
        <View
          key={`beat-${index}`}
          style={[
            styles.beatMarker,
            { left: `${leftPct}%`, backgroundColor: `${theme.colors.accent}` },
          ]}
        />
      ))}

      {/* Верхняя половина: позитивные столбцы от центра вверх */}
      <View style={styles.halfUp}>
        {bars.map((bar, index) => (
          <View
            key={`up-${index}`}
            style={[
              styles.bar,
              bar.up
                ? {
                    height: `${bar.magnitude * 100}%`,
                    backgroundColor: BAR_COLOR,
                  }
                : styles.invisible,
            ]}
          />
        ))}
      </View>

      {/* Нижняя половина: негативные столбцы от центра вниз */}
      <View style={styles.halfDown}>
        {bars.map((bar, index) => (
          <View
            key={`dn-${index}`}
            style={[
              styles.bar,
              !bar.up
                ? {
                    height: `${bar.magnitude * 100}%`,
                    backgroundColor: BAR_COLOR,
                  }
                : styles.invisible,
            ]}
          />
        ))}
      </View>
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
    backgroundColor: "rgba(148,163,184,0.35)",
  },
  halfUp: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 4,
    height: "50%",
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  halfDown: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 4,
    height: "50%",
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 2,
  },
  bar: {
    flex: 1,
    minHeight: 1,
    borderRadius: 999,
  },
  invisible: {
    // Столбик-плейсхолдер пустой, но держит flex:1, чтобы верхняя и
    // нижняя половины были выровнены по оси X один-в-один с сэмплами.
    height: 0,
    backgroundColor: "transparent",
  },
  beatMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    opacity: 0.45,
  },
});
