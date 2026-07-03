import { describe, expect, it } from "vitest";

import { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import {
  BiofeedbackPipeline,
  applyFingerOffBridgeCap,
  computePipelineBridgeOverride,
} from "@/modules/biofeedback/bus/biofeedback-pipeline";
import { WEARABLE_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import type { PulseBpmSnapshot } from "@/modules/biofeedback/engines/pulse-bpm-engine";

describe("BiofeedbackPipeline pushBeatEvent", () => {
  it("keeps the wearable merged history instead of collapsing to one beat", () => {
    const pipeline = new BiofeedbackPipeline(new BiofeedbackBus(), WEARABLE_CAPTURE_CONFIG);
    pipeline.setPulseSource("wearable");
    pipeline.markCalibrationCompleteForBeatSource(0);

    pipeline.pushBeatEvent(0, 0);
    pipeline.pushBeatEvent(1_000, 1_000);
    pipeline.pushBeatEvent(2_000, 2_000);
    pipeline.pushBeatEvent(3_000, 3_000);

    expect(pipeline.getCollectionSizes().mergedBeats).toBe(4);
    expect(pipeline.getMetricBeatTimestamps()).toEqual([1_000, 2_000, 3_000]);
    expect(pipeline.getHrvAccumulator().getBeats()).toEqual([1_000, 2_000, 3_000]);
  });

  it("resumes HRV accumulation after a long wearable gap", () => {
    const pipeline = new BiofeedbackPipeline(new BiofeedbackBus(), WEARABLE_CAPTURE_CONFIG);
    pipeline.setPulseSource("wearable");
    pipeline.markCalibrationCompleteForBeatSource(0);

    for (const beat of [0, 1_000, 2_000, 3_000, 7_000, 8_000, 9_000]) {
      pipeline.pushBeatEvent(beat, beat);
    }

    // The resume beat after a >2 s hole is intentionally excluded from HRV metrics,
    // but the beats that follow it must continue to accumulate.
    expect(pipeline.getMetricBeatTimestamps()).toEqual([
      1_000, 2_000, 3_000, 8_000, 9_000,
    ]);
    expect(pipeline.getHrvAccumulator().getBeats()).toEqual([
      1_000, 2_000, 3_000, 8_000, 9_000,
    ]);
  });

  it("restarts pulseBpm publishing after a source switch changes time base", () => {
    const bus = new BiofeedbackBus();
    const pipeline = new BiofeedbackPipeline(bus, WEARABLE_CAPTURE_CONFIG);
    const publishedBpmTimestamps: number[] = [];
    bus.subscribe("pulseBpm", () => {
      publishedBpmTimestamps.push(publishedBpmTimestamps.length);
    });

    pipeline.setPulseSource("emulated");
    pipeline.markCalibrationCompleteForBeatSource(1_000_000);
    pipeline.pushBeatEvent(1_000_000, 1_000_000);
    pipeline.pushBeatEvent(1_001_000, 1_001_000);
    const publishCountBeforeSwitch = publishedBpmTimestamps.length;

    pipeline.setPulseSource("wearable");
    pipeline.markCalibrationCompleteForBeatSource(0);
    pipeline.pushBeatEvent(0, 0);
    pipeline.pushBeatEvent(1_000, 1_000);

    expect(publishCountBeforeSwitch).toBeGreaterThan(0);
    expect(publishedBpmTimestamps.length).toBeGreaterThan(publishCountBeforeSwitch);
  });

  it("keeps emulated fallback beats out of wearable metric beats after recovery", () => {
    const pipeline = new BiofeedbackPipeline(new BiofeedbackBus(), WEARABLE_CAPTURE_CONFIG);
    pipeline.setPulseSource("wearable");
    pipeline.markCalibrationCompleteForBeatSource(0);

    for (const beat of [0, 1_000, 2_000, 3_000]) {
      pipeline.pushBeatEvent(beat, beat);
    }

    pipeline.setPulseSource("emulated");
    for (const beat of [4_000, 5_000, 6_000, 7_000]) {
      pipeline.pushBeatEvent(beat, beat);
    }

    pipeline.setPulseSource("wearable");
    for (const beat of [8_000, 9_000, 10_000]) {
      pipeline.pushBeatEvent(beat, beat);
    }

    // `setPulseSource` intentionally clears the merged history on every switch: sources may
    // use different time bases, and stale beats from the previous source would contaminate
    // the BPM window (the "horizontal plateau after a long gap" artifact).
    expect(pipeline.getMergedBeats()).toEqual([8_000, 9_000, 10_000]);
    // Emulated beats must never enter wearable metric beats; the resume beat after the
    // source switch is also excluded (gap guard), so metrics resume from the second beat.
    const metricBeats = pipeline.getMetricBeatTimestamps();
    expect(metricBeats).toContain(1_000);
    expect(metricBeats).toContain(2_000);
    expect(metricBeats).toContain(3_000);
    for (const emulatedBeat of [4_000, 5_000, 6_000, 7_000]) {
      expect(metricBeats).not.toContain(emulatedBeat);
    }
    expect(pipeline.getCoherenceEngine().getSessionBeats()).not.toContain(4_000);
  });
});

describe("computePipelineBridgeOverride (short-gap safety net)", () => {
  const baseSnap: PulseBpmSnapshot = {
    bpm: 0,
    rawBpm: 0,
    windowSeconds: 10,
    rrCount: 0,
    medianRrMs: 0,
    jitterMs: 0,
    intervalsMs: [],
    looksCoherent: false,
    lastBeatTimestampMs: 0,
    filteredBeatTimestampsMs: [],
    reacquiring: false,
    bridgingShortGap: false,
  };

  it("bridges a short gap (≤8s) on a coherent baseline when the engine dropped out (bpm=0)", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bpm: 0 },
      nowMs: 10_000,
      bridgeRrMs: 750, // 80 bpm
      bridgeAnchorTs: 6_000, // 4s ago
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).not.toBeNull();
    expect(ov!.bridgingShortGap).toBe(true);
    expect(ov!.reacquiring).toBe(false);
    expect(ov!.bpm).toBeCloseTo(80, 1);
    expect(ov!.medianRrMs).toBe(750);
  });

  it("bridges on the plausible-bpm fallback when no coherent baseline exists (marginal PPG)", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bpm: 0 },
      nowMs: 10_000,
      bridgeRrMs: 60000 / 82, // plausible fallback ~82 bpm
      bridgeAnchorTs: 8_500, // 1.5s ago
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).not.toBeNull();
    expect(ov!.bridgingShortGap).toBe(true);
    expect(ov!.bpm).toBeCloseTo(82, 0);
  });

  it("does not bridge when the engine already bridged (engine result preserved)", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bridgingShortGap: true, bpm: 79 },
      nowMs: 10_000,
      bridgeRrMs: 750,
      bridgeAnchorTs: 6_000,
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).toBeNull();
  });

  it("does not bridge a long gap (>8s) — falls through to reacquire/emulated", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, reacquiring: true, bpm: 0 },
      nowMs: 20_000,
      bridgeRrMs: 750,
      bridgeAnchorTs: 6_000, // 14s ago
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).toBeNull();
  });

  it("does not fire on a live frame (engine producing a usable bpm)", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bpm: 80 },
      nowMs: 7_000,
      bridgeRrMs: 750,
      bridgeAnchorTs: 6_500,
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).toBeNull();
  });

  it("clamps an out-of-range baseline RR to a physiological bridge rate", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bpm: 0 },
      nowMs: 10_000,
      bridgeRrMs: 1_500, // 40 bpm — below plausible
      bridgeAnchorTs: 8_000,
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).not.toBeNull();
    // clamped to 1200ms (50 bpm floor)
    expect(ov!.bpm).toBeCloseTo(50, 0);
  });

  it("never bridges wearable or emulated sources", () => {
    for (const { isEmulated, isWearable } of [
      { isEmulated: true, isWearable: false },
      { isEmulated: false, isWearable: true },
    ]) {
      const ov = computePipelineBridgeOverride({
        snapshot: { ...baseSnap, bpm: 0 },
        nowMs: 10_000,
        bridgeRrMs: 750,
        bridgeAnchorTs: 6_000,
        isEmulated,
        isWearable,
      });
      expect(ov).toBeNull();
    }
  });

  it("does not bridge without a known baseline", () => {
    const ov = computePipelineBridgeOverride({
      snapshot: { ...baseSnap, bpm: 0 },
      nowMs: 10_000,
      bridgeRrMs: 0,
      bridgeAnchorTs: 0,
      isEmulated: false,
      isWearable: false,
    });
    expect(ov).toBeNull();
  });
});

describe("applyFingerOffBridgeCap (finger-off bridge cap)", () => {
  const bridgeSnap: PulseBpmSnapshot = {
    bpm: 67.1,
    rawBpm: 67.1,
    windowSeconds: 10,
    rrCount: 6,
    medianRrMs: 894,
    jitterMs: 40,
    intervalsMs: [],
    looksCoherent: false,
    lastBeatTimestampMs: 200_000,
    filteredBeatTimestampsMs: [],
    reacquiring: false,
    bridgingShortGap: true,
  };

  it("keeps the bridge while the finger is present (marginal relock uses the full 12 s budget)", () => {
    const r = applyFingerOffBridgeCap({
      snapshot: bridgeSnap,
      contactPresent: true,
      nowMs: 212_000, // 12 s gap, finger on
      capMs: 4_000,
    });
    expect(r).toBeNull();
  });

  it("keeps the bridge during a short finger-off lift (≤ cap)", () => {
    const r = applyFingerOffBridgeCap({
      snapshot: bridgeSnap,
      contactPresent: false,
      nowMs: 203_500, // 3.5 s gap, finger off — a 3 s test lift
      capMs: 4_000,
    });
    expect(r).toBeNull();
  });

  it("cuts the bridge to gray once the finger is off beyond the cap (20 s lift plateau artifact)", () => {
    // Field scenario (export 1783095121380, 20 s lift at t=200): the bridge held a flat 67.1 bpm
    // "live" plateau for ~12 s while the finger was deliberately off, looking like an artifact
    // before the gray bar. Beyond the cap the frame must go gray (reacquiring, bpm=0).
    const r = applyFingerOffBridgeCap({
      snapshot: bridgeSnap,
      contactPresent: false,
      nowMs: 205_000, // 5 s gap, finger off — beyond the 4 s cap
      capMs: 4_000,
    });
    expect(r).not.toBeNull();
    expect(r!.bridgingShortGap).toBe(false);
    expect(r!.reacquiring).toBe(true);
    expect(r!.bpm).toBe(0);
  });

  it("does not touch non-bridging frames", () => {
    const r = applyFingerOffBridgeCap({
      snapshot: { ...bridgeSnap, bridgingShortGap: false, bpm: 0, reacquiring: true },
      contactPresent: false,
      nowMs: 210_000,
      capMs: 4_000,
    });
    expect(r).toBeNull();
  });
});
