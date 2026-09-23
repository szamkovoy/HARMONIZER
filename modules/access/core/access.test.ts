import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/ui/testMode", () => ({
  HARMONIZER_TEST_MODE: false,
}));

import { canUseFeatureForAccess, getEffectiveAccess } from "./access";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

describe("canUseFeatureForAccess", () => {
  it("denies webinars during active trial (same as free paywall)", () => {
    const access = getEffectiveAccess({
      membership_tier: "free",
      membership_expires_at: null,
      trial_expires_at: FUTURE,
    });
    expect(access.isTrial).toBe(true);
    expect(access.tier).toBe("master");
    expect(canUseFeatureForAccess(access, "breath_practices")).toBe(true);
    expect(canUseFeatureForAccess(access, "webinar_community")).toBe(false);
  });

  it("allows webinars for paid master", () => {
    const access = getEffectiveAccess({
      membership_tier: "master",
      membership_expires_at: FUTURE,
      trial_expires_at: PAST,
    });
    expect(access.isTrial).toBe(false);
    expect(canUseFeatureForAccess(access, "webinar_community")).toBe(true);
  });

  it("replaces an active demo with the paid plan", () => {
    const oracle = getEffectiveAccess({
      membership_tier: "oracle",
      membership_expires_at: FUTURE,
      trial_expires_at: FUTURE,
    });
    expect(oracle.isTrial).toBe(false);
    expect(oracle.tier).toBe("oracle");
    expect(canUseFeatureForAccess(oracle, "assistant_dialog")).toBe(true);
    expect(canUseFeatureForAccess(oracle, "webinar_community")).toBe(false);

    const master = getEffectiveAccess({
      membership_tier: "master",
      membership_expires_at: FUTURE,
      trial_expires_at: FUTURE,
    });
    expect(master.isTrial).toBe(false);
    expect(master.tier).toBe("master");
    expect(canUseFeatureForAccess(master, "webinar_community")).toBe(true);
  });

  it("keeps demo when a paid grant has already expired", () => {
    const access = getEffectiveAccess({
      membership_tier: "master",
      membership_expires_at: PAST,
      trial_expires_at: FUTURE,
    });
    expect(access.isTrial).toBe(true);
    expect(access.tier).toBe("master");
    expect(canUseFeatureForAccess(access, "webinar_community")).toBe(false);
  });

  it("denies webinars for free navigator", () => {
    const access = getEffectiveAccess({
      membership_tier: "free",
      membership_expires_at: null,
      trial_expires_at: PAST,
    });
    expect(canUseFeatureForAccess(access, "webinar_community")).toBe(false);
  });
});
