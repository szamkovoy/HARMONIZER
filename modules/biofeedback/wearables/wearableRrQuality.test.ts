import { describe, expect, it } from "vitest";

import {
  deriveBpmFromWearableRrIntervals,
  filterOnBodyWearableRrIntervals,
  isFrozenRrRun,
  isWearableRrIntervalOnBodyPlausible,
  isWearableRrPacketTrustworthy,
  resolveWearableHeartRateBpm,
} from "@/modules/biofeedback/wearables/wearableRrQuality";

describe("wearableRrQuality", () => {
  it("accepts normal chest-strap RR", () => {
    expect(isWearableRrIntervalOnBodyPlausible(780)).toBe(true);
    expect(isWearableRrPacketTrustworthy([779, 788, 823])).toBe(true);
  });

  it("rejects a fully off-body garbage burst (no plausible RR)", () => {
    // Strap off skin → Polar streams a sustained sub-350 ms burst. Nothing usable → reject.
    const offBody = [300, 300, 320, 339, 300, 310, 300];
    expect(isWearableRrPacketTrustworthy(offBody)).toBe(false);
    expect(filterOnBodyWearableRrIntervals(offBody)).toEqual([]);
  });

  it("accepts high-HR exercise RR down to 171 bpm (350 ms)", () => {
    // Push-up test peaked ~134 bpm (≈448 ms); the old 450 ms floor discarded these real beats.
    expect(filterOnBodyWearableRrIntervals([448, 400, 375, 350])).toEqual([448, 400, 375, 350]);
    expect(isWearableRrPacketTrustworthy([448, 400, 375])).toBe(true);
  });

  it("keeps good RR and drops a single implausible interval instead of the whole packet", () => {
    // One missed/merged beat (giant RR) inside an otherwise clean packet must NOT discard it —
    // this was the source of the spurious BLE signal-loss gaps.
    expect(isWearableRrPacketTrustworthy([500, 1300, 561, 11615])).toBe(true);
    expect(filterOnBodyWearableRrIntervals([500, 1300, 561, 11615])).toEqual([500, 1300, 561]);
    expect(filterOnBodyWearableRrIntervals([520, 8685, 500])).toEqual([520, 500]);
  });

  it("prefers RR-derived BPM when raw HR disagrees after recovery", () => {
    const rrBpm = deriveBpmFromWearableRrIntervals([869, 870, 869]);
    expect(Math.round(rrBpm ?? 0)).toBe(69);
    expect(Math.round(resolveWearableHeartRateBpm(163, rrBpm) ?? 0)).toBe(69);
  });

  it("detects an off-body frozen RR run (Polar H10 lifted off chest)", () => {
    // Field test 1783096820335: after the strap was lifted it streamed a run of exact 659 ms RR
    // (bogus 91 bpm). Range filtering passes 659 ms; only run-level variance detects off-body.
    const frozen = [659, 659, 659, 659, 659, 659, 659];
    expect(isFrozenRrRun(frozen)).toBe(true);
  });

  it("does not flag low-HRV on-body RR as frozen", () => {
    // Real resting RR vary beat-to-beat by ~10–30 ms even at low HRV — must NOT trip the detector.
    const lowHrv = [812, 826, 819, 833, 821, 828, 815];
    expect(isFrozenRrRun(lowHrv)).toBe(false);
  });

  it("requires the minimum run length before flagging frozen", () => {
    expect(isFrozenRrRun([659, 659, 659])).toBe(false);
  });

  it("clears the frozen flag once real variability returns", () => {
    const recent = [659, 659, 659, 659, 659, 659, 712, 698, 705, 690];
    // Tail of 6 (712,698,705,690,...) varies → not frozen anymore.
    expect(isFrozenRrRun(recent)).toBe(false);
  });
});
