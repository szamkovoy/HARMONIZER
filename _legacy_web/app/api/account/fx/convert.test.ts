import { describe, expect, it } from "vitest";
import { computePaymentNets, convertAmount, roundMoney } from "./convert";
import type { QuoteBook } from "./types";

const commercial: QuoteBook = {
  source: "tbank",
  pairs: {
    "USD/RUB": { buy: 73.65, sell: 84.35 },
    "EUR/RUB": { buy: 84.25, sell: 96.5 },
    "USD/EUR": { buy: 0.7668711656, sell: 1.007 },
  },
};

const cbr: QuoteBook = {
  source: "cbr",
  pairs: {
    "USD/RUB": { buy: 78.554, sell: 78.554 },
    "EUR/RUB": { buy: 89.7558, sell: 89.7558 },
  },
};

describe("convertAmount buy/sell", () => {
  it("foreign → RUB uses bank buy", () => {
    expect(convertAmount(100, "EUR", "RUB", commercial)).toBeCloseTo(8425, 5);
    expect(convertAmount(100, "USD", "RUB", commercial)).toBeCloseTo(7365, 5);
  });

  it("RUB → foreign uses bank sell", () => {
    expect(convertAmount(100, "RUB", "EUR", commercial)).toBeCloseTo(100 / 96.5, 8);
    expect(convertAmount(100, "RUB", "USD", commercial)).toBeCloseTo(100 / 84.35, 8);
  });

  it("USD ↔ EUR uses direct pair when present", () => {
    expect(convertAmount(100, "USD", "EUR", commercial)).toBeCloseTo(76.68711656, 6);
    expect(convertAmount(100, "EUR", "USD", commercial)).toBeCloseTo(100 / 1.007, 6);
  });

  it("same currency is identity", () => {
    expect(convertAmount(99.99, "EUR", "EUR", commercial)).toBe(99.99);
  });
});

describe("computePaymentNets", () => {
  it("applies gateway fee then commercial FX without 2% haircut", () => {
    // 100 EUR, Lava 8% → 92 EUR after fee → RUB = 92 * 84.25
    const nets = computePaymentNets(100, "EUR", 0.08, commercial);
    expect(nets.amount_after_fee).toBe(92);
    expect(nets.net_amount_eur).toBe(92);
    expect(nets.net_amount_rub).toBe(roundMoney(92 * 84.25));
    expect(nets.fx_source).toBe("tbank");
  });

  it("applies 2% haircut on CBR fallback", () => {
    const nets = computePaymentNets(100, "EUR", 0.08, cbr);
    const afterFee = 92;
    expect(nets.net_amount_eur).toBe(roundMoney(afterFee * 0.98));
    expect(nets.net_amount_rub).toBe(roundMoney(afterFee * 89.7558 * 0.98));
    expect(nets.fx_source).toBe("cbr");
  });

  it("RUB payment: nets use sell for EUR/USD", () => {
    const nets = computePaymentNets(100, "RUB", 0.08, commercial);
    expect(nets.net_amount_rub).toBe(92);
    expect(nets.net_amount_eur).toBe(roundMoney(92 / 96.5));
    expect(nets.net_amount_usd).toBe(roundMoney(92 / 84.35));
  });
});
