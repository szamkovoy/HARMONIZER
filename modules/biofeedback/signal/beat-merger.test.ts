import { describe, expect, it } from "vitest";

import {
  collapseSplitMergedBeats,
  repairMissedMergedBeats,
  stabilizeAlternatingJitterBeats,
} from "@/modules/biofeedback/signal/beat-merger";

describe("repairMissedMergedBeats", () => {
  it("inserts one synthetic beat for an obvious doubled RR gap", () => {
    const result = repairMissedMergedBeats([0, 820, 1_650, 3_290, 4_120]);
    expect(result.beats).toEqual([0, 820, 1_650, 2_470, 3_290, 4_120]);
    expect(result.insertedCount).toBe(1);
  });

  it("does not interpolate ordinary respiratory variability", () => {
    const result = repairMissedMergedBeats([0, 820, 1_710, 2_470, 3_390, 4_180]);
    expect(result.beats).toEqual([0, 820, 1_710, 2_470, 3_390, 4_180]);
    expect(result.insertedCount).toBe(0);
  });

  it("can restore two missed beats only when a triple-length gap matches local rhythm", () => {
    const result = repairMissedMergedBeats([0, 810, 1_620, 4_050, 4_860]);
    expect(result.beats).toEqual([0, 810, 1_620, 2_430, 3_240, 4_050, 4_860]);
    expect(result.insertedCount).toBe(2);
  });
});

describe("collapseSplitMergedBeats", () => {
  it("removes a short+long split artifact that sums to one normal RR", () => {
    const result = collapseSplitMergedBeats([0, 820, 1_640, 2_050, 2_460, 3_280]);
    expect(result.beats).toEqual([0, 820, 1_640, 2_460, 3_280]);
    expect(result.removedCount).toBe(1);
  });
});

describe("stabilizeAlternatingJitterBeats", () => {
  it("shifts the middle beat when adjacent RR zig-zag around one local rhythm", () => {
    const before = [0, 840, 1_730, 2_540, 3_410];
    const result = stabilizeAlternatingJitterBeats(before);
    const beforeLeft = before[2]! - before[1]!;
    const beforeRight = before[3]! - before[2]!;
    const afterLeft = result.beats[2]! - result.beats[1]!;
    const afterRight = result.beats[3]! - result.beats[2]!;
    expect(result.adjustedCount).toBe(1);
    expect(Math.abs(afterLeft - afterRight)).toBeLessThan(Math.abs(beforeLeft - beforeRight));
  });

  it("does not flatten a same-direction respiratory drift", () => {
    const result = stabilizeAlternatingJitterBeats([0, 820, 1_700, 2_640, 3_640]);
    expect(result.beats).toEqual([0, 820, 1_700, 2_640, 3_640]);
    expect(result.adjustedCount).toBe(0);
  });
});
