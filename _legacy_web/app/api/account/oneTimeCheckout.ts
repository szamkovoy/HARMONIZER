import type { SupabaseClient } from "@supabase/supabase-js";

import { WEBINAR_JOIN_GRACE_HOURS } from "@/modules/webinars/core/webinarTiming";
import { accountCabinetUrl } from "./_utils";
import { hasActiveBookPurchase } from "./bookOwnership";
import { createLavaOneTimeInvoice, resolveLavaOfferIdByName, type LavaPaymentMethod } from "./lava";
import { resolvePaymentGateway, type PaymentProviderId } from "./paymentGatewayProfile";
import { PAY_FAILED_TOKEN_TTL_MS, signOneTimeRetryToken, type OneTimeRetryProduct } from "./payRetryToken";
import { payFailedUrl, payReturnUrl } from "./tierCheckout";
import { createYookassaCheckout } from "./yookassaCheckout";

export type OneTimeCheckoutParams = {
  userId: string;
  product: OneTimeRetryProduct;
  /** Только вебинар; пусто — ближайший опубликованный. */
  webinarId?: string | null;
  /** Валюта кабинета; ЮKassa всё равно берёт RUB. */
  currency: "RUB" | "USD" | "EUR";
  country: string | null;
  /** Только Lava EUR/USD. */
  paymentMethod?: LavaPaymentMethod | null;
  buyer: { email: string; locale: string };
};

export type OneTimeCheckoutResult =
  | { ok: true; paymentUrl: string; contractId: string; provider: PaymentProviderId; webinarId: string | null }
  | {
      ok: false;
      status: number;
      error:
        | "payment_gateway_unavailable"
        | "already_registered"
        | "no_upcoming_webinar"
        | "webinar_not_found";
      webinarId: string | null;
    };

async function resolveWebinarId(
  db: SupabaseClient,
  webinarIdRaw?: string | null,
): Promise<string | "no_upcoming_webinar" | "webinar_not_found"> {
  const webinarId = webinarIdRaw?.trim() || "";
  if (!webinarId) {
    const { data: nearest, error } = await db
      .from("webinars")
      .select("id")
      .eq("is_published", true)
      .gte("starts_at", new Date(Date.now() - WEBINAR_JOIN_GRACE_HOURS * 60 * 60 * 1000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return nearest ? (nearest.id as string) : "no_upcoming_webinar";
  }
  const { data: w, error } = await db
    .from("webinars")
    .select("id")
    .eq("id", webinarId)
    .eq("is_published", true)
    .maybeSingle();
  if (error) throw error;
  return w ? webinarId : "webinar_not_found";
}

export async function isWebinarRegistered(db: SupabaseClient, userId: string, webinarId: string): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_registrations")
    .select("webinar_id")
    .eq("webinar_id", webinarId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Разовая покупка уже оплачена: запись на этот вебинар или купленная книга. */
export async function oneTimeAlreadyPaid(
  db: SupabaseClient,
  params: { userId: string; product: OneTimeRetryProduct; webinarId: string | null },
): Promise<boolean> {
  if (params.product === "book") return hasActiveBookPurchase(db, params.userId);
  return params.webinarId ? isWebinarRegistered(db, params.userId, params.webinarId) : false;
}

/**
 * Вебинар или книга: новый счёт и pending-контракт.
 * Оба шлюза возвращают покупателя на наши страницы: ЮKassa — на /pay/return
 * (статус проверяется по API), Lava — в кабинет при успехе и на /pay/failed при отказе.
 */
export async function startOneTimeCheckout(
  db: SupabaseClient,
  params: OneTimeCheckoutParams,
): Promise<OneTimeCheckoutResult> {
  const gateway = resolvePaymentGateway({ country: params.country, currency: params.currency });
  if (!gateway.ok) {
    return { ok: false, status: 503, error: "payment_gateway_unavailable", webinarId: null };
  }
  const provider = gateway.provider;
  const currency = provider === "yookassa" ? ("RUB" as const) : params.currency;

  let webinarId: string | null = null;
  if (params.product === "webinar") {
    const resolved = await resolveWebinarId(db, params.webinarId);
    if (resolved === "no_upcoming_webinar") {
      return { ok: false, status: 409, error: resolved, webinarId: null };
    }
    if (resolved === "webinar_not_found") {
      return { ok: false, status: 404, error: resolved, webinarId: null };
    }
    webinarId = resolved;
    if (await isWebinarRegistered(db, params.userId, webinarId)) {
      return { ok: false, status: 409, error: "already_registered", webinarId };
    }
  }

  const token = signOneTimeRetryToken(
    {
      userId: params.userId,
      product: params.product,
      webinarId,
      currency: params.currency,
      country: params.country,
      locale: params.buyer.locale,
    },
    PAY_FAILED_TOKEN_TTL_MS,
  );

  if (provider === "yookassa") {
    const out = await createYookassaCheckout(db, {
      userId: params.userId,
      email: params.buyer.email,
      currency: "RUB",
      tier: params.product,
      kind: "one_time",
      productKind: "one_time",
      productRef: webinarId,
      periodicity: "ONE_TIME",
      ...(webinarId ? { webinarId } : {}),
      returnUrlFor: (contractId) => payReturnUrl(token, contractId),
    });
    return { ok: true, provider, webinarId, ...out };
  }

  const invoice = await createLavaOneTimeInvoice({
    email: params.buyer.email,
    offerId: await resolveLavaOfferIdByName(db, params.product, params.buyer.locale),
    currency,
    locale: params.buyer.locale,
    successUrl: accountCabinetUrl({ paid: true }),
    failureUrl: payFailedUrl(token),
    cancelUrl: accountCabinetUrl(),
    paymentMethod: params.paymentMethod ?? null,
  });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: params.userId,
    buyer_email: params.buyer.email,
    contract_id: invoice.id,
    provider: "lavatop",
    tier: params.product,
    currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: "ONE_TIME",
    product_kind: "one_time",
    product_ref: webinarId,
    status: "pending",
  });
  if (insertError) throw insertError;

  return { ok: true, provider, paymentUrl: invoice.paymentUrl, contractId: invoice.id, webinarId };
}
