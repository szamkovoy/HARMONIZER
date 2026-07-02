import { describe, expect, it } from "vitest";

import { OpticalRingBuffer } from "@/modules/biofeedback/signal/optical-pipeline";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

function sample(t: number, red = 0.6): RawOpticalSample {
  return {
    timestampMs: t,
    width: 640,
    height: 480,
    redMean: red,
    greenMean: 0.1,
    blueMean: 0.05,
    lumaMean: 0.4,
    redDominance: 0.8,
    darknessRatio: 0.1,
    saturationRatio: 0,
    motion: 0,
    sampleCount: 1000,
    roiAreaRatio: 0.34,
  };
}

describe("OpticalRingBuffer.dropSamplesSince", () => {
  it("drops only samples at/after sinceMs, keeps earlier clean history", () => {
    const buf = new OpticalRingBuffer();
    // 9 s of clean samples (t = 1000..9000) then 3 s of "poison" (t = 10000..12000).
    for (let t = 1000; t <= 9000; t += 1000) buf.push(sample(t, 0.6));
    for (let t = 10000; t <= 12000; t += 1000) buf.push(sample(t, 1.0));
    expect(buf.getSamples().length).toBe(12);

    // Finger returns at t = 13000; absence was ~3 s → drop poison since t = 10000.
    buf.dropSamplesSince(10_000);

    const kept = buf.getSamples();
    expect(kept.length).toBe(9);
    expect(kept[kept.length - 1]!.timestampMs).toBe(9_000);
    expect(kept.every((p) => p.redMean === 0.6)).toBe(true);
  });

  it("is a no-op when nothing matches", () => {
    const buf = new OpticalRingBuffer();
    for (let t = 1000; t <= 5000; t += 1000) buf.push(sample(t, 0.6));
    buf.dropSamplesSince(9_000);
    expect(buf.getSamples().length).toBe(5);
  });

  it("is a no-op on an empty buffer", () => {
    const buf = new OpticalRingBuffer();
    buf.dropSamplesSince(1_000);
    expect(buf.getSamples().length).toBe(0);
  });
});
