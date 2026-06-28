import { describe, expect, it } from "vitest";

import { smoothBeatTimestampsMedian3ForMetrics } from "@/modules/biofeedback/core/rr-smoothing";

describe("smoothBeatTimestampsMedian3ForMetrics", () => {
  it("keeps wearable-like smooth rows effectively unchanged", () => {
    const beats = [0, 850, 1700, 2550, 3400, 4250];
    expect(smoothBeatTimestampsMedian3ForMetrics(beats)).toEqual(beats);
  });

  it("suppresses one local short-long jitter pair via RR median-of-3", () => {
    const beats = [0, 900, 1620, 2550, 3420];
    expect(smoothBeatTimestampsMedian3ForMetrics(beats)).toEqual([0, 900, 1800, 2670, 3540]);
  });

  it("preserves beat count and monotonic order", () => {
    const beats = [1000, 1910, 2630, 3560, 4430, 5370];
    const smoothed = smoothBeatTimestampsMedian3ForMetrics(beats);
    expect(smoothed).toHaveLength(beats.length);
    for (let i = 1; i < smoothed.length; i += 1) {
      expect(smoothed[i]).toBeGreaterThan(smoothed[i - 1]!);
    }
  });
});
