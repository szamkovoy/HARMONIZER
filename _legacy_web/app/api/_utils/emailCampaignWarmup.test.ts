import { describe, expect, it } from "vitest";

import {
  activityMs,
  nextMskHour,
  parseAudienceCap,
  parseWarmupPlan,
  waveSizeAt,
  DEFAULT_WARMUP_SIZES,
} from "./emailCampaignWarmup";

describe("emailCampaignWarmup", () => {
  it("parses default sizes and repeats the last wave", () => {
    const plan = parseWarmupPlan(null);
    expect(plan.sizes).toEqual(DEFAULT_WARMUP_SIZES);
    expect(waveSizeAt(0, plan)).toBe(500);
    expect(waveSizeAt(1, plan)).toBe(500);
    expect(waveSizeAt(2, plan)).toBe(1000);
    expect(waveSizeAt(6, plan)).toBe(3000);
    expect(waveSizeAt(9, plan)).toBe(3000);
  });

  it("picks the next 16:00 Europe/Moscow at least 12 hours away", () => {
    const evening = new Date("2026-09-15T18:00:00.000Z");
    expect(nextMskHour(evening, 16).toISOString()).toBe("2026-09-16T13:00:00.000Z");
    const atSlot = new Date("2026-09-15T13:00:00.000Z");
    expect(nextMskHour(atSlot, 16).toISOString()).toBe("2026-09-16T13:00:00.000Z");
    const justBefore = new Date("2026-09-15T12:55:00.000Z");
    expect(nextMskHour(justBefore, 16).toISOString()).toBe("2026-09-16T13:00:00.000Z");
  });

  it("uses the later of app last_seen and GetCourse activity", () => {
    expect(
      activityMs("2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"),
    ).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
    expect(activityMs(null, null)).toBe(0);
  });

  it("treats empty audience cap as unlimited", () => {
    expect(parseAudienceCap(null)).toBeNull();
    expect(parseAudienceCap(6000)).toBe(6000);
    expect(parseAudienceCap(0)).toBeNull();
  });
});
