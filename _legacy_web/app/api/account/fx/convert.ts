import { amountAfterFee } from "./gatewayFees";
import type { FxCurrency, PaymentNets, QuoteBook } from "./types";

const CBR_HAIRCUT = 0.98;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function pairKey(base: FxCurrency, quote: FxCurrency): string {
  return `${base}/${quote}`;
}

/**
 * Convert `amount` from `from` to `to` using bank buy/sell quotes.
 * - Direct `from/to`: bank buys `from` → amount * buy
 * - Inverse `to/from`: bank sells `from` (priced in to) → amount / sell
 * - Cross (neither RUB): via RUB
 */
export function convertAmount(
  amount: number,
  from: FxCurrency,
  to: FxCurrency,
  book: QuoteBook,
): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return amount;

  const direct = book.pairs[pairKey(from, to)];
  if (direct?.buy && direct.buy > 0) return amount * direct.buy;

  const inverse = book.pairs[pairKey(to, from)];
  if (inverse?.sell && inverse.sell > 0) return amount / inverse.sell;

  if (from !== "RUB" && to !== "RUB") {
    const rub = convertAmount(amount, from, "RUB", book);
    return convertAmount(rub, "RUB", to, book);
  }

  throw new Error(`Missing FX quote for ${from}→${to} (source=${book.source})`);
}

export function computePaymentNets(
  grossAmount: number,
  currency: FxCurrency,
  feeRate: number,
  book: QuoteBook,
): PaymentNets {
  const afterFee = amountAfterFee(grossAmount, feeRate);
  const haircut = book.source === "cbr" ? CBR_HAIRCUT : 1;

  const rub = convertAmount(afterFee, currency, "RUB", book) * haircut;
  const eur = convertAmount(afterFee, currency, "EUR", book) * haircut;
  const usd = convertAmount(afterFee, currency, "USD", book) * haircut;

  return {
    net_amount_rub: roundMoney(rub),
    net_amount_eur: roundMoney(eur),
    net_amount_usd: roundMoney(usd),
    fx_source: book.source,
    fee_rate: feeRate,
    amount_after_fee: roundMoney(afterFee),
  };
}

export function normalizeFxCurrency(raw: string | null | undefined): FxCurrency | null {
  const c = (raw ?? "").trim().toUpperCase();
  if (c === "RUB" || c === "USD" || c === "EUR") return c;
  if (c === "RUR") return "RUB";
  return null;
}
