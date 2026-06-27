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
    expect(result.beatTimestampsMs).toEqual([3000]);
    expect(result.lastBeatTimestampMs).toBe(3000);
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
});
