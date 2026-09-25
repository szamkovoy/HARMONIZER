import { describe, expect, it } from "vitest";

import {
  accessGrantKind,
  isLongTermMaster,
  type MailUserAccess,
} from "./emailCampaignAccessWindow";

const NOW = Date.parse("2026-09-24T17:00:00.000Z");

function user(partial: Partial<MailUserAccess>): MailUserAccess {
  return {
    membership_tier: "free",
    membership_expires_at: null,
    trial_expires_at: null,
    app_first_open_at: null,
    last_seen_at: null,
    onboarded_at: null,
    ...partial,
  };
}

describe("campaign access window", () => {
  it("leaves never-opened contacts alone so the first sign-in can grant 24h", () => {
    expect(accessGrantKind(user({}), NOW)).toBeNull();
  });

  it("gives installed navigators a trial and leaves a running demo on its clock", () => {
    expect(
      accessGrantKind(user({ app_first_open_at: "2026-08-01T00:00:00.000Z" }), NOW),
    ).toBe("trial");
    expect(
      accessGrantKind(
        user({
          app_first_open_at: "2026-09-24T10:00:00.000Z",
          trial_expires_at: "2026-09-25T10:00:00.000Z",
        }),
        NOW,
      ),
    ).toBeNull();
  });

  it("upgrades an active mentor and skips a long-term master", () => {
    expect(
      accessGrantKind(
        user({
          membership_tier: "oracle",
          membership_expires_at: "2026-10-20T00:00:00.000Z",
          app_first_open_at: "2026-08-01T00:00:00.000Z",
        }),
        NOW,
      ),
    ).toBe("master");
    const paidMaster = user({
      membership_tier: "master",
      membership_expires_at: "2026-12-01T00:00:00.000Z",
    });
    expect(isLongTermMaster(paidMaster, NOW)).toBe(true);
    expect(accessGrantKind(paidMaster, NOW)).toBeNull();
  });

  it("does not treat the 30-hour master window as a paid master", () => {
    const temporary = user({
      membership_tier: "master",
      membership_expires_at: "2026-09-26T00:00:00.000Z",
      app_first_open_at: "2026-08-01T00:00:00.000Z",
    });
    expect(isLongTermMaster(temporary, NOW)).toBe(false);
    expect(accessGrantKind(temporary, NOW)).toBeNull();
  });
});
