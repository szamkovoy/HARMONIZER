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
const PULSE_RESULT_STABLE_RECOVERY_MS = 8_000;

/** Shared wearable live-measurement gate (Polar RR freshness when RR was ever seen). */
export function isWearableLogEntryLiveForMeasurement(entry: CoherencePulseLogEntry): boolean {
  if (entry.wearableSensorContactDetected === false) return false;
  if (entry.wearableState != null && NON_LIVE_WEARABLE_STATES.has(entry.wearableState)) {
    return false;
  }
  const measured =
    entry.measuredPulseRateBpm
    ?? entry.wearableHeartRateBpm
    ?? entry.pulseRateBpm
    ?? 0;
  if (!(entry.pulseReady && measured > 0)) return false;
  const rrAgeMs = entry.wearableLastRrAgeMs;
  const hadRr = (entry.wearableRrPacketCount ?? 0) > 0 || rrAgeMs != null;
  if (hadRr && (rrAgeMs == null || rrAgeMs > WEARABLE_LIVE_RR_FRESH_MS)) {
    return false;
  }
  return true;
}

export function isPulseLogEntryLiveForMeasurement(entry: CoherencePulseLogEntry): boolean {
  if (entry.emulatedActive) return false;
  const wearableLike =
    entry.pulseSource === "wearable" || entry.wearableState != null;
  if (wearableLike) {
    return isWearableLogEntryLiveForMeasurement(entry);
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

export function mergeNearbyNonLiveIntervals(
  intervals: readonly NonLiveInterval[],
  stableRecoveryMs = PULSE_RESULT_STABLE_RECOVERY_MS,
): NonLiveInterval[] {
  if (intervals.length < 2) return [...intervals];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: NonLiveInterval[] = [{ ...sorted[0]! }];
  for (const interval of sorted.slice(1)) {
    const current = merged[merged.length - 1]!;
    if (interval.startMs - current.endMs <= stableRecoveryMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function isInsideNonLiveInterval(tMs: number, intervals: readonly NonLiveInterval[]): boolean {
  // Left edge is exclusive: a gap now starts exactly at the last live sample's timestamp
  // (see collectNonLiveIntervalsFromLog). That boundary sample must keep its measured value
  // so the live line touches the band edge, while every sample strictly inside is folded away.
  return intervals.some((interval) => tMs > interval.startMs && tMs < interval.endMs);
}

export function collectNonLiveIntervalsFromLog(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): NonLiveInterval[] {
  const intervals: NonLiveInterval[] = [];
  let openStart: number | null = null;
  let prevTMs: number | null = null;
  for (const entry of entries) {
    const tMs = Math.max(0, entry.wallClockMs - sessionStartWallMs);
    const live = isPulseLogEntryLiveForMeasurement(entry);
    if (!live) {
      // Anchor the gap's LEFT edge to the last live sample, not to this first non-live
      // entry: when the sensor drops the log can go silent for several seconds before a
      // non-live sample is recorded, which would otherwise leave an unshaded slice between
      // where the live line breaks and where the gray band starts.
      if (openStart == null) openStart = prevTMs != null ? prevTMs : tMs;
    } else if (openStart != null) {
      intervals.push({ startMs: openStart, endMs: tMs });
      openStart = null;
    }
    prevTMs = tMs;
  }
  if (openStart != null && entries.length > 0) {
    const lastT = Math.max(
      0,
      entries[entries.length - 1]!.wallClockMs - sessionStartWallMs,
    );
    intervals.push({ startMs: openStart, endMs: lastT });
  }
  return mergeNearbyNonLiveIntervals(intervals);
}

function collectFlaggedIntervalsFromLog(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
  isInside: (entry: CoherencePulseLogEntry) => boolean,
): NonLiveInterval[] {
  const intervals: NonLiveInterval[] = [];
  let openStart: number | null = null;
  let prevTMs: number | null = null;
  for (const entry of entries) {
    const tMs = Math.max(0, entry.wallClockMs - sessionStartWallMs);
    if (isInside(entry)) {
      // See collectNonLiveIntervalsFromLog: anchor to the last live sample so the shaded
      // band's left edge coincides with the point where the live pulse line breaks.
      if (openStart == null) openStart = prevTMs != null ? prevTMs : tMs;
    } else if (openStart != null) {
      intervals.push({ startMs: openStart, endMs: tMs });
      openStart = null;
    }
    prevTMs = tMs;
  }
  if (openStart != null && entries.length > 0) {
    const lastT = Math.max(
      0,
      entries[entries.length - 1]!.wallClockMs - sessionStartWallMs,
    );
    intervals.push({ startMs: openStart, endMs: lastT });
  }
  return mergeNearbyNonLiveIntervals(intervals);
}

/** Gaps where measured pulse was not live (camera hold, BLE stale RR, emulated). */
export function collectMeasuredPulseHighlightIntervals(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): NonLiveInterval[] {
  return collectSharedPulseHighlightIntervals(entries, sessionStartWallMs);
}

/** Same intervals as measured — marks hold/emulated/non-live guidance segments. */
export function collectGuidancePulseHighlightIntervals(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): NonLiveInterval[] {
  return collectSharedPulseHighlightIntervals(entries, sessionStartWallMs);
}

/** Shared pulse-chart shading for any non-live / hold / emulated window. */
export function collectSharedPulseHighlightIntervals(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): NonLiveInterval[] {
  return collectFlaggedIntervalsFromLog(
    entries,
    sessionStartWallMs,
    (entry) =>
      entry.emulatedActive ||
      entry.interpolationHoldActive === true ||
      !isPulseLogEntryLiveForMeasurement(entry),
  );
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
  const effectiveNonLiveIntervals = collectNonLiveIntervalsFromLog(entries, sessionStartWallMs);

  for (const entry of entries) {
    const tMs = Math.max(0, entry.wallClockMs - sessionStartWallMs);
    const live =
      isPulseLogEntryLiveForMeasurement(entry) &&
      !isInsideNonLiveInterval(tMs, effectiveNonLiveIntervals);
    const measuredRaw = rawMeasuredValue(entry);
    const guidanceRaw = rawGuidanceValue(entry);

    if (live) {
      if (measuredRaw > 0) lastLiveMeasured = measuredRaw;
    }

    let value: number;
    if (mode === "measured") {
      if (entry.emulatedActive || !live) {
        value = 0;
      } else {
        value = measuredRaw;
      }
    } else if (entry.emulatedActive) {
      // During signal loss the practice paces breathing from a synthetic beat train at the
      // LAST known pulse rate, so guidance must read as a flat hold at `lastLiveGuidance` —
      // not follow a decaying/off-body emulated value (which would draw a phantom dip inside
      // the gray gap band, e.g. the downward spike seen on the BLE guidance chart).
      value = lastLiveGuidance > 0 ? lastLiveGuidance : (guidanceRaw > 0 ? guidanceRaw : 0);
    } else if (live) {
      value = guidanceRaw;
    } else {
      value = lastLiveGuidance > 0 ? lastLiveGuidance : (guidanceRaw > 0 ? guidanceRaw : 0);
    }

    // NB: `guidancePulseRateBpm` in the log is ALREADY the runtime-sanitized breathing
    // tempo. Re-running `sanitizeBreathGuidanceBpm` here is double-processing and, right
    // after a hold/gap, the "recent accepted" history collapses to a single repeated value
    // (spread 0). Its spike-rejection rule then permanently rejects every real ≥3.5 BPM
    // change, freezing the guidance chart at the pre-gap value (the phantom plateau). We
    // plot the logged guidance faithfully and rely on the isolated/short-run spike filters
    // in `buildGuidancePulseChartSeries` for cosmetic noise removal.
    if (mode === "guidance" && live && value > 0) {
      lastLiveGuidance = value;
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

const ZERO_PULSE_EPSILON = 0.5;

function isNearZero(value: number): boolean {
  return Math.abs(value) < ZERO_PULSE_EPSILON;
}

function findZeroRuns(points: readonly BreathResultsSeriesPoint[]): NonLiveInterval[] {
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);
  const runs: NonLiveInterval[] = [];
  let openStart: number | null = null;
  for (const point of sorted) {
    if (isNearZero(point.value)) {
      if (openStart == null) openStart = point.tMs;
    } else if (openStart != null) {
      runs.push({ startMs: openStart, endMs: point.tMs });
      openStart = null;
    }
  }
  if (openStart != null && sorted.length > 0) {
    runs.push({ startMs: openStart, endMs: sorted[sorted.length - 1]!.tMs });
  }
  return runs;
}

/** Insert vertical edges at zero plateaus so pulse-loss gaps render with full width. */
export function applyPulseChartVerticalSteps(
  points: readonly BreathResultsSeriesPoint[],
): BreathResultsSeriesPoint[] {
  if (points.length < 2) return [...points];
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);
  const zeroRuns = findZeroRuns(sorted);
  if (zeroRuns.length === 0) return sorted;

  const out: BreathResultsSeriesPoint[] = [];
  for (const run of zeroRuns) {
    const before = sorted.filter((point) => point.tMs <= run.startMs && !isNearZero(point.value)).at(-1);
    const after = sorted.find((point) => point.tMs >= run.endMs && !isNearZero(point.value));
    if (before != null) {
      out.push({ tMs: run.startMs, value: before.value });
      out.push({ tMs: run.startMs, value: 0 });
    }
    out.push({ tMs: run.endMs, value: 0 });
    if (after != null) {
      out.push({ tMs: run.endMs, value: 0 });
      out.push({ tMs: run.endMs, value: after.value });
    }
  }

  for (const point of sorted) {
    const insideZero = zeroRuns.some(
      (run) => point.tMs > run.startMs + 1 && point.tMs < run.endMs - 1 && isNearZero(point.value),
    );
    if (!insideZero) out.push(point);
  }

  const deduped = new Map<string, BreathResultsSeriesPoint>();
  for (const point of out) {
    deduped.set(`${point.tMs}|${point.value.toFixed(3)}`, point);
  }
  return [...deduped.values()].sort((a, b) => a.tMs - b.tMs || a.value - b.value);
}

/** Remove single-sample spikes sandwiched between similar neighbors (garbage beats). */
export function filterIsolatedMetricSpikes(
  points: readonly BreathResultsSeriesPoint[],
  options?: { minSpikeDelta?: number; maxNeighborDelta?: number },
): BreathResultsSeriesPoint[] {
  if (points.length < 3) return [...points];
  const minSpikeDelta = options?.minSpikeDelta ?? 4;
  const maxNeighborDelta = options?.maxNeighborDelta ?? 2.5;
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);
  const keep = sorted.map(() => true);

  for (let i = 1; i < sorted.length - 1; i += 1) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    const neighborsClose = Math.abs(prev.value - next.value) <= maxNeighborDelta;
    const curSpike =
      Math.abs(cur.value - prev.value) >= minSpikeDelta &&
      Math.abs(cur.value - next.value) >= minSpikeDelta;
    if (neighborsClose && curSpike) {
      keep[i] = false;
    }
  }

  return sorted.filter((_, index) => keep[index]);
}

function filterShortMetricSpikeRuns(
  points: readonly BreathResultsSeriesPoint[],
  options?: { minSpikeDelta?: number; maxNeighborDelta?: number; maxRunDurationMs?: number },
): BreathResultsSeriesPoint[] {
  if (points.length < 4) return [...points];
  const minSpikeDelta = options?.minSpikeDelta ?? 5;
  const maxNeighborDelta = options?.maxNeighborDelta ?? 3;
  const maxRunDurationMs = options?.maxRunDurationMs ?? 2_500;
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);
  const keep = sorted.map(() => true);

  for (let start = 1; start < sorted.length - 2; start += 1) {
    const prev = sorted[start - 1]!;
    for (let end = start; end < sorted.length - 1; end += 1) {
      const runDurationMs = sorted[end]!.tMs - sorted[start]!.tMs;
      if (runDurationMs > maxRunDurationMs) break;

      const next = sorted[end + 1]!;
      if (Math.abs(prev.value - next.value) > maxNeighborDelta) continue;

      const lowNeighbor = Math.min(prev.value, next.value);
      const highNeighbor = Math.max(prev.value, next.value);
      const run = sorted.slice(start, end + 1);
      const highRun = run.every((point) => point.value >= highNeighbor + minSpikeDelta);
      const lowRun = run.every((point) => point.value <= lowNeighbor - minSpikeDelta);
      if (highRun || lowRun) {
        for (let index = start; index <= end; index += 1) {
          keep[index] = false;
        }
      }
    }
  }

  return sorted.filter((_, index) => keep[index]);
}

/**
 * Split a series into drawable segments. The line breaks:
 *   1. at a zero value (missing pulse measurement), and
 *   2. across a *time gap* larger than the series' own cadence (missing data / signal loss).
 *
 * Rule 2 is what keeps a chart honest: when a metric could not be computed for a stretch
 * (sensor off, insufficient coherence coverage, warm-up), there are simply no points there.
 * Without a break the polyline would connect the last pre-gap point straight to the first
 * post-gap point — a long diagonal/flat line that looks like real (flat) data when in fact
 * nothing was measured. We break instead so the gap reads as a gap.
 *
 * The gap threshold is adaptive by default (≈3.5× the median sample spacing, floored at 6 s) so
 * it works for dense 1 Hz coherence, 5 s RMSSD/stress and sparse per-breath RSA alike, while
 * normal jitter never triggers a spurious break. Pass `maxGapMs` to override.
 */
export function splitPulseChartSeriesSegments(
  points: readonly BreathResultsSeriesPoint[],
  options?: { maxGapMs?: number },
): BreathResultsSeriesPoint[][] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.tMs - b.tMs);

  let gapLimitMs = options?.maxGapMs;
  if (gapLimitMs == null) {
    const spacings: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const dt = sorted[i]!.tMs - sorted[i - 1]!.tMs;
      if (dt > 0) spacings.push(dt);
    }
    if (spacings.length >= 2) {
      spacings.sort((a, b) => a - b);
      const medianSpacing = spacings[Math.floor(spacings.length / 2)]!;
      gapLimitMs = Math.max(6_000, medianSpacing * 3.5);
    } else {
      gapLimitMs = Number.POSITIVE_INFINITY;
    }
  }

  const segments: BreathResultsSeriesPoint[][] = [];
  let current: BreathResultsSeriesPoint[] = [];
  let prevTs: number | null = null;
  for (const point of sorted) {
    if (isNearZero(point.value)) {
      if (current.length >= 2) segments.push(current);
      current = [];
      prevTs = point.tMs;
      continue;
    }
    if (prevTs != null && point.tMs - prevTs > gapLimitMs && current.length > 0) {
      if (current.length >= 2) segments.push(current);
      current = [];
    }
    current.push(point);
    prevTs = point.tMs;
  }
  if (current.length >= 2) segments.push(current);
  return segments;
}

/**
 * Rate-limit the breathing-guidance BPM so it tracks the live pulse smoothly.
 *
 * A single detector tick can jump wildly (optical noise, first beat after a gap). We cap the
 * per-tick change to `maxStepBpm` toward the new value: a one-off spike is bounded and reverts
 * on the next tick, while a *sustained* real change keeps ramping `maxStep`/tick until guidance
 * reaches it.
 *
 * We deliberately do NOT hard-reject changes. The previous "reject the jump if the last few
 * samples were tight (spread ≤ 3)" rule latched guidance at the pre-change value indefinitely:
 * once it rejected, the rejected value fed back into the recent buffer (spread stayed 0), so
 * every subsequent real change was rejected too — the frozen guidance plateau seen on the chart
 * while the measured pulse had clearly moved on (e.g. guidance stuck at 76 while pulse sat at
 * ~71 for 15 s). Breathing tempo is additionally smoothed by `BreathPhasePlanner`'s slow EMA,
 * so bounded per-tick tracking here is all that is needed.
 */
export function sanitizeBreathGuidanceBpm(
  candidate: number,
  previous: number | null | undefined,
  options?: {
    maxStepBpm?: number;
  },
): number {
  if (!(candidate > 0) || !Number.isFinite(candidate)) return candidate;
  if (previous == null || !(previous > 0)) return candidate;
  const maxStep = options?.maxStepBpm ?? 6;
  const delta = candidate - previous;
  if (Math.abs(delta) > maxStep) {
    return previous + Math.sign(delta) * maxStep;
  }
  return candidate;
}

/**
 * Fold the first live sample(s) right after a measurement gap back into the gap when they
 * deviate strongly from the stabilized signal that follows.
 *
 * The first beat detected after an optical signal gap has an unreliable RR (it is measured
 * against a stale beat from before the gap, or against a still-settling detector), so it
 * shows up as a lone dip/spike immediately after the gray gap band — e.g. a false 58 BPM
 * point wedged between a gap and a stable ~69 BPM run. Physiologically the heart rate cannot
 * teleport for a single sample and jump back, so we treat such a leading sample as
 * still-reacquiring and drop it instead of drawing a phantom pulse.
 */
export function dropPostGapMeasuredArtifacts(
  points: readonly BreathResultsSeriesPoint[],
  options?: { maxDeviationBpm?: number; lookahead?: number },
): BreathResultsSeriesPoint[] {
  const maxDeviationBpm = options?.maxDeviationBpm ?? 4;
  const lookahead = options?.lookahead ?? 3;
  const out = points.map((point) => ({ ...point }));
  for (let i = 0; i < out.length; i += 1) {
    const cur = out[i]!;
    if (isNearZero(cur.value)) continue;
    const prev = i > 0 ? out[i - 1]! : null;
    // A post-gap artifact requires an actual preceding gap (a near-zero sample right before).
    // The very first sample of the series (prev == null) is the session start, not a recovery,
    // so it must never be folded away here.
    const afterGap = prev != null && isNearZero(prev.value);
    if (!afterGap) continue;
    const nextVals: number[] = [];
    for (let k = i + 1; k < out.length && nextVals.length < lookahead; k += 1) {
      if (!isNearZero(out[k]!.value)) nextVals.push(out[k]!.value);
    }
    if (nextVals.length === 0) continue;
    const sorted = [...nextVals].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)]!;
    if (Math.abs(cur.value - med) > maxDeviationBpm) {
      cur.value = 0;
    }
  }
  return out;
}

export function buildMeasuredPulseChartSeries(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
  totalMs: number,
): BreathResultsSeriesPoint[] {
  const base = buildPulseSeriesFromLog(entries, sessionStartWallMs, "measured");
  const deGapped = dropPostGapMeasuredArtifacts(base);
  const withoutSpikes = filterShortMetricSpikeRuns(
    filterIsolatedMetricSpikes(deGapped, { minSpikeDelta: 5, maxNeighborDelta: 3 }),
    { minSpikeDelta: 4, maxNeighborDelta: 3 },
  );
  return preparePulseSeriesForDisplay(withoutSpikes, totalMs);
}

export function buildGuidancePulseChartSeries(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
  totalMs: number,
): BreathResultsSeriesPoint[] {
  const base = buildPulseSeriesFromLog(entries, sessionStartWallMs, "guidance");
  const withoutSpikes = filterShortMetricSpikeRuns(
    filterIsolatedMetricSpikes(base, { minSpikeDelta: 5, maxNeighborDelta: 3 }),
    { minSpikeDelta: 4, maxNeighborDelta: 3 },
  );
  return preparePulseSeriesForDisplay(withoutSpikes, totalMs);
}

export function summarizePulseLockTransitions(
  entries: readonly CoherencePulseLogEntry[],
  sessionStartWallMs: number,
): Array<{
  tSec: number;
  from: string | null;
  to: string;
  fingerDetected: boolean | null;
  liveMeasurementActive: boolean | null;
  interpolationHoldActive: boolean | null;
  emulatedActive: boolean | null;
}> {
  const transitions: Array<{
    tSec: number;
    from: string | null;
    to: string;
    fingerDetected: boolean | null;
    liveMeasurementActive: boolean | null;
    interpolationHoldActive: boolean | null;
    emulatedActive: boolean | null;
  }> = [];
  let prevLock: string | null = null;
  for (const entry of entries) {
    const lock = entry.pulseLockState ?? "unknown";
    if (lock === prevLock) continue;
    transitions.push({
      tSec: Math.round(Math.max(0, entry.wallClockMs - sessionStartWallMs) / 100) / 10,
      from: prevLock,
      to: lock,
      fingerDetected: entry.fingerDetected ?? null,
      liveMeasurementActive: entry.liveMeasurementActive ?? null,
      interpolationHoldActive: entry.interpolationHoldActive ?? null,
      emulatedActive: entry.emulatedActive ?? null,
    });
    prevLock = lock;
  }
  return transitions;
}
