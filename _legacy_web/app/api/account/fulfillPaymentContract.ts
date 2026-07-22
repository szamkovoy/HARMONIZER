/**
 * Общая активация оплаченного контракта (Lava / ЮKassa).
 * Идемпотентна по status=active; settlement не валит активацию.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { cancelProviderSubscription } from "./cancelActiveSubscriptions";
import { settlePayment } from "./fx";
import { nextPeriodEnd } from "./lava";

const RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;

export type FulfillContractRow = {
  user_id: string;
  contract_id: string;
  tier: string;
  status: string;
  product_kind: string | null;
  product_ref: string | null;
  provider: string | null;
};

export async function findPaymentContract(
  db: SupabaseClient,
  contractId: string,
): Promise<FulfillContractRow | null> {
  const { data, error } = await db
    .from("payment_contracts")
    .select("user_id,contract_id,tier,status,product_kind,product_ref,provider")
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
  },
): Promise<Record<string, unknown>> {
  const { contract } = params;
  const contractId = contract.contract_id;

  if (contract.status === "active") {
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
    return { ok: true, alreadyActive: true };
  }

  const nowIso = new Date().toISOString();

  if (contract.product_kind === "one_time") {
    const { error: contractError } = await db
      .from("payment_contracts")
      .update({ status: "active", updated_at: nowIso })
      .eq("contract_id", contractId);
    if (contractError) throw contractError;

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

    if (contract.tier === "webinar") {
      const webinarId = contract.product_ref;
      if (webinarId) {
        const { error: regError } = await db.from("webinar_registrations").upsert(
          { webinar_id: webinarId, user_id: contract.user_id },
          { onConflict: "webinar_id,user_id", ignoreDuplicates: true },
        );
        if (regError) throw regError;
      }
      return { ok: true, webinarRegistered: webinarId ?? null };
    }

    if (contract.tier === "book") {
      return { ok: true, bookPurchased: contractId };
    }

    return { ok: true, oneTimeActivated: contractId };
  }

  const periodEnd = nextPeriodEnd();
  const { error: contractError } = await db
    .from("payment_contracts")
    .update({
      status: "active",
      current_period_end: periodEnd.toISOString(),
      updated_at: nowIso,
    })
    .eq("contract_id", contractId);
  if (contractError) throw contractError;

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

  const { error: userError } = await db
    .from("users")
    .update({
      membership_tier: contract.tier,
      membership_expires_at: new Date(periodEnd.getTime() + RENEWAL_GRACE_MS).toISOString(),
    })
    .eq("id", contract.user_id);
  if (userError) throw userError;

  await cancelOtherActiveSubscriptions(db, contract.user_id, contractId, params.logTag);

  return { ok: true, activated: contractId };
}

export async function markContractFailed(
  db: SupabaseClient,
  contractId: string,
): Promise<void> {
  const { error } = await db
    .from("payment_contracts")
    .update({ status: "failed", updated_at: new Date().toISOString() })
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
