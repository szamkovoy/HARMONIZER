import { describe, expect, it } from "vitest";

import { computeMasterBonusDays, periodEndWithBonusDays } from "./upgradeCredit";

describe("computeMasterBonusDays", () => {
  it("converts half Mentor month at 950→4950 into floor days", () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const periodEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString();
    // 15 * 950/4950 ≈ 2.87 → 2
    expect(
      computeMasterBonusDays({
        periodEndIso: periodEnd,
        oracleAmount: 950,
        masterAmount: 4950,
        now,
      }),
    ).toBe(2);
  });

  it("returns 0 when period already ended", () => {
    expect(
      computeMasterBonusDays({
        periodEndIso: "2026-07-01T00:00:00.000Z",
        oracleAmount: 950,
        masterAmount: 4950,
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toBe(0);
  });
});

describe("periodEndWithBonusDays", () => {
  it("adds 30d + bonus", () => {
    const from = new Date("2026-08-01T00:00:00.000Z");
    const end = periodEndWithBonusDays(from, 3);
    expect(end.getTime() - from.getTime()).toBe((30 + 3) * 24 * 60 * 60 * 1000);
  });
});
