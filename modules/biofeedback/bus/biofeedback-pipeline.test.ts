import { describe, expect, it } from "vitest";

import { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import { BiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-pipeline";
import { WEARABLE_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";

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

    expect(pipeline.getMergedBeats()).toEqual([
      0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000,
    ]);
    expect(pipeline.getMetricBeatTimestamps()).toEqual([
      1_000, 2_000, 3_000, 9_000, 10_000,
    ]);
    expect(pipeline.getCoherenceEngine().getSessionBeats()).not.toContain(4_000);
  });
});
