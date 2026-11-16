import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { applySubscriptionRenewal, renewalPeriodEnd } from "./subscriptionRenewal";

describe("renewal period", () => {
  it("keeps the remaining 36 hours when YooKassa charges early", () => {
    expect(renewalPeriodEnd("2026-11-16T00:00:00Z", "2026-11-17T12:00:00Z"))
      .toBe("2026-12-17T12:00:00.000Z");
  });
  it("starts a late renewal from the payment date", () => {
    expect(renewalPeriodEnd("2026-11-18T12:00:00Z", "2026-11-17T12:00:00Z"))
      .toBe("2026-12-18T12:00:00.000Z");
  });
  it("uses an immutable payment timestamp for Lava and old YooKassa events", () => {
    expect(renewalPeriodEnd("2026-11-16T00:00:00Z")).toBe("2026-12-16T00:00:00.000Z");
  });
  it("rejects a corrupt timestamp instead of inventing a new period on every retry", () => {
    expect(() => renewalPeriodEnd("bad")).toThrow();
    expect(() => renewalPeriodEnd("2026-11-16T00:00:00Z", "bad")).toThrow();
  });
  it("does not acknowledge an atomic activation failure", async () => {
    const error = { message: "database unavailable" };
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error }) };
    await expect(applySubscriptionRenewal(db as unknown as SupabaseClient, {
      contractId: "contract", paidAt: "2026-11-16T00:00:00Z",
    })).rejects.toEqual(error);
  });
});
