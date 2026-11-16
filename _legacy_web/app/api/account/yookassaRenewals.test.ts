import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./yookassa", () => ({ chargeYookassaSavedMethod: vi.fn() }));
vi.mock("./fulfillPaymentContract", () => ({ fulfillYookassaRenewal: vi.fn() }));
vi.mock("./paymentAlerts", () => ({ sendPaymentAlert: vi.fn() }));
vi.mock("./paymentEvents", () => ({ logPaymentEvent: vi.fn() }));

import { chargeYookassaSavedMethod } from "./yookassa";
import { fulfillYookassaRenewal } from "./fulfillPaymentContract";
import { logPaymentEvent } from "./paymentEvents";
import { runYookassaRenewals } from "./yookassaRenewals";

const due = {
  contract_id: "contract", user_id: "user", tier: "oracle", amount: 3000,
  currency: "RUB", current_period_end: "2026-11-17T12:00:00Z",
  payment_method_id: "method", renew_fail_count: 0,
};
function dbStub() {
  const rpc = vi.fn().mockResolvedValue({ data: { cancelled: false, failCount: 1 }, error: null });
  return {
    rpc,
    from(table: string) {
      const result = { data: table === "payment_contracts" ? [due] : { status: "active" }, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not", "lte", "gte", "limit", "maybeSingle"]) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  };
}
beforeEach(() => vi.clearAllMocks());

describe("YooKassa renewal runner", () => {
  it("does not count an uncertain network result as a failed charge", async () => {
    vi.mocked(chargeYookassaSavedMethod).mockRejectedValue(new Error("network timeout"));
    const db = dbStub();
    await runYookassaRenewals(db as unknown as SupabaseClient);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(logPaymentEvent).toHaveBeenCalledWith(db, expect.objectContaining({
      eventType: "yookassa.renewal.error", status: "unknown",
    }));
  });
  it("counts a confirmed cancellation using its payment id", async () => {
    vi.mocked(chargeYookassaSavedMethod).mockResolvedValue({ id: "charge", status: "canceled" });
    const db = dbStub();
    await runYookassaRenewals(db as unknown as SupabaseClient);
    expect(db.rpc).toHaveBeenCalledWith("record_yookassa_renewal_failure", expect.objectContaining({
      p_payment_id: "charge", p_period_key: due.current_period_end,
    }));
  });
  it("passes the charged period to fulfillment rather than shortening it", async () => {
    vi.mocked(chargeYookassaSavedMethod).mockResolvedValue({ id: "charge", status: "succeeded", paid: true });
    const db = dbStub();
    await runYookassaRenewals(db as unknown as SupabaseClient);
    expect(fulfillYookassaRenewal).toHaveBeenCalledWith(db, expect.objectContaining({ periodKey: due.current_period_end }));
  });
});
