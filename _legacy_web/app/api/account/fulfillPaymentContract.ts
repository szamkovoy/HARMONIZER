/**
 * Общая активация оплаченного контракта (Lava / ЮKassa).
 * Идемпотентна по status=active; settlement не валит активацию.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelProviderSubscription } from "./cancelActiveSubscriptions";
import { settlePayment } from "./fx";
import { nextPeriodEnd } from "./lava";
import { resolveCatalogPrice } from "./paymentCatalog";
import { hasHigherPaidAccess, isTierPassContract, tierPassPeriodEnd, type PassTier } from "./tierPass";
import { computeMasterBonusDays, periodEndWithBonusDays } from "./upgradeCredit";
import {
  hasPublishedWebinarForPass,
  sendMasterWebinarInvites,
  sendPassWebinarInvites,
  sendWebinarInvites,
  ticketWebinarIsPublished,
  type NoticeResult,
} from "./webinarNotices";
import {
  ensureWidgetBuyer,
  grantWebinarPass,
  loadWebinarPassProduct,
  resubscribeContactOnPurchase,
  sendWidgetPurchaseLetter,
} from "./widgetFulfillment";

const RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;

export type FulfillContractRow = {
  user_id: string;
  contract_id: string;
  tier: string;
  status: string;
  product_kind: string | null;
  product_ref: string | null;
  provider: string | null;
  current_period_end?: string | null;
  payment_method_id?: string | null;
  renew_fail_count?: number | null;
  amount?: number | null;
  currency?: string | null;
  source?: string | null;
  buyer_email?: string | null;
  buyer_name?: string | null;
  buyer_locale?: string | null;
  catalog_id?: string | null;
};

export async function findPaymentContract(
  db: SupabaseClient,
  contractId: string,
): Promise<FulfillContractRow | null> {
  const { data, error } = await db
    .from("payment_contracts")
    .select(
      "user_id,contract_id,tier,status,product_kind,product_ref,provider,current_period_end,payment_method_id,renew_fail_count,amount,currency,source,buyer_email,buyer_name,buyer_locale,catalog_id",
    )
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  return data as FulfillContractRow | null;
}

export async function settleChargeSafe(
  db: SupabaseClient,
  params: {
    contractId: string;
    eventType: "payment.success" | "subscription.recurring.payment.success";
    amount?: number | null;
    currency?: string | null;
    paidAt?: string | null;
    userId?: string | null;
    provider?: string | null;
    logTag: string;
  },
): Promise<void> {
  try {
    const settled = await settlePayment(db, {
      contractId: params.contractId,
      eventType: params.eventType,
      amount: params.amount,
      currency: params.currency,
      paidAt: params.paidAt ?? new Date().toISOString(),
      userId: params.userId,
      provider: params.provider,
    });
    if (settled) {
      console.log(`[${params.logTag}] settled`, {
        contractId: params.contractId,
        eventType: params.eventType,
        inserted: settled.inserted,
        fx: settled.nets.fx_source,
      });
    }
  } catch (settleErr) {
    console.error(`[${params.logTag}] settle failed`, params.contractId, settleErr);
  }
}

async function cancelOtherActiveSubscriptions(
  db: SupabaseClient,
  userId: string,
  exceptContractId: string,
  logTag: string,
): Promise<void> {
  const { data: others, error: othersError } = await db
    .from("payment_contracts")
    .select("contract_id,provider,product_kind")
    .eq("user_id", userId)
    .eq("status", "active")
    .neq("contract_id", exceptContractId);
  if (othersError) throw othersError;

  const nowIso = new Date().toISOString();
  const { data: authData } = await db.auth.admin.getUserById(userId);
  const email = authData?.user?.email ?? "";

  for (const other of others ?? []) {
    const kind = other.product_kind ?? "subscription";
    if (kind !== "subscription") continue;
    try {
      await cancelProviderSubscription({
        provider: other.provider || "lavatop",
        contractId: other.contract_id,
        email,
        userId,
        db,
      });
      const { error: cancelError } = await db
        .from("payment_contracts")
        .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
        .eq("contract_id", other.contract_id);
      if (cancelError) throw cancelError;
    } catch (cancelIssue) {
      console.error(`[${logTag}] failed to cancel prior contract`, other.contract_id, cancelIssue);
    }
  }
}

/**
 * Активация после успешного первого платежа (подписка или one_time).
 * Возвращает машинный итог для JSON-ответа вебхука.
 */
export async function fulfillFirstPaymentSuccess(
  db: SupabaseClient,
  params: {
    contract: FulfillContractRow;
    amount?: number | null;
    currency?: string | null;
    paidAt?: string | null;
    provider: string;
    logTag: string;
    /**
     * Lava drops the webhook unless we answer within 10s. Pass this to finish
     * the payment row first and send letters / FX after the response.
     */
    scheduleSlow?: (work: () => Promise<void>) => void;
  },
): Promise<Record<string, unknown>> {
  const contractId = params.contract.contract_id;
  let contract = params.contract;

  if (contract.status !== "active" && contract.source === "widget" && contract.buyer_email) {
    const buyer = await ensureWidgetBuyer(db, {
      email: contract.buyer_email,
      name: contract.buyer_name ?? null,
      locale: contract.buyer_locale || "ru",
    });
    contract = { ...contract, user_id: buyer.userId };
  }

  if (contract.status === "active") {
    const slow = async () => {
      await settleChargeSafe(db, {
        contractId,
        eventType: "payment.success",
        amount: params.amount,
        currency: params.currency,
        paidAt: params.paidAt,
        userId: contract.user_id,
        provider: params.provider,
        logTag: params.logTag,
      });
      await resubscribeSafe(db, contract, params.logTag);
      if (contract.source === "widget" && contract.product_kind === "one_time") {
        // Retry after a partial first run: pass and letter are idempotent.
        await completeOneTimeExtras(db, contract, contract.user_id, params);
      }
      if (contract.tier === "master" && contract.user_id) {
        await masterInvitesSafe(db, contract.user_id, params.logTag);
      }
    };
    if (params.scheduleSlow) {
      params.scheduleSlow(slow);
      return { ok: true, alreadyActive: true, deferred: true };
    }
    await slow();
    return { ok: true, alreadyActive: true };
  }

  const nowIso = new Date().toISOString();

  if (isTierPassContract(contract) && contract.user_id) {
    return activateTierPass(db, contract, params);
  }

  if (contract.product_kind === "one_time") {
    const userId: string | null = contract.user_id ?? null;

    const { error: contractError } = await db
      .from("payment_contracts")
      .update({ status: "active", updated_at: nowIso, ...(userId ? { user_id: userId } : {}) })
      .eq("contract_id", contractId);
    if (contractError) throw contractError;

    const access = await completeOneTimeExtras(db, contract, userId, params, false);
    const slow = async () => {
      await settleChargeSafe(db, {
        contractId,
        eventType: "payment.success",
        amount: params.amount,
        currency: params.currency,
        paidAt: params.paidAt,
        userId,
        provider: params.provider,
        logTag: params.logTag,
      });
      await resubscribeSafe(db, { ...contract, user_id: userId }, params.logTag);
      await completeOneTimeExtras(db, contract, userId, params, true);
    };
    if (params.scheduleSlow) {
      params.scheduleSlow(slow);
      return { ...access, deferred: true };
    }
    await slow();
    return access;
  }

  let bonusDays = 0;
  if (params.provider === "yookassa" && contract.tier === "master") {
    const [{ data: priorOracle }, { data: userRow }, oracleCatalog] = await Promise.all([
      db
        .from("payment_contracts")
        .select("amount,current_period_end,status")
        .eq("user_id", contract.user_id)
        .eq("tier", "oracle")
        .eq("product_kind", "subscription")
        .in("status", ["active", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("users")
        .select("membership_expires_at,membership_tier")
        .eq("id", contract.user_id)
        .maybeSingle(),
      resolveCatalogPrice(db, {
        provider: "yookassa",
        tier: "oracle",
        currency: "RUB",
      }),
    ]);
    const masterAmount = params.amount ?? contract.amount;
    const periodCandidates = [
      priorOracle?.current_period_end as string | undefined,
      userRow?.membership_expires_at as string | undefined,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    const periodEndIso = periodCandidates.sort().at(-1);
    bonusDays = computeMasterBonusDays({
      periodEndIso,
      // Каталог ЮKassa — канон прайса «Наставник»; сумма тестового контракта (50₽) не обнуляет кредит.
      oracleAmount: oracleCatalog?.amount ?? (priorOracle?.amount as number | undefined),
      masterAmount: typeof masterAmount === "number" ? masterAmount : Number(masterAmount),
    });
  }

  const paidAt = params.paidAt ? new Date(params.paidAt) : new Date();
  const from = Number.isNaN(paidAt.getTime()) ? new Date() : paidAt;
  const periodEnd =
    bonusDays > 0 ? periodEndWithBonusDays(from, bonusDays) : nextPeriodEnd(from);
  const { error: contractError } = await db
    .from("payment_contracts")
    .update({
      status: "active",
      current_period_end: periodEnd.toISOString(),
      updated_at: nowIso,
      ...(contract.user_id ? { user_id: contract.user_id } : {}),
    })
    .eq("contract_id", contractId);
  if (contractError) throw contractError;

  // Оплаченные 30 дней того же тарифа не сгорают при оформлении подписки.
  const { data: currentAccess, error: accessError } = await db
    .from("users")
    .select("membership_tier,membership_expires_at")
    .eq("id", contract.user_id)
    .maybeSingle();
  if (accessError) throw accessError;
  let accessUntilMs = periodEnd.getTime() + RENEWAL_GRACE_MS;
  if (currentAccess?.membership_tier === contract.tier && currentAccess.membership_expires_at) {
    const currentMs = new Date(currentAccess.membership_expires_at as string).getTime();
    if (Number.isFinite(currentMs) && currentMs > accessUntilMs) accessUntilMs = currentMs;
  }

  const { error: userError } = await db
    .from("users")
    .update({
      membership_tier: contract.tier,
      membership_expires_at: new Date(accessUntilMs).toISOString(),
    })
    .eq("id", contract.user_id);
  if (userError) throw userError;

  const slow = async () => {
    await settleChargeSafe(db, {
      contractId,
      eventType: "payment.success",
      amount: params.amount,
      currency: params.currency,
      paidAt: params.paidAt,
      userId: contract.user_id,
      provider: params.provider,
      logTag: params.logTag,
    });
    await cancelOtherActiveSubscriptions(db, contract.user_id, contractId, params.logTag);
    await resubscribeSafe(db, contract, params.logTag);
    if (contract.tier === "master" && contract.user_id) {
      await masterInvitesSafe(db, contract.user_id, params.logTag);
    }
    if (contract.source === "widget") {
      await sendWidgetPurchaseLetterSafe(db, contractId, params.logTag);
    }
  };
  if (params.scheduleSlow) {
    params.scheduleSlow(slow);
    return { ok: true, activated: contractId, upgradeBonusDays: bonusDays, deferred: true };
  }
  await slow();
  const result: Record<string, unknown> = { ok: true, activated: contractId, upgradeBonusDays: bonusDays };
  return result;
}

/** 30 дней тарифа без автопродления: доступ без 48 ч запаса, подписки не трогаем. */
async function activateTierPass(
  db: SupabaseClient,
  contract: FulfillContractRow,
  params: { amount?: number | null; currency?: string | null; paidAt?: string | null; provider: string; logTag: string; scheduleSlow?: (work: () => Promise<void>) => void },
): Promise<Record<string, unknown>> {
  const contractId = contract.contract_id;
  const tier = contract.tier as PassTier;
  const { data: user, error: userReadError } = await db
    .from("users")
    .select("membership_tier,membership_expires_at")
    .eq("id", contract.user_id)
    .maybeSingle();
  if (userReadError) throw userReadError;

  const paid = params.paidAt ? new Date(params.paidAt) : new Date();
  const paidAt = Number.isNaN(paid.getTime()) ? new Date() : paid;
  const current = {
    currentTier: (user?.membership_tier as string | null) ?? null,
    currentExpiresAt: (user?.membership_expires_at as string | null) ?? null,
  };
  const periodEnd = tierPassPeriodEnd({ tier, paidAt, ...current });
  const nowIso = new Date().toISOString();

  const { error: contractError } = await db
    .from("payment_contracts")
    .update({ status: "active", current_period_end: periodEnd.toISOString(), updated_at: nowIso })
    .eq("contract_id", contractId);
  if (contractError) throw contractError;

  if (!hasHigherPaidAccess({ tier, ...current, now: paidAt })) {
    const { error: userError } = await db
      .from("users")
      .update({ membership_tier: tier, membership_expires_at: periodEnd.toISOString() })
      .eq("id", contract.user_id);
    if (userError) throw userError;
  }

  const slow = async () => {
    await settleChargeSafe(db, {
      contractId,
      eventType: "payment.success",
      amount: params.amount,
      currency: params.currency,
      paidAt: params.paidAt,
      userId: contract.user_id,
      provider: params.provider,
      logTag: params.logTag,
    });
    await resubscribeSafe(db, contract, params.logTag);
    if (tier === "master") await masterInvitesSafe(db, contract.user_id, params.logTag);
  };
  const result = { ok: true, activated: contractId, passUntil: periodEnd.toISOString() };
  if (params.scheduleSlow) {
    params.scheduleSlow(slow);
    return { ...result, deferred: true };
  }
  await slow();
  return result;
}

async function sendWidgetPurchaseLetterSafe(
  db: SupabaseClient,
  contractId: string,
  logTag: string,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    return await sendWidgetPurchaseLetter(db, contractId);
  } catch (letterErr) {
    console.error(`[${logTag}] widget letter failed`, contractId, letterErr);
    return { sent: false, reason: "send_failed" };
  }
}

/** Разовая покупка после активации: вебинар (конкретный или пропуск), письмо виджета. */
async function completeOneTimeExtras(
  db: SupabaseClient,
  contract: FulfillContractRow,
  userId: string | null,
  params: { paidAt?: string | null; logTag: string },
  sendMail = true,
): Promise<Record<string, unknown>> {
  const contractId = contract.contract_id;
  const result: Record<string, unknown> = { ok: true, oneTimeActivated: contractId };

  // A 1- or 4-webinar purchase sends the catalog letter only when no published
  // webinar fits yet. Once one does, the invitation replaces that letter.
  let skipProductLetter = false;

  if (contract.tier === "webinar" && contract.product_ref) {
    if (userId) {
      const { error: regError } = await db.from("webinar_registrations").upsert(
        { webinar_id: contract.product_ref, user_id: userId },
        { onConflict: "webinar_id,user_id", ignoreDuplicates: true },
      );
      if (regError) throw regError;
      skipProductLetter = await ticketWebinarIsPublished(db, contract.product_ref);
      if (skipProductLetter && sendMail) {
        result.invites = await invitesSafe(
          () => sendWebinarInvites(db, contract.product_ref as string, { onlyUserId: userId }),
          params.logTag,
        );
      }
    }
    result.webinarRegistered = contract.product_ref;
  } else if ((contract.tier === "webinar" || contract.tier === "webinar_pack") && userId) {
    const product = await loadWebinarPassProduct(db, {
      catalogId: contract.catalog_id ?? null,
      tier: contract.tier,
    });
    if (product) {
      const paid = params.paidAt ? new Date(params.paidAt) : new Date();
      const pass = await grantWebinarPass(db, {
        userId,
        contractId,
        product,
        paidAt: Number.isNaN(paid.getTime()) ? new Date() : paid,
      });
      result.webinarPass = { credits: product.credits, registered: pass.registered };
      skipProductLetter = await hasPublishedWebinarForPass(db, userId);
      if (skipProductLetter && sendMail) {
        result.invites = await invitesSafe(() => sendPassWebinarInvites(db, userId), params.logTag);
      }
    }
  } else if (contract.tier === "book") {
    result.bookPurchased = contractId;
  }

  if (sendMail && contract.source === "widget" && !skipProductLetter) {
    result.letter = await sendWidgetPurchaseLetterSafe(db, contractId, params.logTag);
  }
  return result;
}

async function resubscribeSafe(
  db: SupabaseClient,
  contract: { contract_id: string; buyer_email?: string | null; user_id: string | null },
  logTag: string,
): Promise<void> {
  try {
    await resubscribeContactOnPurchase(db, {
      email: contract.buyer_email,
      userId: contract.user_id,
    });
  } catch (err) {
    console.error(`[${logTag}] resubscribe failed`, contract.contract_id, err);
  }
}

async function masterInvitesSafe(
  db: SupabaseClient,
  userId: string,
  logTag: string,
): Promise<NoticeResult> {
  return invitesSafe(() => sendMasterWebinarInvites(db, userId), logTag);
}

async function invitesSafe(run: () => Promise<NoticeResult>, logTag: string): Promise<NoticeResult> {
  try {
    return await run();
  } catch (err) {
    console.error(`[${logTag}] webinar invites failed`, err);
    return { sent: 0, failed: 1 };
  }
}

/**
 * Продление подписки ЮKassa после успешного автосписания (зеркало Lava renewal).
 */
export async function fulfillYookassaRenewal(
  db: SupabaseClient,
  params: {
    contract: FulfillContractRow;
    amount?: number | null;
    currency?: string | null;
    paidAt?: string | null;
    logTag?: string;
  },
): Promise<Record<string, unknown>> {
  const logTag = params.logTag ?? "yookassa-renewal";
  const { contract } = params;
  if (contract.status === "cancelled") {
    return { ok: true, skipped: "cancelled" };
  }

  const paidAt = params.paidAt ? new Date(params.paidAt) : new Date();
  const periodEnd = nextPeriodEnd(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt);
  const nowIso = new Date().toISOString();

  const { error: contractError } = await db
    .from("payment_contracts")
    .update({
      status: "active",
      current_period_end: periodEnd.toISOString(),
      renew_fail_count: 0,
      updated_at: nowIso,
    })
    .eq("contract_id", contract.contract_id);
  if (contractError) throw contractError;

  await settleChargeSafe(db, {
    contractId: contract.contract_id,
    eventType: "subscription.recurring.payment.success",
    amount: params.amount,
    currency: params.currency ?? "RUB",
    paidAt: params.paidAt ?? nowIso,
    userId: contract.user_id,
    provider: "yookassa",
    logTag,
  });

  const { error: userError } = await db
    .from("users")
    .update({
      membership_tier: contract.tier,
      membership_expires_at: new Date(periodEnd.getTime() + RENEWAL_GRACE_MS).toISOString(),
    })
    .eq("id", contract.user_id);
  if (userError) throw userError;

  await resubscribeSafe(db, contract, logTag);
  return { ok: true, renewed: contract.contract_id };
}

/** Причина отказа ЮKassa: `party:reason`, напр. `issuer:3d_secure_failed`. */
export function yookassaFailureReason(payment: {
  cancellation_details?: { party?: string; reason?: string } | null;
}): string | null {
  const details = payment.cancellation_details;
  if (!details?.reason) return null;
  return details.party ? `${details.party}:${details.reason}` : details.reason;
}

export async function markContractFailed(
  db: SupabaseClient,
  contractId: string,
  failureReason?: string | null,
): Promise<void> {
  const reason = failureReason?.trim().slice(0, 500) || null;
  const { error } = await db
    .from("payment_contracts")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
      ...(reason ? { failure_reason: reason } : {}),
    })
    .eq("contract_id", contractId)
    .eq("status", "pending");
  if (error) throw error;
}

export async function markContractCancelled(
  db: SupabaseClient,
  contractId: string,
): Promise<{ alreadyCancelled: boolean }> {
  const contract = await findPaymentContract(db, contractId);
  if (!contract) return { alreadyCancelled: false };
  if (contract.status === "cancelled") return { alreadyCancelled: true };

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("payment_contracts")
    .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
    .eq("contract_id", contract.contract_id);
  if (error) throw error;
  return { alreadyCancelled: false };
}
