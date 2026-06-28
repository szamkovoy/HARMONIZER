import type { HrvGapEvent } from "@/modules/biofeedback/engines/hrv-beat-accumulator";

export type BiofeedbackSignalTrustLevel =
  | "full_biometrics"
  | "guided_limited"
  | "pulse_only";

export interface BiofeedbackSignalTrustSummary {
  level: BiofeedbackSignalTrustLevel;
  gapEventCount: number;
  totalGapMs: number;
  longestGapMs: number;
  rawBeatCount: number;
  metricBeatCount: number;
  meanAbsDrrRawMs: number;
  p90AbsDrrRawMs: number;
  meanAbsDrrMetricMs: number;
  p90AbsDrrMetricMs: number;
  reasons: string[];
}

const FULL_MAX_LONGEST_GAP_MS = 2_000;
const FULL_MAX_TOTAL_GAP_MS = 2_000;
const FULL_MAX_GAP_EVENTS = 0;
const FULL_MAX_MEAN_ABS_DRR_MS = 30;
const FULL_MAX_P90_ABS_DRR_MS = 90;

const LIMITED_MAX_LONGEST_GAP_MS = 5_000;
const LIMITED_MAX_TOTAL_GAP_MS = 6_000;
const LIMITED_MAX_GAP_EVENTS = 2;
const LIMITED_MAX_MEAN_ABS_DRR_MS = 40;
const LIMITED_MAX_P90_ABS_DRR_MS = 110;

const INITIAL_SESSION_GRACE_MS = 60_000;
const INITIAL_SESSION_GRACE_MIN_REMAINING_MS = 60_000;
const INITIAL_SESSION_GRACE_MIN_METRIC_BEATS = 30;
/** Если последний recovery в grace-окне почти у конца минуты — считаем, что сбои не прекратились. */
const INITIAL_SESSION_GRACE_TAIL_TOLERANCE_MS = 5_000;

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile90(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0;
}

function computeDrrStats(beats: readonly number[]): {
  meanAbsDrrMs: number;
  p90AbsDrrMs: number;
} {
  if (beats.length < 3) {
    return {
      meanAbsDrrMs: 0,
      p90AbsDrrMs: 0,
    };
  }

  const rr: number[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const interval = beats[i]! - beats[i - 1]!;
    if (interval > 0) {
      rr.push(interval);
    }
  }

  const drr: number[] = [];
  for (let i = 1; i < rr.length; i += 1) {
    drr.push(Math.abs(rr[i]! - rr[i - 1]!));
  }

  return {
    meanAbsDrrMs: mean(drr),
    p90AbsDrrMs: percentile90(drr),
  };
}

function filterGapEventsInRange(
  gapEvents: readonly HrvGapEvent[],
  startMs: number | null,
  endMs: number | null,
): HrvGapEvent[] {
  if (startMs == null || endMs == null) {
    return [...gapEvents];
  }
  return gapEvents.filter(
    (event) =>
      event.resumeBeatTimestampMs >= startMs - 1 &&
      event.resumeBeatTimestampMs <= endMs + 1,
  );
}

function filterBeatsInRange(
  beats: readonly number[],
  startMs: number | null,
  endMs: number | null,
): number[] {
  if (startMs == null && endMs == null) {
    return [...beats];
  }
  return beats.filter((beat) => {
    if (startMs != null && beat < startMs - 1) {
      return false;
    }
    if (endMs != null && beat > endMs + 1) {
      return false;
    }
    return true;
  });
}

function applyInitialSessionGraceWindow(params: {
  rawBeats: readonly number[];
  metricBeats: readonly number[];
  gapEvents: readonly HrvGapEvent[];
  startMs: number | null;
  endMs: number | null;
}): {
  rawBeats: readonly number[];
  metricBeats: readonly number[];
  gapEvents: readonly HrvGapEvent[];
  startMs: number | null;
  endMs: number | null;
} {
  const { rawBeats, metricBeats, gapEvents, startMs, endMs } = params;
  const firstBeatMs = rawBeats[0] ?? metricBeats[0] ?? null;
  const lastBeatMs = rawBeats[rawBeats.length - 1] ?? metricBeats[metricBeats.length - 1] ?? null;
  if (firstBeatMs == null || lastBeatMs == null) {
    return params;
  }

  const scopeStartMs = startMs ?? firstBeatMs;
  const scopeEndMs = endMs ?? lastBeatMs;
  const graceEndMs = scopeStartMs + INITIAL_SESSION_GRACE_MS;
  if (scopeEndMs - graceEndMs < INITIAL_SESSION_GRACE_MIN_REMAINING_MS) {
    return params;
  }

  const gapsInGrace = gapEvents.filter(
    (event) =>
      event.resumeBeatTimestampMs >= scopeStartMs &&
      event.resumeBeatTimestampMs < graceEndMs,
  );

  let evalStartMs = scopeStartMs;
  if (gapsInGrace.length > 0) {
    const lastGapResumeMs = Math.max(...gapsInGrace.map((event) => event.resumeBeatTimestampMs));
    if (lastGapResumeMs >= graceEndMs - INITIAL_SESSION_GRACE_TAIL_TOLERANCE_MS) {
      evalStartMs = graceEndMs;
    } else {
      evalStartMs = lastGapResumeMs;
    }
  }

  const scopedRawBeats = filterBeatsInRange(rawBeats, evalStartMs, scopeEndMs);
  const scopedMetricBeats = filterBeatsInRange(metricBeats, evalStartMs, scopeEndMs);
  if (
    scopedRawBeats.length < 2 ||
    scopedMetricBeats.length < INITIAL_SESSION_GRACE_MIN_METRIC_BEATS
  ) {
    return params;
  }

  const scopedGapEvents = gapEvents.filter(
    (event) =>
      event.resumeBeatTimestampMs >= graceEndMs &&
      event.resumeBeatTimestampMs <= scopeEndMs + 1,
  );

  return {
    rawBeats: scopedRawBeats,
    metricBeats: scopedMetricBeats,
    gapEvents: scopedGapEvents,
    startMs: evalStartMs,
    endMs: scopeEndMs,
  };
}

export function summarizeFingerSignalTrust(params: {
  rawBeats: readonly number[];
  metricBeats: readonly number[];
  gapEvents: readonly HrvGapEvent[];
  startMs?: number | null;
  endMs?: number | null;
  applyInitialGraceWindow?: boolean;
}): BiofeedbackSignalTrustSummary {
  const {
    rawBeats,
    metricBeats,
    gapEvents,
    startMs = null,
    endMs = null,
    applyInitialGraceWindow = false,
  } = params;
  const scoped = applyInitialGraceWindow
    ? applyInitialSessionGraceWindow({
        rawBeats,
        metricBeats,
        gapEvents,
        startMs,
        endMs,
      })
    : { rawBeats, metricBeats, gapEvents, startMs, endMs };
  const scopedGapEvents = filterGapEventsInRange(scoped.gapEvents, scoped.startMs, scoped.endMs);
  const gapEventCount = scopedGapEvents.length;
  const totalGapMs = scopedGapEvents.reduce((sum, event) => sum + event.gapMs, 0);
  const longestGapMs = scopedGapEvents.reduce(
    (max, event) => Math.max(max, event.gapMs),
    0,
  );

  const rawStats = computeDrrStats(scoped.rawBeats);
  const metricStats = computeDrrStats(scoped.metricBeats);

  const fullFailures: string[] = [];
  if (longestGapMs > FULL_MAX_LONGEST_GAP_MS) fullFailures.push("longest_gap");
  if (totalGapMs > FULL_MAX_TOTAL_GAP_MS) fullFailures.push("total_gap");
  if (gapEventCount > FULL_MAX_GAP_EVENTS) fullFailures.push("gap_events");
  if (metricStats.meanAbsDrrMs > FULL_MAX_MEAN_ABS_DRR_MS) fullFailures.push("mean_abs_drr");
  if (metricStats.p90AbsDrrMs > FULL_MAX_P90_ABS_DRR_MS) fullFailures.push("p90_abs_drr");

  const limitedFailures: string[] = [];
  if (longestGapMs > LIMITED_MAX_LONGEST_GAP_MS) limitedFailures.push("longest_gap");
  if (totalGapMs > LIMITED_MAX_TOTAL_GAP_MS) limitedFailures.push("total_gap");
  if (gapEventCount > LIMITED_MAX_GAP_EVENTS) limitedFailures.push("gap_events");
  if (metricStats.meanAbsDrrMs > LIMITED_MAX_MEAN_ABS_DRR_MS) limitedFailures.push("mean_abs_drr");
  if (metricStats.p90AbsDrrMs > LIMITED_MAX_P90_ABS_DRR_MS) limitedFailures.push("p90_abs_drr");

  const level: BiofeedbackSignalTrustLevel =
    limitedFailures.length > 0
      ? "pulse_only"
      : fullFailures.length > 0
        ? "guided_limited"
        : "full_biometrics";

  return {
    level,
    gapEventCount,
    totalGapMs,
    longestGapMs,
    rawBeatCount: scoped.rawBeats.length,
    metricBeatCount: scoped.metricBeats.length,
    meanAbsDrrRawMs: rawStats.meanAbsDrrMs,
    p90AbsDrrRawMs: rawStats.p90AbsDrrMs,
    meanAbsDrrMetricMs: metricStats.meanAbsDrrMs,
    p90AbsDrrMetricMs: metricStats.p90AbsDrrMs,
    reasons: level === "pulse_only" ? limitedFailures : fullFailures,
  };
}
