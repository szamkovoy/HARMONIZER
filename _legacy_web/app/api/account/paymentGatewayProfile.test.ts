import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeBillingCountry, resolvePaymentGateway } from "./paymentGatewayProfile";

const ENV_KEYS = [
  "PAYMENT_LAVATOP_ENABLED",
  "PAYMENT_LAVATOP_REGION",
  "PAYMENT_YOOKASSA_ENABLED",
  "PAYMENT_YOOKASSA_REGION",
] as const;

let snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  snapshot = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
});

describe("resolvePaymentGateway", () => {
  it("prefers RU gateway for RU country", () => {
    process.env.PAYMENT_LAVATOP_ENABLED = "true";
    process.env.PAYMENT_LAVATOP_REGION = "INT";
    process.env.PAYMENT_YOOKASSA_ENABLED = "true";
    process.env.PAYMENT_YOOKASSA_REGION = "RU";
    expect(resolvePaymentGateway({ country: "RU", currency: "RUB" })).toEqual({
      ok: true,
      provider: "yookassa",
      matchedRegion: "RU",
    });
  });

  it("falls back to INT when RU gateway disabled", () => {
    process.env.PAYMENT_LAVATOP_ENABLED = "true";
    process.env.PAYMENT_LAVATOP_REGION = "INT";
    process.env.PAYMENT_YOOKASSA_ENABLED = "false";
    process.env.PAYMENT_YOOKASSA_REGION = "RU";
    expect(resolvePaymentGateway({ country: "RU", currency: "RUB" })).toEqual({
      ok: true,
      provider: "lavatop",
      matchedRegion: "INT",
    });
  });

  it("uses INT for non-RU", () => {
    process.env.PAYMENT_LAVATOP_ENABLED = "true";
    process.env.PAYMENT_LAVATOP_REGION = "INT";
    process.env.PAYMENT_YOOKASSA_ENABLED = "true";
    process.env.PAYMENT_YOOKASSA_REGION = "RU";
    expect(resolvePaymentGateway({ country: "DE", currency: "EUR" })).toEqual({
      ok: true,
      provider: "lavatop",
      matchedRegion: "INT",
    });
  });

  it("fail-closed when no gateway enabled", () => {
    process.env.PAYMENT_LAVATOP_ENABLED = "false";
    process.env.PAYMENT_LAVATOP_REGION = "INT";
    process.env.PAYMENT_YOOKASSA_ENABLED = "false";
    process.env.PAYMENT_YOOKASSA_REGION = "RU";
    expect(resolvePaymentGateway({ country: "RU", currency: "RUB" })).toEqual({
      ok: false,
      error: "payment_gateway_unavailable",
    });
  });

  it("ignores legacy YOOKASSA_ENABLED / PAYMENT_GATEWAY_FOR_RUB", () => {
    process.env.PAYMENT_LAVATOP_ENABLED = "true";
    process.env.PAYMENT_LAVATOP_REGION = "INT";
    process.env.PAYMENT_YOOKASSA_ENABLED = "false";
    process.env.PAYMENT_YOOKASSA_REGION = "RU";
    process.env.YOOKASSA_ENABLED = "true";
    process.env.PAYMENT_GATEWAY_FOR_RUB = "yookassa";
    expect(resolvePaymentGateway({ country: "RU", currency: "RUB" })).toEqual({
      ok: true,
      provider: "lavatop",
      matchedRegion: "INT",
    });
    delete process.env.YOOKASSA_ENABLED;
    delete process.env.PAYMENT_GATEWAY_FOR_RUB;
  });

  it("normalizes RUB without country to RU", () => {
    expect(normalizeBillingCountry(null, "RUB")).toBe("RU");
  });
});
