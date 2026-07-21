import { describe, expect, it } from "vitest";
import { moscowQuoteDate } from "./providers";

describe("moscowQuoteDate", () => {
  it("returns YYYY-MM-DD in Moscow timezone", () => {
    // 2026-07-21 22:30 UTC = 2026-07-22 01:30 MSK
    expect(moscowQuoteDate(new Date("2026-07-21T22:30:00.000Z"))).toBe("2026-07-22");
    // 2026-07-21 20:30 UTC = 2026-07-21 23:30 MSK
    expect(moscowQuoteDate(new Date("2026-07-21T20:30:00.000Z"))).toBe("2026-07-21");
  });
});
