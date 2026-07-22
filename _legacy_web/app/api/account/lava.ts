/**
 * Клиент Lava.top для серверных роутов кабинета.
 *
 * Контракт API (проверен по официальным SDK lava-top-sdk):
 *   - POST /api/v2/invoice  { email, offerId, currency, periodicity, buyerLanguage? }
 *       -> { id, status, amountTotal, paymentUrl } — первый платёж по подписке.
 *   - GET  /api/v2/products?feedVisibility=ALL -> { items: [{ id, title, description, offers: [{ id, name, prices: [{ currency, amount, periodicity }] }] }] }
 *       — источник правды для цен и offerId. feedVisibility=ALL обязателен: по
 *       умолчанию возвращаются только продукты, видимые в общей ленте, а наши
 *       разовые товары (вебинар/книга) опубликованы как «Доступ только по ссылке»
 *       и без этого параметра не попадают в ответ.
 *   - DELETE /api/v1/subscriptions?contractId=...&email=... — отмена подписки
 *       (contractId = id первого инвойса, он же parentContractId рекуррентных).
 *
 * Вебхуки Lava (настроены в ЛК автора, тип «Результат платежа» + «Регулярный
 * платёж») приходят с заголовком X-Api-Key = LAVATOP_WEBHOOK_SECRET и телом
 * { eventType, product{id,title}, contractId, parentContractId?, buyer{email},
 *   amount, currency, status, timestamp, errorMessage? }.
 *
 * Мультиязычность: Lava не поддерживает несколько языков у одного продукта
 * (title/description/name автор задаёт на одном языке). Поэтому для каждого
 * языка — отдельный продукт Lava, а маппинг (tier, locale) -> offerId живёт
 * в таблице payment_offers. Fallback локали — 'en'. См. docs/02_modules/
 * account_web/lava_integration.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaidProductTier } from "../../../modules/access/core/tiers";

const LAVA_API_BASE = "https://gate.lava.top";

export type LavaCurrency = "RUB" | "USD" | "EUR";

export const LAVA_CURRENCIES: readonly LavaCurrency[] = ["RUB", "USD", "EUR"];

/** Периодичность платежа в Lava. */
export type LavaPeriodicity = "MONTHLY" | "ONE_TIME";

/** Товары, продаваемые через Lava: подписочные тарифы + разовые (вебинар/книга). */
export type LavaProductTier = SellableTier | "webinar" | "book";

/** Локаль fallback, если в payment_offers нет строки для локали пользователя. */
export const LAVA_FALLBACK_LOCALE = "en";

/** Языки, которые принимает платёжная страница Lava (buyerLanguage). */
const LAVA_BUYER_LANGUAGES = new Set(["EN", "RU", "ES"]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

/** Тарифы, продаваемые через Lava; practitioner скрыт и не продаётся. */
export type SellableTier = Exclude<PaidProductTier, "practitioner">;

export function isLavaCurrency(value: string): value is LavaCurrency {
  return (LAVA_CURRENCIES as readonly string[]).includes(value);
}

export function lavaBuyerLanguage(locale: string): string {
  const upper = locale.trim().slice(0, 2).toUpperCase();
  return LAVA_BUYER_LANGUAGES.has(upper) ? upper : "EN";
}

type LavaInvoiceResponse = {
  id: string;
  status: string;
  paymentUrl?: string | null;
  amountTotal?: { amount?: number; currency?: string };
};

/**
 * Разрешить offerId для тарифа под локалью пользователя с fallback на 'en'.
 * Бросает ошибку, если нет ни строки для локали, ни fallback — то есть тариф
 * не сконфигурирован в payment_offers.
 */
export async function resolveLavaOfferId(
  db: SupabaseClient,
  tier: SellableTier,
  locale: string,
): Promise<string> {
  return resolveLavaOfferIdByName(db, tier, locale);
}

/**
 * То же, но принимает любой товар (oracle/master/webinar/book). Используется
 * для разовых покупок, где tier — имя продукта в payment_offers, а не тариф.
 */
export async function resolveLavaOfferIdByName(
  db: SupabaseClient,
  tier: LavaProductTier | string,
  locale: string,
): Promise<string> {
  const norm = locale.trim().slice(0, 2).toLowerCase();
  const candidates = norm === LAVA_FALLBACK_LOCALE ? [norm] : [norm, LAVA_FALLBACK_LOCALE];
  for (const loc of candidates) {
    const { data, error } = await db
      .from("payment_offers")
      .select("offer_id")
      .eq("tier", tier)
      .eq("locale", loc)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    if (data?.offer_id) return data.offer_id;
  }
  throw new Error(`No Lava offer configured for tier "${tier}" (locale ${norm}, fallback ${LAVA_FALLBACK_LOCALE})`);
}

type LavaOffer = {
  id: string;
  name: string;
  prices: { currency: string; amount: number; periodicity: string }[];
};

type LavaProduct = {
  id: string;
  title: string;
  description?: string;
  offers: LavaOffer[];
};

type LavaProductsResponse = { items?: LavaProduct[] };

/** In-memory кэш списка продуктов Lava (TTL 10 мин) — цены меняются редко. */
let productsCache: { at: number; data: LavaProduct[] } | null = null;
const PRODUCTS_TTL_MS = 10 * 60 * 1000;

async function fetchLavaProducts(): Promise<LavaProduct[]> {
  if (productsCache && Date.now() - productsCache.at < PRODUCTS_TTL_MS) {
    return productsCache.data;
  }
  const res = await fetch(`${LAVA_API_BASE}/api/v2/products?feedVisibility=ALL&limit=100`, {
    headers: { "X-Api-Key": requiredEnv("LAVATOP_API_KEY"), Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Lava products HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as LavaProductsResponse;
  const items = data.items ?? [];
  productsCache = { at: Date.now(), data: items };
  return items;
}

/**
 * Цена товара в запрошенной валюте по offerId из payment_offers.
 * periodicity: MONTHLY — для подписочных тарифов, ONE_TIME — для вебинара/книги.
 * Возвращает null, если оффер не найден или цена для валюты не задана.
 */
export async function resolveLavaPrice(
  db: SupabaseClient,
  tier: LavaProductTier | string,
  locale: string,
  currency: LavaCurrency,
  periodicity: LavaPeriodicity = "MONTHLY",
): Promise<{ amount: number; currency: LavaCurrency } | null> {
  const offerId = await resolveLavaOfferIdByName(db, tier, locale);
  const products = await fetchLavaProducts();
  for (const product of products) {
    const offer = product.offers.find((o) => o.id === offerId);
    if (!offer) continue;
    const price = offer.prices.find(
      (p) => p.currency === currency && p.periodicity === periodicity,
    );
    if (price) return { amount: price.amount, currency };
  }
  return null;
}

export async function createLavaSubscriptionInvoice(params: {
  email: string;
  offerId: string;
  currency: LavaCurrency;
  locale: string;
}): Promise<LavaInvoiceResponse> {
  return createLavaInvoice({ ...params, periodicity: "MONTHLY" });
}

/**
 * Разовый инвойс Lava (ONE_TIME): вебинар, книга. Не порождает рекуррентных
 * списаний; вебхук payment.success обрабатывается как разовая покупка.
 */
export async function createLavaOneTimeInvoice(params: {
  email: string;
  offerId: string;
  currency: LavaCurrency;
  locale: string;
}): Promise<LavaInvoiceResponse> {
  return createLavaInvoice({ ...params, periodicity: "ONE_TIME" });
}

/** Normalize buyer email the way Lava expects (trim + lowercase). */
export function normalizeLavaBuyerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class LavaInvoiceError extends Error {
  readonly status: number;
  readonly lavaBody: string;
  readonly code: "lava_buyer_email_rejected" | "lava_invoice_failed";

  constructor(status: number, lavaBody: string) {
    const isEmail =
      /incorrect email to purchase/i.test(lavaBody) || /incorrect email/i.test(lavaBody);
    const code = isEmail ? "lava_buyer_email_rejected" : "lava_invoice_failed";
    super(
      isEmail
        ? "lava_buyer_email_rejected"
        : `Lava invoice HTTP ${status}: ${lavaBody.slice(0, 300)}`,
    );
    this.name = "LavaInvoiceError";
    this.status = status;
    this.lavaBody = lavaBody;
    this.code = code;
  }
}

async function createLavaInvoice(params: {
  email: string;
  offerId: string;
  currency: LavaCurrency;
  locale: string;
  periodicity: LavaPeriodicity;
}): Promise<LavaInvoiceResponse> {
  const email = normalizeLavaBuyerEmail(params.email);
  if (!email || !email.includes("@")) {
    throw new LavaInvoiceError(400, JSON.stringify({ error: "Incorrect email to purchase" }));
  }
  const res = await fetch(`${LAVA_API_BASE}/api/v2/invoice`, {
    method: "POST",
    headers: {
      "X-Api-Key": requiredEnv("LAVATOP_API_KEY"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email,
      offerId: params.offerId,
      currency: params.currency,
      periodicity: params.periodicity,
      buyerLanguage: lavaBuyerLanguage(params.locale),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new LavaInvoiceError(res.status, text);
  }
  const data = JSON.parse(text) as LavaInvoiceResponse;
  if (!data.id) throw new Error("Lava invoice: response has no id");
  return data;
}

export async function cancelLavaSubscription(params: { contractId: string; email: string }): Promise<void> {
  const url = new URL(`${LAVA_API_BASE}/api/v1/subscriptions`);
  url.searchParams.set("contractId", params.contractId);
  url.searchParams.set("email", params.email);
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Api-Key": requiredEnv("LAVATOP_API_KEY"),
      Accept: "application/json",
    },
  });
  // 404 = подписка уже отменена/не найдена на стороне Lava — для нашего
  // сценария это не ошибка (например, пользователь отменил из ЛК Lava).
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lava cancel HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** 30-дневный период MONTHLY-подписки Lava. */
export function nextPeriodEnd(from: Date = new Date()): Date {
  return new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
}
