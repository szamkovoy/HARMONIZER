import { describe, expect, it, vi } from "vitest";
import { getUserTimezone, todayLocalDate } from "./forecast-cache-date";

describe("todayLocalDate", () => {
  it("returns correct date for UTC", () => {
    expect(todayLocalDate("UTC", new Date("2026-04-29T15:30:00.000Z"))).toBe("2026-04-29");
  });

  it("returns correct date for Europe/Prague near UTC midnight (DST +2 in April)", () => {
    // 29 Apr 23:30 UTC = 30 Apr 01:30 in Prague (CEST)
    expect(todayLocalDate("Europe/Prague", new Date("2026-04-29T23:30:00.000Z"))).toBe("2026-04-30");
  });

  it("returns correct date for Asia/Tokyo near UTC midnight", () => {
    // 29 Apr 18:00 UTC = 30 Apr 03:00 in Tokyo (JST +9)
    expect(todayLocalDate("Asia/Tokyo", new Date("2026-04-29T18:00:00.000Z"))).toBe("2026-04-30");
  });

  it("returns correct date for America/Los_Angeles when UTC has crossed local midnight", () => {
    // 29 Apr 02:00 UTC = 28 Apr 19:00 in LA (PDT, UTC-7 in April)
    expect(todayLocalDate("America/Los_Angeles", new Date("2026-04-29T02:00:00.000Z"))).toBe("2026-04-28");
  });

  it("uses fake system time when no explicit instant is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T23:30:00.000Z"));
    try {
      expect(todayLocalDate("Europe/Prague")).toBe("2026-04-30");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to UTC for empty timezone", () => {
    expect(todayLocalDate("  ", new Date("2026-04-29T15:30:00.000Z"))).toBe("2026-04-29");
  });
});

describe("getUserTimezone", () => {
  it("returns users.tz when set", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { tz: "Europe/Prague" }, error: null }),
          }),
        }),
      }),
    };
    await expect(getUserTimezone(db as never, "u1")).resolves.toBe("Europe/Prague");
  });

  it("returns UTC when tz is null or blank", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: { tz: null }, error: null }),
          }),
        }),
      }),
    };
    await expect(getUserTimezone(db as never, "u1")).resolves.toBe("UTC");
  });
});
