import { describe, expect, it } from "vitest";

import {
  applyPulseChartVerticalSteps,
  bridgeSeriesAcrossNonLiveGaps,
  buildMeasuredPulseChartSeries,
  buildPulseSeriesFromLog,
  collectGuidancePulseHighlightIntervals,
  collectMeasuredPulseHighlightIntervals,
  collectSharedPulseHighlightIntervals,
  filterIsolatedMetricSpikes,
  filterOutlierMetricPoints,
  isPulseLogEntryLiveForMeasurement,
  sanitizeBreathGuidanceBpm,
  splitPulseChartSeriesSegments,
  type NonLiveInterval,
  RSA_RESULTS_OUTLIER_BPM,
} from "@/modules/breath/core/breath-results-series";
import type { CoherencePulseLogEntry } from "@/modules/breath/core/coherence-session-analysis";

function entry(
  wallClockMs: number,
  overrides: Partial<CoherencePulseLogEntry> = {},
): CoherencePulseLogEntry {
  return {
    cameraTimestampMs: wallClockMs,
    wallClockMs,
    pulseRateBpm: 75,
    measuredPulseRateBpm: 75,
    guidancePulseRateBpm: 75,
    signalQuality: 0.9,
    pulseReady: true,
    fingerDetected: true,
    pulseLockState: "tracking",
    beatTimestampsCount: 10,
    pulseSource: "fingerCamera",
    emulatedActive: false,
    ...overrides,
  };
}

describe("breath-results-series", () => {
  it("zeros camera measured pulse during short non-live gaps", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 74, guidancePulseRateBpm: 74, pulseReady: true }),
      entry(start + 4_000, { measuredPulseRateBpm: 0, guidancePulseRateBpm: 70, pulseReady: false, lastBeatAgeMs: 4_000 }),
      entry(start + 7_000, { measuredPulseRateBpm: 76, guidancePulseRateBpm: 76, pulseReady: true }),
    ];
    const measured = buildPulseSeriesFromLog(log, start, "measured");
    expect(measured.map((point) => point.value)).toEqual([74, 0, 76]);
    const guidance = buildPulseSeriesFromLog(log, start, "guidance");
    expect(guidance.map((point) => point.value)).toEqual([74, 74, 76]);
  });

  it("zeros measured pulse during emulated camera loss", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 74, guidancePulseRateBpm: 74 }),
      entry(start + 4_000, {
        measuredPulseRateBpm: 0,
        guidancePulseRateBpm: 74,
        emulatedActive: true,
        pulseSource: "emulated",
      }),
    ];
    const measured = buildPulseSeriesFromLog(log, start, "measured");
    expect(measured[1]?.value).toBe(0);
  });

  it("treats stale BLE RR as non-live measurement", () => {
    const sample = entry(1_000, {
      pulseSource: "wearable",
      wearableState: "ready",
      wearableCapabilityTier: "guidedOnly",
      wearableHeartRateBpm: 84,
      measuredPulseRateBpm: 84,
      wearableLastRrAgeMs: 9_000,
      wearableRrPacketCount: 12,
      pulseReady: true,
    });
    expect(isPulseLogEntryLiveForMeasurement(sample)).toBe(false);
    const measured = buildPulseSeriesFromLog([sample], 0, "measured");
    expect(measured[0]?.value).toBe(0);
  });

  it("bridges metric gaps with a straight line", () => {
    const points = [
      { tMs: 0, value: 10 },
      { tMs: 10_000, value: 12 },
      { tMs: 15_000, value: 90 },
      { tMs: 25_000, value: 11 },
    ];
    const gaps: NonLiveInterval[] = [{ startMs: 10_000, endMs: 25_000 }];
    const bridged = bridgeSeriesAcrossNonLiveGaps(points, gaps, 300_000);
    expect(bridged.some((point) => point.tMs === 10_000 && point.value === 12)).toBe(true);
    expect(bridged.some((point) => point.tMs === 25_000 && point.value === 11)).toBe(true);
    expect(bridged.some((point) => point.value === 90)).toBe(false);
  });

  it("treats stale camera beat age as non-live measurement", () => {
    const sample = entry(1_000, {
      measuredPulseRateBpm: 63,
      pulseReady: true,
      lastBeatAgeMs: 4_000,
    });
    expect(isPulseLogEntryLiveForMeasurement(sample)).toBe(false);
    const log = [
      entry(1_000, { measuredPulseRateBpm: 70, guidancePulseRateBpm: 70, pulseReady: true, lastBeatAgeMs: 800 }),
      entry(4_000, { measuredPulseRateBpm: 63, guidancePulseRateBpm: 63, pulseReady: true, lastBeatAgeMs: 4_000 }),
    ];
    const measured = buildPulseSeriesFromLog(log, 0, "measured");
    expect(measured[1]?.value).toBe(0);
  });

  it("passes small guidance changes through (tracks the live pulse)", () => {
    // A modest change (≤ maxStep) must be followed, not rejected — rejecting it was what
    // latched guidance at the pre-change value and froze the guidance chart.
    expect(sanitizeBreathGuidanceBpm(82.5, 79)).toBe(82.5);
    expect(sanitizeBreathGuidanceBpm(71.6, 76.1)).toBe(71.6);
  });

  it("rate-limits large guidance jumps toward the target instead of freezing", () => {
    // Big jump is capped to maxStep (6) toward the target, never hard-rejected.
    expect(sanitizeBreathGuidanceBpm(60.5, 70)).toBe(64);
    expect(sanitizeBreathGuidanceBpm(90, 70)).toBe(76);
  });

  it("never latches: a sustained real step is reached within a few ticks", () => {
    // Simulates the logged latch case (measured stepped 76 -> 71.6 and held). Guidance must
    // converge to the new level, not stay frozen at 76.
    let guidance = 76.1;
    for (let i = 0; i < 5; i += 1) {
      guidance = sanitizeBreathGuidanceBpm(71.6, guidance);
    }
    expect(guidance).toBeCloseTo(71.6, 5);
  });

  it("filters RSA outliers from metric charts", () => {
    const filtered = filterOutlierMetricPoints(
      [{ tMs: 0, value: 8 }, { tMs: 1000, value: 58 }, { tMs: 2000, value: 9 }],
      RSA_RESULTS_OUTLIER_BPM,
    );
    expect(filtered.map((point) => point.value)).toEqual([8, 9]);
  });

  it("adds vertical steps at zero pulse plateaus", () => {
    const stepped = applyPulseChartVerticalSteps([
      { tMs: 0, value: 70 },
      { tMs: 200_000, value: 70 },
      { tMs: 210_000, value: 0 },
      { tMs: 230_000, value: 0 },
      { tMs: 240_000, value: 72 },
    ]);
    expect(stepped.some((point) => point.tMs === 210_000 && point.value === 70)).toBe(true);
    expect(stepped.some((point) => point.tMs === 210_000 && point.value === 0)).toBe(true);
    expect(stepped.some((point) => point.tMs === 240_000 && point.value === 0)).toBe(true);
    expect(stepped.some((point) => point.tMs === 240_000 && point.value === 72)).toBe(true);
  });

  it("removes isolated metric spikes", () => {
    const filtered = filterIsolatedMetricSpikes([
      { tMs: 0, value: 20 },
      { tMs: 5000, value: 20 },
      { tMs: 10000, value: 35 },
      { tMs: 15000, value: 20 },
    ]);
    expect(filtered.map((point) => point.value)).toEqual([20, 20, 20]);
  });

  it("removes short measured pulse spike runs after recovery", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 66, guidancePulseRateBpm: 66 }),
      entry(start + 1_600, { measuredPulseRateBpm: 72, guidancePulseRateBpm: 72 }),
      entry(start + 2_200, { measuredPulseRateBpm: 72, guidancePulseRateBpm: 72 }),
      entry(start + 3_000, { measuredPulseRateBpm: 65, guidancePulseRateBpm: 65 }),
    ];
    const measured = buildMeasuredPulseChartSeries(log, start, 5_000);
    expect(measured.map((point) => point.value)).not.toContain(72);
  });

  it("keeps decimated pulse chart segments drawable", () => {
    const points = Array.from({ length: 120 }, (_, index) => ({
      tMs: index * 2_500,
      value: 60 + index * 0.1,
    }));
    const segments = splitPulseChartSeriesSegments(points);
    expect(segments.length).toBe(1);
    expect(segments[0]!.length).toBeGreaterThanOrEqual(2);
  });

  it("omits zero samples from pulse chart segments", () => {
    const segments = splitPulseChartSeriesSegments([
      { tMs: 0, value: 70 },
      { tMs: 1_000, value: 0 },
      { tMs: 2_000, value: 72 },
      { tMs: 3_000, value: 71 },
    ]);
    expect(segments.length).toBe(1);
    expect(segments[0]!.map((point) => point.value)).toEqual([72, 71]);
  });

  it("uses the same highlight intervals for measured and guidance pulse charts", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 74, guidancePulseRateBpm: 74, pulseReady: true }),
      entry(start + 4_000, {
        measuredPulseRateBpm: 0,
        guidancePulseRateBpm: 70,
        pulseReady: false,
        interpolationHoldActive: true,
        lastBeatAgeMs: 4_000,
      }),
      entry(start + 7_000, { measuredPulseRateBpm: 76, guidancePulseRateBpm: 76, pulseReady: true }),
    ];
    const measured = collectMeasuredPulseHighlightIntervals(log, start);
    const guidance = collectGuidancePulseHighlightIntervals(log, start);
    const shared = collectSharedPulseHighlightIntervals(log, start);
    expect(measured).toEqual(guidance);
    expect(measured).toEqual(shared);
  });

  it("merges short false recovery islands inside one pulse-loss window", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 70, guidancePulseRateBpm: 70, pulseReady: true }),
      entry(start + 10_000, {
        measuredPulseRateBpm: 0,
        guidancePulseRateBpm: 70,
        pulseReady: false,
        interpolationHoldActive: true,
        lastBeatAgeMs: 4_000,
      }),
      entry(start + 14_000, { measuredPulseRateBpm: 82, guidancePulseRateBpm: 82, pulseReady: true }),
      entry(start + 18_000, {
        measuredPulseRateBpm: 0,
        guidancePulseRateBpm: 70,
        pulseReady: false,
        interpolationHoldActive: true,
        lastBeatAgeMs: 4_000,
      }),
      entry(start + 30_000, { measuredPulseRateBpm: 72, guidancePulseRateBpm: 72, pulseReady: true }),
    ];
    const highlights = collectSharedPulseHighlightIntervals(log, start);
    // The gap's left edge is anchored to the last live sample (t=1000), not the first
    // logged non-live sample (t=10000): during a real drop the log can go silent for a few
    // seconds before a non-live sample lands, and the shaded band must begin exactly where
    // the live pulse line breaks (no unshaded slice between the line end and the band).
    expect(highlights).toEqual([{ startMs: 1_000, endMs: 30_000 }]);
    const measured = buildPulseSeriesFromLog(log, start, "measured");
    const guidance = buildPulseSeriesFromLog(log, start, "guidance");
    expect(measured.map((point) => point.value)).toEqual([70, 0, 0, 0, 72]);
    expect(guidance.map((point) => point.value)).toEqual([70, 70, 70, 70, 72]);
  });

  it("anchors the gap band to the last live sample when the log goes silent on a drop", () => {
    const start = 0;
    // Live at 5 s, then the sensor drops and the log records nothing for 8 s before the
    // first emulated sample at 13 s; recovery at 20 s. The band must start at 5 s (where the
    // live line ends), not at 13 s (first logged non-live sample).
    const log = [
      entry(5_000, { measuredPulseRateBpm: 75, guidancePulseRateBpm: 75, pulseReady: true }),
      entry(13_000, {
        measuredPulseRateBpm: 0,
        guidancePulseRateBpm: 75,
        pulseReady: false,
        emulatedActive: true,
      }),
      entry(20_000, { measuredPulseRateBpm: 84, guidancePulseRateBpm: 84, pulseReady: true }),
    ];
    const highlights = collectSharedPulseHighlightIntervals(log, start);
    expect(highlights).toEqual([{ startMs: 5_000, endMs: 20_000 }]);
    const measured = buildPulseSeriesFromLog(log, start, "measured");
    // The last live sample keeps its value (band left edge is exclusive), and the resumed
    // live value is the honest post-gap reading.
    expect(measured).toEqual([
      { tMs: 5_000, value: 75 },
      { tMs: 13_000, value: 0 },
      { tMs: 20_000, value: 84 },
    ]);
  });
});
