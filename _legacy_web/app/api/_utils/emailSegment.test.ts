import { describe, expect, it } from "vitest";

import {
  hasEmailSegmentAudience,
  normalizeEmailSegmentAudience,
  parseEmailSegmentQuery,
} from "./emailSegment";

describe("emailSegment audience", () => {
  it("treats email_contains alone as all_contacts (whole base)", () => {
    const q = parseEmailSegmentQuery({ email_contains: "sezam" });
    expect(q.email_contains).toBe("sezam");
    expect(q.all_contacts).toBe(true);
    expect(q.all_installed).toBeFalsy();
    expect(hasEmailSegmentAudience(q)).toBe(true);
  });

  it("keeps empty audience without email filter", () => {
    const q = parseEmailSegmentQuery({
      all_contacts: false,
      all_installed: false,
      membership_tiers: [],
    });
    expect(hasEmailSegmentAudience(q)).toBe(false);
    expect(normalizeEmailSegmentAudience(q).all_contacts).toBeFalsy();
  });

  it("does not override explicit tier chips when email_contains set", () => {
    const q = parseEmailSegmentQuery({
      email_contains: "sezam",
      membership_tiers: ["free"],
      all_installed: false,
      all_contacts: false,
    });
    expect(q.all_contacts).toBeFalsy();
    expect(q.all_installed).toBe(false);
    expect(q.membership_tiers).toEqual(["free"]);
  });

  it("keeps all_installed exclusive of all_contacts", () => {
    const q = parseEmailSegmentQuery({ all_installed: true, all_contacts: true });
    expect(q.all_contacts).toBe(true);
    expect(q.all_installed).toBe(false);
  });
});
