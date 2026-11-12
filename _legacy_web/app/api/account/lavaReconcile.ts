import type { SupabaseClient } from "@supabase/supabase-js";

import { findPaymentContract, fulfillFirstPaymentSuccess } from "./fulfillPaymentContract";
import { getLavaInvoice } from "./lava";
import { sendPaymentAlert } from "./paymentAlerts";
import { logPaymentEvent } from "./paymentEvents";

/** First look ~10 min after checkout, second ~20 min, then stop. */
export const LAVA_RECONCILE_MIN_AGE_MS = 10 * 60 * 1000;
export const LAVA_RECONCILE_MAX_AGE_MS = 22 * 60 * 1000;
const BATCH = 10;

export function lavaReconcileDue(createdAtMs: number, nowMs: number): boolean {
  const age = nowMs - createdAtMs;
  return age >= LAVA_RECONCILE_MIN_AGE_MS && age <= LAVA_RECONCILE_MAX_AGE_MS;
}

export const RECONCILE_FAILED_REASON = "reconcile: invoice FAILED";

export type LavaReconcileDecision = "fulfill" | "fail" | "wait";

/** Map a Lava invoice status onto what our pending contract should do. */
export function lavaInvoiceDecision(status: string | null | undefined): LavaReconcileDecision {
  const normalized = (status ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "completed" || normalized === "success") return "fulfill";
  if (normalized === "failed") return "fail";
  return "wait";
}

export type LavaReconcileResult = {
  checked: number;
  fulfilled: string[];
  failed: string[];
  waiting: number;
  errors: { contractId: string; message: string }[];
};

/**
 * One or two looks at a specific pending Lava invoice, about 10 and 20 minutes
 * after it was opened. No Lava call for invoices outside that window, and none
 * at all when nothing is pending. A completed invoice is fulfilled; an open
 * checkout is left pending so a later webhook can still land.
 */
export async function reconcilePendingLavaPayments(
  db: SupabaseClient,
): Promise<LavaReconcileResult> {
  const now = Date.now();
  const newest = new Date(now - LAVA_RECONCILE_MIN_AGE_MS).toISOString();
  const oldest = new Date(now - LAVA_RECONCILE_MAX_AGE_MS).toISOString();
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id")
    .eq("provider", "lavatop")
    .eq("status", "pending")
    .lte("created_at", newest)
    .gte("created_at", oldest)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) throw error;

  const result: LavaReconcileResult = {
    checked: 0,
    fulfilled: [],
    failed: [],
    waiting: 0,
    errors: [],
  };

  for (const row of data ?? []) {
    const contractId = row.contract_id as string;
    result.checked += 1;
    try {
      const invoice = await getLavaInvoice(contractId);
      if (!invoice) {
        result.waiting += 1;
        continue;
      }
      const decision = lavaInvoiceDecision(invoice.status);
      if (decision === "wait") {
        result.waiting += 1;
        continue;
      }
      if (decision === "fail") {
        const { error: failError } = await db
          .from("payment_contracts")
          .update({
            status: "failed",
            failure_reason: RECONCILE_FAILED_REASON,
            updated_at: new Date().toISOString(),
          })
          .eq("contract_id", contractId)
          .eq("status", "pending");
        if (failError) throw failError;
        await logPaymentEvent(db, {
          provider: "lavatop",
          eventType: "lava.reconcile.failed",
          contractId,
          status: "failed",
          errorMessage: RECONCILE_FAILED_REASON,
          raw: invoice,
          httpStatus: 200,
        });
        await sendPaymentAlert(db, {
          eventType: "lava.reconcile.failed",
          contractId,
          provider: "lavatop",
          failureReason: RECONCILE_FAILED_REASON,
          raw: invoice,
        });
        result.failed.push(contractId);
        continue;
      }
      const contract = await findPaymentContract(db, contractId);
      if (!contract || contract.status !== "pending") {
        result.waiting += 1;
        continue;
      }
      const rawAmount = invoice.receipt?.amount ?? contract.amount;
      const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? rawAmount : null;
      const currency = invoice.receipt?.currency ?? contract.currency ?? null;
      await fulfillFirstPaymentSuccess(db, {
        contract,
        amount,
        currency,
        paidAt: invoice.datetime ?? new Date().toISOString(),
        provider: "lavatop",
        logTag: "lava-reconcile",
      });
      result.fulfilled.push(contractId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[lava-reconcile]", contractId, message);
      result.errors.push({ contractId, message: message.slice(0, 300) });
    }
  }

  return result;
}
