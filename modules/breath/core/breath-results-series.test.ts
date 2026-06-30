import { describe, expect, it } from "vitest";

import {
  applyPulseChartVerticalSteps,
  bridgeSeriesAcrossNonLiveGaps,
  buildPulseSeriesFromLog,
  filterIsolatedMetricSpikes,
  filterOutlierMetricPoints,
  isPulseLogEntryLiveForMeasurement,
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
  it("holds camera measured pulse across short gaps", () => {
    const start = 1_000;
    const log = [
      entry(start + 1_000, { measuredPulseRateBpm: 74, guidancePulseRateBpm: 74, pulseReady: true }),
      entry(start + 4_000, { measuredPulseRateBpm: 0, guidancePulseRateBpm: 70, pulseReady: false }),
      entry(start + 7_000, { measuredPulseRateBpm: 76, guidancePulseRateBpm: 76, pulseReady: true }),
    ];
    const measured = buildPulseSeriesFromLog(log, start, "measured");
    expect(measured.map((point) => point.value)).toEqual([74, 74, 76]);
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
      wearableCapabilityTier: "fullMetrics",
      wearableHeartRateBpm: 84,
      measuredPulseRateBpm: 84,
      wearableLastRrAgeMs: 9_000,
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
    expect(measured[1]?.value).toBe(70);
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
});
