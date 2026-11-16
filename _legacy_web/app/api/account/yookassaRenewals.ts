/**
 * Cron runner: charge due YooKassa subscriptions via saved payment_method_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fulfillYookassaRenewal } from "./fulfillPaymentContract";
import { sendPaymentAlert } from "./paymentAlerts";
import { logPaymentEvent } from "./paymentEvents";
import { chargeYookassaSavedMethod } from "./yookassa";

const RENEW_WINDOW_MS = 36 * 60 * 60 * 1000;

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

export async function handleYookassaRenewalFailure(
  db: SupabaseClient,
  params: {
    contractId: string;
    paymentId: string;
    periodKey?: string | null;
    userId: string;
    paymentMethodId?: string | null;
    reason?: string | null;
  },
): Promise<{ cancelled: boolean; failCount: number }> {
  const { data, error } = await db.rpc("record_yookassa_renewal_failure", {
    p_contract_id: params.contractId,
    p_payment_id: params.paymentId,
    p_period_key: params.periodKey ?? null,
    p_reason: params.reason ?? "canceled",
  });
  if (error) throw error;
  return data as { cancelled: boolean; failCount: number };
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
          periodKey,
          logTag: "yookassa-cron",
        });
        succeeded += 1;
      } else if (payment.status === "canceled" || payment.status === "cancelled") {
        const reason = payment.cancellation_details?.reason ?? payment.status;
        await handleYookassaRenewalFailure(db, {
          contractId: contract.contract_id,
          paymentId: payment.id,
          periodKey,
          userId: contract.user_id,
          paymentMethodId: methodId,
          reason,
        });
        await noteYookassaRenewalFailure(db, contract, reason, payment);
        failed += 1;
      } else {
        // pending — wait for webhook
        console.log("[yookassa-cron] renew pending", contract.contract_id, payment.id, payment.status);
      }
    } catch (err) {
      console.error("[yookassa-cron] charge failed", contract.contract_id, err);
      const reason = err instanceof Error ? err.message : String(err);
      // Unknown outcome (network, API or local fulfillment error) is not a declined charge.
      // Repeating with the same periodKey reuses YooKassa's idempotence key.
      await noteYookassaRenewalFailure(db, contract, reason, null, "yookassa.renewal.error");
      failed += 1;
    }
  }

  return { scanned: due.length, charged, succeeded, failed, skipped };
}

async function noteYookassaRenewalFailure(
  db: SupabaseClient,
  contract: DueContract,
  reason: string,
  raw: unknown,
  eventType = "yookassa.renewal.failed",
): Promise<void> {
  await logPaymentEvent(db, {
    provider: "yookassa",
    eventType,
    contractId: contract.contract_id,
    amount: contract.amount,
    currency: contract.currency,
    status: raw == null ? "unknown" : "canceled",
    errorMessage: reason,
    raw,
  });
  await sendPaymentAlert(db, {
    eventType,
    contractId: contract.contract_id,
    userId: contract.user_id,
    tier: contract.tier,
    productKind: "subscription",
    amount: contract.amount,
    currency: contract.currency,
    provider: "yookassa",
    failureReason: reason,
    raw,
  });
}
