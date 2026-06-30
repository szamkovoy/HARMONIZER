import { describe, expect, it } from "vitest";

import {
  bridgeSeriesAcrossNonLiveGaps,
  buildPulseSeriesFromLog,
  isPulseLogEntryLiveForMeasurement,
  type NonLiveInterval,
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
});
