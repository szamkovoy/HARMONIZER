import type { SupabaseClient } from "@supabase/supabase-js";

import type { FxCurrency, FxSource, PairQuote, QuoteBook } from "./types";

const FETCH_MS = 8_000;

const TBANK_URL = "https://api.tinkoff.ru/v1/currency_rates";
const TBANK_CATEGORY = "DebitCardsOperations";
const CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js";

type Db = SupabaseClient;

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "HARMONIZER-FX/1.0 (+https://zamkovoi.yoga)",
        ...(init?.headers ?? {}),
      },
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) {
      throw new Error(`Non-JSON body from ${url}`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function putPair(
  pairs: Record<string, PairQuote>,
  base: FxCurrency,
  quote: FxCurrency,
  buy: number,
  sell: number,
) {
  if (!(buy > 0) || !(sell > 0)) return;
  pairs[`${base}/${quote}`] = { buy, sell };
}

function hasRubBook(pairs: Record<string, PairQuote>): boolean {
  return Boolean(pairs["USD/RUB"]?.buy && pairs["EUR/RUB"]?.buy);
}

function currencyName(raw: unknown): FxCurrency | null {
  if (typeof raw === "string") {
    const c = raw.trim().toUpperCase();
    if (c === "RUB" || c === "RUR" || c === "810" || c === "643") return "RUB";
    if (c === "USD" || c === "840") return "USD";
    if (c === "EUR" || c === "978") return "EUR";
    return null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return currencyName(o.name ?? o.code ?? o.iso ?? o.currency ?? o.currencyCode);
  }
  if (typeof raw === "number") {
    if (raw === 643 || raw === 810) return "RUB";
    if (raw === 840) return "USD";
    if (raw === 978) return "EUR";
  }
  return null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Moscow calendar date YYYY-MM-DD — aligns with CBR / RU bank day. */
export function moscowQuoteDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parseStoredPairs(raw: unknown): Record<string, PairQuote> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, PairQuote> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const buy = num((value as { buy?: unknown }).buy);
    const sell = num((value as { sell?: unknown }).sell);
    if (!buy || !sell) continue;
    out[key] = { buy, sell };
  }
  return hasRubBook(out) ? out : null;
}

export async function fetchTbankQuoteBook(): Promise<QuoteBook> {
  const data = (await fetchJson(TBANK_URL)) as {
    resultCode?: string;
    payload?: { rates?: Array<Record<string, unknown>> };
  };
  if (data.resultCode && data.resultCode !== "OK") {
    throw new Error(`T-Bank resultCode=${data.resultCode}`);
  }
  const rates = data.payload?.rates ?? [];
  const pairs: Record<string, PairQuote> = {};
  for (const row of rates) {
    if (row.category !== TBANK_CATEGORY) continue;
    const from = currencyName(row.fromCurrency);
    const to = currencyName(row.toCurrency);
    const buy = num(row.buy);
    const sell = num(row.sell);
    if (!from || !to || !buy || !sell || from === to) continue;
    putPair(pairs, from, to, buy, sell);
  }
  if (!hasRubBook(pairs)) throw new Error("T-Bank: missing USD/EUR RUB quotes");
  return { source: "tbank", pairs };
}

export async function fetchCbrQuoteBook(): Promise<QuoteBook> {
  const data = (await fetchJson(CBR_URL)) as {
    Valute?: Record<string, { Value?: number; Nominal?: number }>;
  };
  const pairs: Record<string, PairQuote> = {};
  for (const code of ["USD", "EUR"] as const) {
    const row = data.Valute?.[code];
    const value = num(row?.Value);
    const nominal = num(row?.Nominal) ?? 1;
    if (!value) continue;
    const perUnit = value / nominal;
    putPair(pairs, code, "RUB", perUnit, perUnit);
  }
  if (!hasRubBook(pairs)) throw new Error("CBR: missing USD/EUR quotes");
  return { source: "cbr", pairs };
}

async function persistDailyQuote(
  db: Db,
  quoteDate: string,
  book: QuoteBook,
  tbankFailed: boolean,
): Promise<void> {
  const source: FxSource = book.source === "tbank" ? "tbank" : "cbr";
  const { error } = await db.from("fx_daily_quotes").upsert(
    {
      quote_date: quoteDate,
      source,
      pairs: book.pairs,
      tbank_failed: tbankFailed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "quote_date" },
  );
  if (error) {
    // Settlement can still proceed with in-memory book; log for ops.
    console.error("[fx] failed to persist daily quote", quoteDate, error);
  }
}

/**
 * Load today's quote book (Moscow day): DB cache → T-Bank → CBR.
 * At most one external fetch per day; if T-Bank failed today, stay on CBR until tomorrow.
 */
export async function loadQuoteBook(db: Db, forceRefresh = false): Promise<QuoteBook> {
  const quoteDate = moscowQuoteDate();

  if (!forceRefresh) {
    const { data, error } = await db
      .from("fx_daily_quotes")
      .select("source, pairs, tbank_failed")
      .eq("quote_date", quoteDate)
      .maybeSingle();
    if (error) {
      console.warn("[fx] daily quote read failed, fetching live:", error.message);
    } else if (data) {
      const pairs = parseStoredPairs(data.pairs);
      if (pairs) {
        const source = data.source === "tbank" ? "tbank" : "cbr";
        return { source, pairs };
      }
    }
  }

  // No usable row for today (or forceRefresh): try T-Bank once, else CBR.
  // If a CBR row already exists with tbank_failed, we would have returned above —
  // so reaching here means empty/invalid cache.
  try {
    const book = await fetchTbankQuoteBook();
    await persistDailyQuote(db, quoteDate, book, false);
    return book;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[fx] tbank failed for the day, using CBR:", msg);
  }

  const book = await fetchCbrQuoteBook();
  await persistDailyQuote(db, quoteDate, book, true);
  return book;
}

/** Test helper — no-op kept for import stability. */
export function __resetFxCacheForTests() {
  // Daily quotes live in DB; nothing to reset in-process.
}
