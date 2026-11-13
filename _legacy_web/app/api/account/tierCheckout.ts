import type { SupabaseClient } from "@supabase/supabase-js";

import { WIDGET_PUBLIC_ORIGIN } from "../../../lib/paymentWidget/config";
import { TIER_ORDER } from "../../../modules/access/core/tiers";
import { accountCabinetUrl } from "./_utils";
import {
  createLavaOneTimeInvoice,
  createLavaSubscriptionInvoice,
  nextPeriodEnd,
  normalizeLavaBuyerEmail,
  resolveLavaOfferId,
  resolveLavaOfferIdByName,
  type LavaPaymentMethod,
} from "./lava";
import { resolvePaymentGateway, type PaymentProviderId } from "./paymentGatewayProfile";
import { subscriptionIsLive } from "./subscriptionLiveness";
import { PAY_FAILED_TOKEN_TTL_MS, signPayRetryToken, type PayRetryKind } from "./payRetryToken";
import { hasHigherPaidAccess, lavaPassOfferName, TIER_PASS_REF, type PassTier } from "./tierPass";
import { createYookassaCheckout } from "./yookassaCheckout";

export type TierCheckoutParams = {
  userId: string;
  tier: PassTier;
  kind: PayRetryKind;
  /** Валюта кабинета; ЮKassa всё равно берёт RUB. */
  currency: "RUB" | "USD" | "EUR";
  country: string | null;
  /** Только Lava EUR/USD. */
  paymentMethod?: LavaPaymentMethod | null;
  /** Уже загружены вызывающим (кабинетный checkout). */
  buyer?: { email: string; locale: string };
};

export type TierCheckoutBlock = "already_active" | "has_subscription" | "higher_access";

export type TierCheckoutResult =
  | { ok: true; paymentUrl: string; contractId: string; provider: PaymentProviderId }
  | {
      ok: false;
      status: number;
      error:
        | "user_not_found"
        | "no_email"
        | "lava_buyer_email_rejected"
        | "payment_gateway_unavailable"
        | TierCheckoutBlock;
    };

/** Какие варианты можно предложить на странице отказа / продления. */
export async function tierCheckoutBlocks(
  db: SupabaseClient,
  params: { userId: string; tier: PassTier },
): Promise<{ subscription: TierCheckoutBlock | null; pass: TierCheckoutBlock | null }> {
  const [subscription, pass] = await Promise.all([
    blockedReason(db, { ...params, kind: "subscription" }),
    blockedReason(db, { ...params, kind: "pass" }),
  ]);
  return { subscription, pass };
}

/** Куда Lava/ЮKassa вернут покупателя после неудачной оплаты. */
export function payFailedUrl(token: string): string {
  const url = new URL("/pay/failed", WIDGET_PUBLIC_ORIGIN);
  url.searchParams.set("t", token);
  return url.toString();
}

export function payReturnUrl(token: string, contractId: string): string {
  const url = new URL("/pay/return", WIDGET_PUBLIC_ORIGIN);
  url.searchParams.set("t", token);
  url.searchParams.set("c", contractId);
  return url.toString();
}

/** Email и язык владельца аккаунта для нового счёта. */
export async function loadBuyer(
  db: SupabaseClient,
  userId: string,
): Promise<{ email: string; locale: string } | "user_not_found" | "no_email" | "lava_buyer_email_rejected"> {
  const { data: row, error } = await db.from("users").select("locale").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!row) return "user_not_found";
  const { data: authData } = await db.auth.admin.getUserById(userId);
  const emailRaw = authData?.user?.email;
  if (!emailRaw) return "no_email";
  const email = normalizeLavaBuyerEmail(emailRaw);
  if (!email.includes("@")) return "lava_buyer_email_rejected";
  const locale = typeof row.locale === "string" && row.locale.trim() ? row.locale : "ru";
  return { email, locale };
}

async function blockedReason(
  db: SupabaseClient,
  params: { userId: string; tier: PassTier; kind: PayRetryKind },
): Promise<TierCheckoutBlock | null> {
  const { data: activeRows, error } = await db
    .from("payment_contracts")
    .select("tier,status,current_period_end")
    .eq("user_id", params.userId)
    .eq("status", "active")
    .eq("product_kind", "subscription")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  // Подписка без продления (period_end + грейс в прошлом) покупку не блокирует.
  const active = (activeRows ?? []).find((row) => subscriptionIsLive(row)) ?? null;
  if (active && TIER_ORDER[params.tier] <= TIER_ORDER[active.tier as keyof typeof TIER_ORDER]) {
    return "already_active";
  }
  // Продление подписки переписывает membership_* и срезало бы оплаченные 30 дней.
  if (active && params.kind === "pass") return "has_subscription";

  const { data: user, error: userError } = await db
    .from("users")
    .select("membership_tier,membership_expires_at")
    .eq("id", params.userId)
    .maybeSingle();
  if (userError) throw userError;
  if (
    hasHigherPaidAccess({
      tier: params.tier,
      currentTier: user?.membership_tier as string | null,
      currentExpiresAt: user?.membership_expires_at as string | null,
    })
  ) {
    return "higher_access";
  }
  return null;
}

/**
 * Подписка или 30 дней тарифа: новый счёт и pending-контракт.
 * Неудачная оплата возвращает покупателя на /pay/failed с готовыми вариантами.
 */
export async function startTierCheckout(
  db: SupabaseClient,
  params: TierCheckoutParams,
): Promise<TierCheckoutResult> {
  const buyer = params.buyer ?? (await loadBuyer(db, params.userId));
  if (typeof buyer === "string") {
    return { ok: false, status: buyer === "user_not_found" ? 404 : buyer === "no_email" ? 409 : 400, error: buyer };
  }

  const gateway = resolvePaymentGateway({ country: params.country, currency: params.currency });
  if (!gateway.ok) return { ok: false, status: 503, error: "payment_gateway_unavailable" };
  const provider = gateway.provider;

  const blocked = await blockedReason(db, params);
  if (blocked) return { ok: false, status: 409, error: blocked };

  const token = signPayRetryToken(
    {
      userId: params.userId,
      tier: params.tier,
      kind: params.kind,
      currency: params.currency,
      country: params.country,
      locale: buyer.locale,
    },
    PAY_FAILED_TOKEN_TTL_MS,
  );
  const isPass = params.kind === "pass";

  if (provider === "yookassa") {
    const out = await createYookassaCheckout(db, {
      userId: params.userId,
      email: buyer.email,
      currency: "RUB",
      tier: params.tier,
      kind: isPass ? "one_time" : "subscription",
      productKind: isPass ? "one_time" : "subscription",
      productRef: isPass ? TIER_PASS_REF : null,
      periodicity: isPass ? "ONE_TIME" : "MONTHLY",
      returnUrlFor: (contractId) => payReturnUrl(token, contractId),
    });
    return { ok: true, provider, ...out };
  }

  const urls = {
    successUrl: accountCabinetUrl({ paid: true }),
    failureUrl: payFailedUrl(token),
    cancelUrl: accountCabinetUrl(),
    paymentMethod: params.paymentMethod ?? null,
  };
  const invoice = isPass
    ? await createLavaOneTimeInvoice({
        email: buyer.email,
        offerId: await resolveLavaOfferIdByName(db, lavaPassOfferName(params.tier), buyer.locale),
        currency: params.currency,
        locale: buyer.locale,
        ...urls,
      })
    : await createLavaSubscriptionInvoice({
        email: buyer.email,
        offerId: await resolveLavaOfferId(db, params.tier, buyer.locale),
        currency: params.currency,
        locale: buyer.locale,
        ...urls,
      });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: params.userId,
    buyer_email: buyer.email,
    contract_id: invoice.id,
    provider: "lavatop",
    tier: params.tier,
    currency: params.currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: isPass ? "ONE_TIME" : "MONTHLY",
    product_kind: isPass ? "one_time" : "subscription",
    product_ref: isPass ? TIER_PASS_REF : null,
    status: "pending",
    ...(isPass ? {} : { current_period_end: nextPeriodEnd().toISOString() }),
  });
  if (insertError) throw insertError;

  return { ok: true, provider, paymentUrl: invoice.paymentUrl, contractId: invoice.id };
}
