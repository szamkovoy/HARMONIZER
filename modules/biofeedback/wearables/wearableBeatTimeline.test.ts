import { describe, expect, it } from "vitest";

import { buildBeatTimestampsFromRrPacket } from "@/modules/biofeedback/wearables/wearableBeatTimeline";

describe("buildBeatTimestampsFromRrPacket", () => {
  it("maps one RR per packet to consecutive beats", () => {
    let last: number | null = null;
    const first = buildBeatTimestampsFromRrPacket(1000, [1000], last);
    expect(first.beatTimestampsMs).toEqual([0, 1000]);
    last = first.lastBeatTimestampMs;

    const second = buildBeatTimestampsFromRrPacket(2000, [1000], last);
    expect(second.beatTimestampsMs).toEqual([2000]);
    expect(second.lastBeatTimestampMs).toBe(2000);
  });

  it("expands multiple RR intervals inside one packet backward from now", () => {
    const result = buildBeatTimestampsFromRrPacket(3000, [1000, 1000], null);
    expect(result.beatTimestampsMs).toEqual([1000, 2000, 3000]);
    expect(result.lastBeatTimestampMs).toBe(3000);
  });

  it("dedupes overlap with the previous packet tail", () => {
    const result = buildBeatTimestampsFromRrPacket(
      3000,
      [1000, 1000],
      2000,
    );
    expect(result.beatTimestampsMs).toEqual([3000]);
    expect(result.lastBeatTimestampMs).toBe(3000);
  });

  it("does not re-insert historical beats from multi-RR Polar packets", () => {
    const result = buildBeatTimestampsFromRrPacket(3000, [837, 795], 2000);
    expect(result.beatTimestampsMs).toEqual([2795]);
    expect(result.lastBeatTimestampMs).toBe(2795);
  });

  it("ignores stale last beat after timeline reset", () => {
    const result = buildBeatTimestampsFromRrPacket(
      30_000,
      [1000],
      1000,
      { resetTimeline: true },
    );
    expect(result.beatTimestampsMs).toEqual([29_000, 30_000]);
    expect(result.lastBeatTimestampMs).toBe(30_000);
  });

  it("commits two genuinely new beats when packet spans missed notifies", () => {
    const result = buildBeatTimestampsFromRrPacket(10_000, [995, 1005], 7_800);
    expect(result.beatTimestampsMs).toEqual([8_795, 9_800]);
    expect(result.lastBeatTimestampMs).toBe(9_800);
  });

  it("prefers RR continuity over notify arrival jitter", () => {
    let last: number | null = null;
    const first = buildBeatTimestampsFromRrPacket(1_060, [800], last);
    expect(first.beatTimestampsMs).toEqual([260, 1060]);
    last = first.lastBeatTimestampMs;

    const second = buildBeatTimestampsFromRrPacket(2_040, [795], last);
    expect(second.beatTimestampsMs).toEqual([1855]);
    expect(second.lastBeatTimestampMs).toBe(1855);

    const third = buildBeatTimestampsFromRrPacket(3_030, [837, 795], second.lastBeatTimestampMs);
    expect(third.beatTimestampsMs).toEqual([2650]);
    expect(third.lastBeatTimestampMs).toBe(2650);
  });
});
