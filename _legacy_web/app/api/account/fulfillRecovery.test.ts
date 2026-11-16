import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./webinarNotices", () => ({
  ticketWebinarIsPublished: vi.fn().mockResolvedValue(false),
  hasPublishedWebinarForPass: vi.fn(), sendMasterWebinarInvites: vi.fn(),
  sendPassWebinarInvites: vi.fn(), sendWebinarInvites: vi.fn(),
}));
import { fulfillFirstPaymentSuccess } from "./fulfillPaymentContract";

describe("recovery of a cabinet webinar payment", () => {
  const contract = {
    contract_id: "paid", user_id: "buyer", status: "active", tier: "webinar",
    product_kind: "one_time", product_ref: "webinar", provider: "lavatop",
  };
  it("restores the registration before acknowledging an active-contract retry", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const deferred = vi.fn();
    const db = { from: vi.fn().mockReturnValue({ upsert }) };
    await fulfillFirstPaymentSuccess(db as unknown as SupabaseClient, {
      contract, provider: "lavatop", logTag: "test", scheduleSlow: deferred,
    });
    expect(upsert).toHaveBeenCalledWith(
      { webinar_id: "webinar", user_id: "buyer" }, expect.anything(),
    );
    expect(deferred).toHaveBeenCalledOnce();
  });
  it("keeps a registration failure retryable instead of responding success", async () => {
    const error = { message: "temporary database failure" };
    const db = { from: () => ({ upsert: vi.fn().mockResolvedValue({ error }) }) };
    const deferred = vi.fn();
    await expect(fulfillFirstPaymentSuccess(db as unknown as SupabaseClient, {
      contract, provider: "lavatop", logTag: "test", scheduleSlow: deferred,
    })).rejects.toEqual(error);
    expect(deferred).not.toHaveBeenCalled();
  });
});
