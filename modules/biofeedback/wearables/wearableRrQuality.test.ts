import { describe, expect, it } from "vitest";

import {
  filterOnBodyWearableRrIntervals,
  isWearableRrIntervalOnBodyPlausible,
  isWearableRrPacketTrustworthy,
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
});
