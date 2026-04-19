import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";
import { computeOpticalValue, median } from "@/modules/biofeedback/signal/optical-pipeline";

type Props = {
  title: string;
  samples: readonly RawOpticalSample[];
  beatTimestampsMs?: readonly number[];
  footer?: ReactNode;
  emptyText: string;
};

type ChartPoint = {
  leftPct: number;
  topPct: number;
};

export function PpgOpticalPreview({
  title,
  samples,
  beatTimestampsMs = [],
  footer,
  emptyText,
}: Props) {
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
    const points = samples.map((sample, index) => ({
      leftPct: (index / Math.max(1, samples.length - 1)) * 100,
      topPct: 50 - (detrended[index]! / amplitude) * 42,
    }));
    const beatMarkers = beatTimestampsMs
      .filter((timestampMs) => timestampMs >= firstTs && timestampMs <= lastTs)
      .map((timestampMs) => ((timestampMs - firstTs) / spanMs) * 100);
    return { points, beatMarkers };
  }, [beatTimestampsMs, samples]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {chart.points.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : (
        <View style={styles.chart}>
          <View style={styles.midline} />
          {chart.beatMarkers.map((leftPct, index) => (
            <View
              key={`beat-${index}`}
              style={[styles.beatMarker, { left: `${leftPct}%` }]}
            />
          ))}
          {chart.points.map((point, index) => (
            <View
              key={`pt-${index}`}
              style={[
                styles.point,
                { left: `${point.leftPct}%`, top: `${Math.max(4, Math.min(96, point.topPct))}%` },
              ]}
            />
          ))}
        </View>
      )}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.55)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  title: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 16,
  },
  chart: {
    position: "relative",
    height: 72,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "rgba(2,6,23,0.65)",
    borderWidth: 1,
    borderColor: "rgba(71,85,105,0.4)",
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
    backgroundColor: "rgba(34,197,94,0.35)",
  },
  point: {
    position: "absolute",
    width: 3,
    height: 3,
    marginLeft: -1.5,
    marginTop: -1.5,
    borderRadius: 1.5,
    backgroundColor: "#38bdf8",
  },
});
