import { describe, expect, it } from "vitest";

import { subscriptionIsLive, subscriptionIsVisible } from "./subscriptionLiveness";

const now = new Date("2026-11-13T12:00:00Z");
const iso = (hours: number) => new Date(now.getTime() + hours * 3600_000).toISOString();

describe("subscriptionIsLive", () => {
  it("active inside the paid period or the 48h grace", () => {
    expect(subscriptionIsLive({ status: "active", current_period_end: iso(24) }, now)).toBe(true);
    expect(subscriptionIsLive({ status: "active", current_period_end: iso(-47) }, now)).toBe(true);
  });
  it("active but not renewed past the grace is not live", () => {
    expect(subscriptionIsLive({ status: "active", current_period_end: iso(-49) }, now)).toBe(false);
  });
  it("other statuses are never live", () => {
    expect(subscriptionIsLive({ status: "cancelled", current_period_end: iso(24) }, now)).toBe(false);
    expect(subscriptionIsLive({ status: "pending", current_period_end: iso(24) }, now)).toBe(false);
  });
});

describe("subscriptionIsVisible", () => {
  it("cancelled is shown only until the paid period ends", () => {
    expect(subscriptionIsVisible({ status: "cancelled", current_period_end: iso(1) }, now)).toBe(true);
    expect(subscriptionIsVisible({ status: "cancelled", current_period_end: iso(-1) }, now)).toBe(false);
  });
  it("stale active is hidden", () => {
    expect(subscriptionIsVisible({ status: "active", current_period_end: iso(-72) }, now)).toBe(false);
  });
});
