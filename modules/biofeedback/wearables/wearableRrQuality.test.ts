import { describe, expect, it } from "vitest";

import {
  deriveBpmFromWearableRrIntervals,
  filterOnBodyWearableRrIntervals,
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
});
