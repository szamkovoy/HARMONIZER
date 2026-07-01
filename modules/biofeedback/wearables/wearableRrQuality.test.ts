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

  it("rejects off-body garbage RR bursts", () => {
    const offBody = [643, 732, 732, 732, 732, 387, 339, 360, 300, 300];
    expect(isWearableRrPacketTrustworthy(offBody)).toBe(false);
    expect(filterOnBodyWearableRrIntervals(offBody)).toEqual([643, 732, 732, 732, 732]);
  });

  it("rejects reconnect packets with impossible long RR gaps", () => {
    expect(isWearableRrPacketTrustworthy([500, 1300, 561, 11615])).toBe(false);
  });

  it("prefers RR-derived BPM when raw HR disagrees after recovery", () => {
    const rrBpm = deriveBpmFromWearableRrIntervals([869, 870, 869]);
    expect(Math.round(rrBpm ?? 0)).toBe(69);
    expect(Math.round(resolveWearableHeartRateBpm(163, rrBpm) ?? 0)).toBe(69);
  });
});
