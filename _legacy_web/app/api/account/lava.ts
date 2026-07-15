/**
 * Клиент Lava.top для серверных роутов кабинета.
 *
 * Контракт API (проверен по официальным SDK lava-top-sdk):
 *   - POST /api/v2/invoice  { email, offerId, currency, periodicity, buyerLanguage? }
 *       -> { id, status, amountTotal, paymentUrl } — первый платёж по подписке.
 *   - DELETE /api/v1/subscriptions?contractId=...&email=... — отмена подписки
 *       (contractId = id первого инвойса, он же parentContractId рекуррентных).
 *
 * Вебхуки Lava (настроены в ЛК автора, тип «Результат платежа» + «Регулярный
 * платёж») приходят с заголовком X-Api-Key = LAVATOP_WEBHOOK_SECRET и телом
 * { eventType, product{id,title}, contractId, parentContractId?, buyer{email},
 *   amount, currency, status, timestamp, errorMessage? }.
 */
import type { PaidProductTier } from "../../../modules/access/core/tiers";

const LAVA_API_BASE = "https://gate.lava.top";

export type LavaCurrency = "RUB" | "USD" | "EUR";

export const LAVA_CURRENCIES: readonly LavaCurrency[] = ["RUB", "USD", "EUR"];

/** Языки, которые принимает платёжная страница Lava (buyerLanguage). */
const LAVA_BUYER_LANGUAGES = new Set(["EN", "RU", "ES"]);

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

/** Тарифы, продаваемые через Lava; practitioner скрыт и не продаётся. */
export type SellableTier = Exclude<PaidProductTier, "practitioner">;

export function lavaOfferIdForTier(tier: SellableTier): string {
  return tier === "master" ? requiredEnv("LAVATOP_TARIFF_3_ID") : requiredEnv("LAVATOP_TARIFF_2_ID");
}

export function tierForLavaOfferId(offerId: string): SellableTier | null {
  if (offerId === process.env.LAVATOP_TARIFF_3_ID?.trim()) return "master";
  if (offerId === process.env.LAVATOP_TARIFF_2_ID?.trim()) return "oracle";
  return null;
}

export function isLavaCurrency(value: string): value is LavaCurrency {
  return (LAVA_CURRENCIES as readonly string[]).includes(value);
}

export function lavaBuyerLanguage(locale: string): string | undefined {
  const upper = locale.trim().slice(0, 2).toUpperCase();
  return LAVA_BUYER_LANGUAGES.has(upper) ? upper : "EN";
}

type LavaInvoiceResponse = {
  id: string;
  status: string;
  paymentUrl?: string | null;
  amountTotal?: { amount?: number; currency?: string };
};

export async function createLavaSubscriptionInvoice(params: {
  email: string;
  tier: SellableTier;
  currency: LavaCurrency;
  locale: string;
}): Promise<LavaInvoiceResponse> {
  const res = await fetch(`${LAVA_API_BASE}/api/v2/invoice`, {
    method: "POST",
    headers: {
      "X-Api-Key": requiredEnv("LAVATOP_API_KEY"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      offerId: lavaOfferIdForTier(params.tier),
      currency: params.currency,
      periodicity: "MONTHLY",
      buyerLanguage: lavaBuyerLanguage(params.locale),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Lava invoice HTTP ${res.status}: ${text.slice(0, 300)}`);
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
