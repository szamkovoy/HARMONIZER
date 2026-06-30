import type { CoherencePulseLogEntry } from "@/modules/breath/core/coherence-session-analysis";
import { BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS } from "@/modules/breath/core/breath-session-signal-policy";

export type BreathResultsSeriesPoint = {
  tMs: number;
  value: number;
};

/** Fresh RR required for Polar/fullMetrics to count as a live chest-strap measurement. */
export const WEARABLE_LIVE_RR_FRESH_MS = 3_500;

/** RSA cycle amplitudes above this are treated as off-body / synthetic artifacts. */
export const RSA_RESULTS_OUTLIER_BPM = 20;

const NON_LIVE_WEARABLE_STATES = new Set(["signalLost", "disconnected", "failed", "reconnecting"]);

export function isPulseLogEntryLiveForMeasurement(entry: CoherencePulseLogEntry): boolean {
  if (entry.emulatedActive) return false;
  const wearableLike =
    entry.pulseSource === "wearable" || entry.wearableState != null;
  if (wearableLike) {
    if (entry.wearableSensorContactDetected === false) return false;
    if (entry.wearableState != null && NON_LIVE_WEARABLE_STATES.has(entry.wearableState)) {
      return false;
    }
    if (entry.wearableCapabilityTier === "fullMetrics") {
      const rrAgeMs = entry.wearableLastRrAgeMs;
      if (rrAgeMs == null || rrAgeMs > WEARABLE_LIVE_RR_FRESH_MS) return false;
    }
    const measured =
      entry.measuredPulseRateBpm
      ?? entry.wearableHeartRateBpm
      ?? entry.pulseRateBpm
      ?? 0;
    return entry.pulseReady && measured > 0;
  }
  const beatAgeMs = entry.lastBeatAgeMs;
  if (beatAgeMs != null && beatAgeMs > BREATH_CAMERA_LIVE_BEAT_MAX_AGE_MS) {
    return false;
  }
  const measured = entry.measuredPulseRateBpm ?? entry.pulseRateBpm ?? 0;
  return entry.pulseReady && measured > 0;
}

export type NonLiveInterval = {
  startMs: number;
  endMs: number;
};

export function collectNonLiveIntervalsFromLog(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): NonLiveInterval[] {
  const intervals: NonLiveInterval[] = [];
  let openStart: number | null = null;
  for (const entry of entries) {
    const tMs = Math.max(0, entry.wallClockMs - sessionStartWallMs);
    const live = isPulseLogEntryLiveForMeasurement(entry);
    if (!live) {
      if (openStart == null) openStart = tMs;
    } else if (openStart != null) {
      intervals.push({ startMs: openStart, endMs: tMs });
      openStart = null;
    }
  }
  if (openStart != null && entries.length > 0) {
    const lastT = Math.max(
      0,
      entries[entries.length - 1]!.wallClockMs - sessionStartWallMs,
    );
    intervals.push({ startMs: openStart, endMs: lastT });
  }
  return intervals;
}

function rawMeasuredValue(entry: CoherencePulseLogEntry): number {
  const wearableLike =
    entry.pulseSource === "wearable" || entry.wearableState != null;
  if (entry.emulatedActive) return 0;
  if (wearableLike) {
    return (
      entry.measuredPulseRateBpm
      ?? entry.wearableHeartRateBpm
      ?? entry.pulseRateBpm
      ?? 0
    );
  }
  return entry.measuredPulseRateBpm ?? entry.pulseRateBpm ?? 0;
}

function rawGuidanceValue(entry: CoherencePulseLogEntry): number {
  return entry.guidancePulseRateBpm ?? entry.pulseRateBpm ?? 0;
}

export function buildPulseSeriesFromLog(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
  mode: "measured" | "guidance",
): BreathResultsSeriesPoint[] {
  const points: BreathResultsSeriesPoint[] = [];
  let lastLiveMeasured = 0;
  let lastLiveGuidance = 0;

  for (const entry of entries) {
    const tMs = Math.max(0, entry.wallClockMs - sessionStartWallMs);
    const live = isPulseLogEntryLiveForMeasurement(entry);
    const measuredRaw = rawMeasuredValue(entry);
    const guidanceRaw = rawGuidanceValue(entry);

    if (live) {
      if (measuredRaw > 0) lastLiveMeasured = measuredRaw;
      if (guidanceRaw > 0) lastLiveGuidance = guidanceRaw;
    }

    let value: number;
    if (mode === "measured") {
      if (entry.emulatedActive) {
        value = 0;
      } else if (live) {
        value = measuredRaw;
      } else {
        const wearableLike =
          entry.pulseSource === "wearable" || entry.wearableState != null;
        value = wearableLike
          ? 0
          : (lastLiveMeasured > 0 ? lastLiveMeasured : 0);
      }
    } else if (entry.emulatedActive) {
      value = guidanceRaw > 0 ? guidanceRaw : (lastLiveGuidance > 0 ? lastLiveGuidance : 0);
    } else if (live) {
      value = guidanceRaw;
    } else {
      value = lastLiveGuidance > 0 ? lastLiveGuidance : (guidanceRaw > 0 ? guidanceRaw : 0);
    }

    if (!Number.isFinite(value)) continue;
    points.push({ tMs, value });
  }
  return points;
}

export function bridgeSeriesAcrossNonLiveGaps(
  points: readonly BreathResultsSeriesPoint[],
  intervals: readonly NonLiveInterval[],
  totalMs: number,
): BreathResultsSeriesPoint[] {
  if (points.length < 2 || intervals.length === 0) return [...points];

  const sorted = points
    .filter((point) => Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.tMs - b.tMs);
  if (sorted.length < 2) return sorted;

  const insideGap = (tMs: number) =>
    intervals.some((gap) => tMs > gap.startMs + 1 && tMs < gap.endMs - 1);

  const kept = sorted.filter((point) => !insideGap(point.tMs));
  const bridged: BreathResultsSeriesPoint[] = [...kept];

  for (const gap of intervals) {
    const before = sorted.filter((point) => point.tMs <= gap.startMs).at(-1);
    const after = sorted.find((point) => point.tMs >= gap.endMs);
    if (before == null || after == null) {
      if (before != null && gap.endMs >= totalMs - 500) {
        bridged.push({ tMs: gap.startMs, value: before.value });
        bridged.push({ tMs: totalMs, value: before.value });
      }
      continue;
    }
    bridged.push({ tMs: gap.startMs, value: before.value });
    bridged.push({ tMs: gap.endMs, value: after.value });
  }

  const deduped = new Map<number, BreathResultsSeriesPoint>();
  for (const point of bridged) {
    deduped.set(point.tMs, point);
  }
  return [...deduped.values()].sort((a, b) => a.tMs - b.tMs);
}

export function prepareSeriesForDisplay(
  points: readonly BreathResultsSeriesPoint[],
  totalMs: number,
  options?: {
    trimZeroEdges?: boolean;
    extendStart?: boolean;
    extendEnd?: boolean;
    trimLeadingZeros?: boolean;
  },
): BreathResultsSeriesPoint[] {
  let series = points
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ ...point }));

  if (options?.trimLeadingZeros ?? options?.trimZeroEdges) {
    while (series.length > 0 && Math.abs(series[0]!.value) < 0.001) {
      series = series.slice(1);
    }
  }
  if (options?.trimZeroEdges) {
    while (series.length > 0 && Math.abs(series[series.length - 1]!.value) < 0.001) {
      series = series.slice(0, -1);
    }
  }
  if (series.length === 0) return [];

  const extendStart = options?.extendStart ?? true;
  const extendEnd = options?.extendEnd ?? true;
  if (extendStart && series[0]!.tMs > 0) {
    series.unshift({ tMs: 0, value: series[0]!.value });
  }
  if (extendEnd && series[series.length - 1]!.tMs < totalMs) {
    series.push({ tMs: totalMs, value: series[series.length - 1]!.value });
  }
  return series;
}

export function preparePulseSeriesForDisplay(
  points: readonly BreathResultsSeriesPoint[],
  totalMs: number,
): BreathResultsSeriesPoint[] {
  return prepareSeriesForDisplay(points, totalMs, {
    trimLeadingZeros: true,
    extendStart: true,
    extendEnd: true,
  });
}

export function filterOutlierMetricPoints(
  points: readonly BreathResultsSeriesPoint[],
  maxValue: number,
): BreathResultsSeriesPoint[] {
  return points.filter((point) => Number.isFinite(point.value) && point.value <= maxValue);
}
