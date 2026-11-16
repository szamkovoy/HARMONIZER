import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../../../_utils/supabase", () => ({
  createServiceSupabase: vi.fn(),
  json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  errorResponse: () => Response.json({ error: "failed" }, { status: 500 }),
}));
vi.mock("../../yookassa", () => ({ fetchYookassaPayment: vi.fn() }));
vi.mock("../../fulfillPaymentContract", () => ({
  findPaymentContract: vi.fn(), fulfillFirstPaymentSuccess: vi.fn(), fulfillYookassaRenewal: vi.fn(),
  markContractCancelled: vi.fn(), markContractFailed: vi.fn(), yookassaFailureReason: vi.fn(),
}));
vi.mock("../../yookassaRenewals", () => ({ handleYookassaRenewalFailure: vi.fn() }));

import { createServiceSupabase } from "../../../_utils/supabase";
import { fetchYookassaPayment } from "../../yookassa";
import { findPaymentContract, fulfillYookassaRenewal } from "../../fulfillPaymentContract";
import { handleYookassaRenewalFailure } from "../../yookassaRenewals";
import { POST } from "./route";

function notification(event: string, metadata = {}) {
  return new Request("https://example.test/webhook", {
    method: "POST", body: JSON.stringify({ event, object: { id: "payment", metadata } }),
  });
}

beforeEach(() => vi.resetAllMocks());
describe("verified YooKassa renewal notifications", () => {
  it("does not trust contract metadata supplied only by the caller", async () => {
    vi.mocked(fetchYookassaPayment).mockResolvedValue({ id: "payment", status: "succeeded" });
    const response = await POST(notification("payment.succeeded", { contractId: "forged", kind: "renewal" }));
    expect(response.status).toBe(200);
    expect(findPaymentContract).not.toHaveBeenCalled();
  });
  it("does not treat a forged canceled event as a confirmed failed payment", async () => {
    vi.mocked(fetchYookassaPayment).mockResolvedValue({
      id: "payment", status: "pending", metadata: { contractId: "contract", kind: "renewal" },
    });
    vi.mocked(findPaymentContract).mockResolvedValue({
      contract_id: "contract", user_id: "user", status: "active", tier: "oracle",
      product_kind: "subscription", product_ref: null, provider: "yookassa",
    });
    const chain = { update: vi.fn(), eq: vi.fn() };
    chain.update.mockReturnValue(chain); chain.eq.mockResolvedValue({ error: null });
    vi.mocked(createServiceSupabase).mockReturnValue({ from: () => chain } as never);
    await POST(notification("payment.canceled"));
    expect(handleYookassaRenewalFailure).not.toHaveBeenCalled();
  });
  it("does not re-enable a cancelled saved method when a paid renewal arrives late", async () => {
    vi.mocked(fetchYookassaPayment).mockResolvedValue({
      id: "payment", status: "succeeded", metadata: { contractId: "contract", kind: "renewal", periodKey: "2026-11-17T12:00:00Z" },
      payment_method: { id: "method", saved: true },
    });
    vi.mocked(findPaymentContract).mockResolvedValue({
      contract_id: "contract", user_id: "user", status: "cancelled", tier: "oracle",
      product_kind: "subscription", product_ref: null, provider: "yookassa",
    });
    const from = vi.fn(); const chain = { update: vi.fn(), eq: vi.fn() };
    from.mockReturnValue(chain); chain.update.mockReturnValue(chain); chain.eq.mockResolvedValue({ error: null });
    vi.mocked(createServiceSupabase).mockReturnValue({ from } as never);
    vi.mocked(fulfillYookassaRenewal).mockResolvedValue({ ok: true });
    expect((await POST(notification("payment.succeeded"))).status).toBe(200);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["payment_contracts"]);
    expect(fulfillYookassaRenewal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ periodKey: "2026-11-17T12:00:00Z" }));
  });
});
