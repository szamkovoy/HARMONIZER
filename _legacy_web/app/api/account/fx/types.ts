export type FxCurrency = "RUB" | "USD" | "EUR";

/** `alfabank` kept for legacy settlement rows; live chain is tbank → cbr. */
export type FxSource = "tbank" | "alfabank" | "cbr";

/** Buy/sell for 1 unit of `base` in `quote` (e.g. USD/RUB). */
export type PairQuote = {
  buy: number;
  sell: number;
};

export type QuoteBook = {
  source: FxSource;
  /** Keys like `USD/RUB`, `EUR/RUB`, `USD/EUR`. */
  pairs: Record<string, PairQuote>;
};

export type PaymentNets = {
  net_amount_rub: number;
  net_amount_eur: number;
  net_amount_usd: number;
  fx_source: FxSource;
  fee_rate: number;
  amount_after_fee: number;
};

export type GatewayProvider = "lavatop" | "yandex";
