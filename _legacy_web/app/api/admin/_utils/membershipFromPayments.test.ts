import { describe, expect, it } from "vitest";
import { selectActiveMembershipFromPayments } from "./membershipFromPayments";

const NOW = new Date("2026-07-10T12:00:00.000Z");

describe("selectActiveMembershipFromPayments", () => {
  it("returns null when the only payment is expired", () => {
    expect(
      selectActiveMembershipFromPayments(
        [{ tier: "master", paid_until: "2026-07-09T02:15:00.000Z", created_at: "2026-07-08T17:52:00.000Z" }],
        NOW,
      ),
    ).toBeNull();
  });

  it("picks the still-active payment when a newer one is expired", () => {
    expect(
      selectActiveMembershipFromPayments(
        [
          { tier: "master", paid_until: "2026-07-01T00:00:00.000Z", created_at: "2026-07-09T10:00:00.000Z" },
          { tier: "practitioner", paid_until: "2026-08-01T00:00:00.000Z", created_at: "2026-07-01T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toEqual({ tier: "practitioner", paid_until: "2026-08-01T00:00:00.000Z" });
  });

  it("prefers higher tier among overlapping active payments", () => {
    expect(
      selectActiveMembershipFromPayments(
        [
          { tier: "oracle", paid_until: "2026-09-01T00:00:00.000Z", created_at: "2026-07-09T10:00:00.000Z" },
          { tier: "master", paid_until: "2026-08-01T00:00:00.000Z", created_at: "2026-07-01T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toEqual({ tier: "master", paid_until: "2026-08-01T00:00:00.000Z" });
  });

  it("prefers later paid_until when tiers are equal; null wins", () => {
    expect(
      selectActiveMembershipFromPayments(
        [
          { tier: "oracle", paid_until: "2026-08-01T00:00:00.000Z", created_at: "2026-07-09T10:00:00.000Z" },
          { tier: "oracle", paid_until: "2026-09-01T00:00:00.000Z", created_at: "2026-07-01T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toEqual({ tier: "oracle", paid_until: "2026-09-01T00:00:00.000Z" });

    expect(
      selectActiveMembershipFromPayments(
        [
          { tier: "oracle", paid_until: "2026-09-01T00:00:00.000Z", created_at: "2026-07-09T10:00:00.000Z" },
          { tier: "oracle", paid_until: null, created_at: "2026-07-01T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toEqual({ tier: "oracle", paid_until: null });
  });

  it("breaks remaining ties by newer created_at", () => {
    expect(
      selectActiveMembershipFromPayments(
        [
          { tier: "practitioner", paid_until: "2026-08-01T00:00:00.000Z", created_at: "2026-07-01T10:00:00.000Z" },
          { tier: "practitioner", paid_until: "2026-08-01T00:00:00.000Z", created_at: "2026-07-05T10:00:00.000Z" },
        ],
        NOW,
      ),
    ).toEqual({ tier: "practitioner", paid_until: "2026-08-01T00:00:00.000Z" });
  });
});
