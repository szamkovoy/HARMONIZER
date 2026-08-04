/**
 * Cron runner: charge due YooKassa subscriptions via saved payment_method_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fulfillYookassaRenewal, markContractCancelled } from "./fulfillPaymentContract";
import { chargeYookassaSavedMethod } from "./yookassa";

const RENEW_WINDOW_MS = 36 * 60 * 60 * 1000;
const MAX_FAILS = 2;

type DueContract = {
  contract_id: string;
  user_id: string;
  tier: string;
  amount: number | null;
  currency: string | null;
  current_period_end: string;
  payment_method_id: string | null;
  renew_fail_count: number | null;
};

async function inactivatePaymentMethods(
  db: SupabaseClient,
  userId: string,
  paymentMethodId?: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (paymentMethodId) {
    const { error } = await db
      .from("yookassa_payment_methods")
      .update({ status: "inactive", updated_at: nowIso })
      .eq("payment_method_id", paymentMethodId);
    if (error) throw error;
    return;
  }
  const { error } = await db
    .from("yookassa_payment_methods")
    .update({ status: "inactive", updated_at: nowIso })
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
}

export async function handleYookassaRenewalFailure(
  db: SupabaseClient,
  params: {
    contractId: string;
    userId: string;
    paymentMethodId?: string | null;
    reason?: string | null;
  },
): Promise<{ cancelled: boolean; failCount: number }> {
  const { data: row, error } = await db
    .from("payment_contracts")
    .select("renew_fail_count,payment_method_id")
    .eq("contract_id", params.contractId)
    .maybeSingle();
  if (error) throw error;

  const prev = Number(row?.renew_fail_count ?? 0) || 0;
  const next = prev + 1;
  const nowIso = new Date().toISOString();
  const revoked =
    (params.reason ?? "").toLowerCase().includes("permission_revoked") ||
    (params.reason ?? "").toLowerCase().includes("revoked");

  const { error: updErr } = await db
    .from("payment_contracts")
    .update({ renew_fail_count: next, updated_at: nowIso })
    .eq("contract_id", params.contractId);
  if (updErr) throw updErr;

  if (revoked || next >= MAX_FAILS) {
    await markContractCancelled(db, params.contractId);
    await inactivatePaymentMethods(
      db,
      params.userId,
      params.paymentMethodId ?? row?.payment_method_id ?? null,
    );
    return { cancelled: true, failCount: next };
  }
  return { cancelled: false, failCount: next };
}

export async function runYookassaRenewals(db: SupabaseClient): Promise<{
  scanned: number;
  charged: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  const now = Date.now();
  const windowEnd = new Date(now + RENEW_WINDOW_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data, error } = await db
    .from("payment_contracts")
    .select(
      "contract_id,user_id,tier,amount,currency,current_period_end,payment_method_id,renew_fail_count,status,product_kind,cancelled_at,provider",
    )
    .eq("provider", "yookassa")
    .eq("status", "active")
    .eq("product_kind", "subscription")
    .is("cancelled_at", null)
    .not("payment_method_id", "is", null)
    .lte("current_period_end", windowEnd)
    .gte("current_period_end", new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(100);
  if (error) throw error;

  const due = (data ?? []) as DueContract[];
  let charged = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const contract of due) {
    const methodId = contract.payment_method_id?.trim();
    if (!methodId || !contract.user_id) {
      skipped += 1;
      continue;
    }

    // Active saved method required.
    const { data: method } = await db
      .from("yookassa_payment_methods")
      .select("status")
      .eq("payment_method_id", methodId)
      .maybeSingle();
    if (!method || method.status !== "active") {
      skipped += 1;
      continue;
    }

    const amount = Number(contract.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped += 1;
      continue;
    }

    const periodKey = contract.current_period_end;
    try {
      charged += 1;
      const payment = await chargeYookassaSavedMethod({
        contractId: contract.contract_id,
        userId: contract.user_id,
        tier: contract.tier,
        amount,
        paymentMethodId: methodId,
        periodKey,
        description: `Продление подписки Harmonizer (${contract.tier})`,
      });

      if (payment.status === "succeeded" && payment.paid !== false) {
        await fulfillYookassaRenewal(db, {
          contract: {
            user_id: contract.user_id,
            contract_id: contract.contract_id,
            tier: contract.tier,
            status: "active",
            product_kind: "subscription",
            product_ref: null,
            provider: "yookassa",
          },
          amount,
          currency: "RUB",
          paidAt: payment.created_at ?? nowIso,
          logTag: "yookassa-cron",
        });
        succeeded += 1;
      } else if (payment.status === "canceled" || payment.status === "cancelled") {
        const reason = payment.cancellation_details?.reason ?? payment.status;
        await handleYookassaRenewalFailure(db, {
          contractId: contract.contract_id,
          userId: contract.user_id,
          paymentMethodId: methodId,
          reason,
        });
        failed += 1;
      } else {
        // pending — wait for webhook
        console.log("[yookassa-cron] renew pending", contract.contract_id, payment.id, payment.status);
      }
    } catch (err) {
      console.error("[yookassa-cron] charge failed", contract.contract_id, err);
      await handleYookassaRenewalFailure(db, {
        contractId: contract.contract_id,
        userId: contract.user_id,
        paymentMethodId: methodId,
        reason: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }

  return { scanned: due.length, charged, succeeded, failed, skipped };
}
