import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLavaOneTimeInvoice, createLavaSubscriptionInvoice, LavaInvoiceError } from "./lava";

const OK = {
  id: "inv-1",
  status: "new",
  paymentUrl: "https://lava.example/pay",
  amountTotal: { amount: 10, currency: "EUR" },
};

const RETURN_URLS = {
  successUrl: "https://harmonizer.example/ok",
  failureUrl: "https://harmonizer.example/fail",
  cancelUrl: "https://harmonizer.example/cancel",
};

function jsonResponse(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

describe("lava invoice v3", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.LAVATOP_API_KEY = "test-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function pathOf(call: number): string {
    return new URL(String(fetchMock.mock.calls[call][0])).pathname;
  }

  function bodyOf(call: number): Record<string, unknown> {
    return JSON.parse(String(fetchMock.mock.calls[call][1].body)) as Record<string, unknown>;
  }

  it("creates a one-time invoice on v3 and sends PayPal as paymentProvider", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, OK));
    const result = await createLavaOneTimeInvoice({
      email: "A@Example.com",
      offerId: "offer-1",
      currency: "EUR",
      locale: "de",
      paymentMethod: "PAYPAL",
      ...RETURN_URLS,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pathOf(0)).toBe("/api/v3/invoice");
    expect(bodyOf(0).paymentProvider).toBe("PAYPAL");
    expect(bodyOf(0)).not.toHaveProperty("paymentMethod");
    expect(bodyOf(0).periodicity).toBe("ONE_TIME");
    expect(result.id).toBe("inv-1");
  });

  it.each([400, 404, 500])("retries a subscription invoice on v2 when v3 returns %s", async (status) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(status, { error: "nope" }))
      .mockResolvedValueOnce(jsonResponse(201, { ...OK, id: "from-v2" }));
    const result = await createLavaSubscriptionInvoice({
      email: "a@example.com",
      offerId: "offer-1",
      currency: "EUR",
      locale: "en",
      paymentMethod: "PAYPAL",
      ...RETURN_URLS,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pathOf(0)).toBe("/api/v3/invoice");
    expect(pathOf(1)).toBe("/api/v2/invoice");
    expect(bodyOf(1).paymentMethod).toBe("PAYPAL");
    expect(bodyOf(1)).not.toHaveProperty("paymentProvider");
    expect(bodyOf(1).periodicity).toBe("MONTHLY");
    expect(result.id).toBe("from-v2");
    expect(console.warn).toHaveBeenCalledWith(
      "[lava] v3 invoice failed, falling back to v2",
      status,
      expect.any(String),
    );
  });

  it("rejects an incorrect email from v3 without calling v2", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Incorrect email to purchase" }));
    const error = await createLavaOneTimeInvoice({
      email: "a@example.com",
      offerId: "offer-1",
      currency: "EUR",
      locale: "ru",
      paymentMethod: "PAYPAL",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LavaInvoiceError);
    expect((error as LavaInvoiceError).code).toBe("lava_buyer_email_rejected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pathOf(0)).toBe("/api/v3/invoice");
  });

  it("omits the provider for RUB on both v3 and v2", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, "down"))
      .mockResolvedValueOnce(jsonResponse(201, OK));
    await createLavaOneTimeInvoice({
      email: "a@example.com",
      offerId: "offer-1",
      currency: "RUB",
      locale: "ru",
      paymentMethod: "PAYPAL",
      ...RETURN_URLS,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of [0, 1]) {
      expect(bodyOf(call)).not.toHaveProperty("paymentProvider");
      expect(bodyOf(call)).not.toHaveProperty("paymentMethod");
    }
    expect(pathOf(0)).toBe("/api/v3/invoice");
    expect(pathOf(1)).toBe("/api/v2/invoice");
  });

  it("sends the return urls in both invoice calls", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, "missing"))
      .mockResolvedValueOnce(jsonResponse(201, OK));
    await createLavaSubscriptionInvoice({
      email: "a@example.com",
      offerId: "offer-1",
      currency: "EUR",
      locale: "en",
      paymentMethod: "UNLIMINT",
      ...RETURN_URLS,
    });
    for (const call of [0, 1]) {
      expect(bodyOf(call).successful_return_url).toBe(RETURN_URLS.successUrl);
      expect(bodyOf(call).failure_return_url).toBe(RETURN_URLS.failureUrl);
      expect(bodyOf(call).cancel_return_url).toBe(RETURN_URLS.cancelUrl);
    }
  });
});
