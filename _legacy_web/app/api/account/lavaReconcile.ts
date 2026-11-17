import type { SupabaseClient } from "@supabase/supabase-js";

import { findPaymentContract, fulfillFirstPaymentSuccess } from "./fulfillPaymentContract";
import { getLavaInvoice, getLavaSubscription, type LavaRecurrentPayment } from "./lava";
import { applySubscriptionRenewal } from "./subscriptionRenewal";
import { settlePayment } from "./fx";
import { sendPaymentAlert } from "./paymentAlerts";
import { sendRenewalFailedNotice } from "./renewalFailedNotice";
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

// ---------------------------------------------------------------------------
// Сверка продлений (subscription.recurring.*), чей вебхук не дошёл.
// Ответ поддержки Lava 2026-11-17: фактические списания видны в
// GET /api/v1/subscriptions/{id} (subscriptionStatus + recurrentPayments),
// после неудачного продления Lava делает ещё 2 попытки (8ч, 24ч), вебхук
// приходит только после финальной попытки, после провала подписка на стороне
// Lava закрывается сама (DELETE не нужен).
// ---------------------------------------------------------------------------

/** Списание может упасть чуть раньше конца периода — небольшой допуск. */
export const LAVA_RENEWAL_CHARGE_TOLERANCE_MS = 6 * 60 * 60 * 1000;
/**
 * Как долго после конца периода active-подписка остаётся кандидатом сверки.
 * SQL-зачистка lapse_stale_subscriptions закрывает контракт на 72ч, поэтому
 * в норме кандидаты живут 0–72ч; 30 дней — широкая сетка на случай простоя.
 */
export const LAVA_RENEWAL_RECONCILE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Пора ли спросить Lava о продлении: период кончился, но не слишком давно. */
export function lavaRenewalCandidate(periodEndMs: number | null, nowMs: number): boolean {
  if (periodEndMs == null || !Number.isFinite(periodEndMs)) return false;
  return periodEndMs <= nowMs && periodEndMs >= nowMs - LAVA_RENEWAL_RECONCILE_WINDOW_MS;
}

/** Последний успешный charge новее известного нам конца периода — потерянное продление. */
export function findMissedLavaRenewal(
  payments: LavaRecurrentPayment[],
  currentPeriodEndMs: number | null,
): LavaRecurrentPayment | null {
  const threshold =
    (currentPeriodEndMs != null && Number.isFinite(currentPeriodEndMs) ? currentPeriodEndMs : 0) -
    LAVA_RENEWAL_CHARGE_TOLERANCE_MS;
  let best: LavaRecurrentPayment | null = null;
  let bestMs = -Infinity;
  for (const payment of payments) {
    const paidMs = payment.datetime ? Date.parse(payment.datetime) : NaN;
    if (!Number.isFinite(paidMs)) continue;
    const norm = (payment.status ?? "").trim().toUpperCase();
    if (norm !== "COMPLETED" && norm !== "SUCCESS") continue;
    if (paidMs < threshold) continue;
    if (paidMs > bestMs) {
      best = payment;
      bestMs = paidMs;
    }
  }
  return best;
}

/** Lava закрыл подписку после провала всех попыток продления (status: FAILED). */
export function lavaSubscriptionTerminallyFailed(subscriptionStatus: string | null | undefined): boolean {
  return (subscriptionStatus ?? "").trim().toUpperCase() === "FAILED";
}

export type LavaRenewalReconcileResult = {
  candidates: number;
  /** Контракты, чьё успешное продление восстановлено сверкой. */
  applied: string[];
  /** Контракты, закрытые сверкой после терминального провала продления у Lava. */
  lapsed: string[];
  waiting: number;
  errors: { contractId: string; message: string }[];
};

type RenewalCandidateRow = {
  contract_id: string;
  user_id: string | null;
  tier: string;
  currency: string | null;
  buyer_email: string | null;
  current_period_end: string | null;
};

export const RECONCILE_RENEWAL_FAILED_REASON = "renewal: reconcile: subscription FAILED at Lava";

/**
 * Active Lava-подписки с истёкшим current_period_end: спросить Lava о факте
 * последнего списания. Успех, потерянный с вебхуком, довыдаётся тем же
 * идемпотентным RPC, что и вебхук; терминальный провал закрывает контракт и
 * шлёт покупателю то же письмо, что и вебхук renewal.payment.failed.
 * Нет кандидатов — наружу никто не ходит.
 */
export async function reconcileLavaSubscriptionRenewals(
  db: SupabaseClient,
): Promise<LavaRenewalReconcileResult> {
  const now = Date.now();
  const windowStart = new Date(now - LAVA_RENEWAL_RECONCILE_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,tier,currency,buyer_email,current_period_end")
    .eq("provider", "lavatop")
    .eq("status", "active")
    // Старые строки до миграции product_kind имели NULL = subscription.
    .or("product_kind.eq.subscription,product_kind.is.null")
    .not("current_period_end", "is", null)
    .lte("current_period_end", new Date(now).toISOString())
    .gte("current_period_end", windowStart)
    .order("current_period_end", { ascending: true })
    .limit(BATCH);
  if (error) throw error;

  const result: LavaRenewalReconcileResult = {
    candidates: data?.length ?? 0,
    applied: [],
    lapsed: [],
    waiting: 0,
    errors: [],
  };

  for (const row of data ?? []) {
    const contract = row as RenewalCandidateRow;
    const contractId = contract.contract_id;
    try {
      const subscription = await getLavaSubscription(contractId);
      if (!subscription) {
        result.errors.push({ contractId, message: "subscription not found at Lava" });
        await logPaymentEvent(db, {
          provider: "lavatop",
          eventType: "lava.reconcile.renewal.missing",
          contractId,
          status: "active",
          errorMessage: "subscription not found at Lava",
          httpStatus: 200,
        });
        continue;
      }
      const periodEndMs = contract.current_period_end ? Date.parse(contract.current_period_end) : NaN;
      const missed = findMissedLavaRenewal(subscription.recurrentPayments ?? [], periodEndMs);
      if (missed?.datetime) {
        const applied = await applySubscriptionRenewal(db, { contractId, paidAt: missed.datetime });
        if (!applied) {
          // Контракт перестал быть подпиской/статус ушёл из active|cancelled между выборкой и RPC.
          result.waiting += 1;
          continue;
        }
        try {
          await settlePayment(db, {
            contractId,
            eventType: "subscription.recurring.payment.success",
            amount: missed.amount,
            currency: missed.currency,
            paidAt: missed.datetime,
            userId: contract.user_id,
            provider: "lavatop",
          });
        } catch (settleErr) {
          // Не валим продление из-за FX: nets можно досчитать позже.
          console.error("[lava-reconcile] renewal settle failed", contractId, settleErr);
        }
        await logPaymentEvent(db, {
          provider: "lavatop",
          eventType: "lava.reconcile.renewal.applied",
          contractId,
          buyerEmail: subscription.buyer?.email ?? contract.buyer_email,
          amount: missed.amount ?? null,
          currency: missed.currency ?? null,
          status: applied.status,
          raw: { subscriptionStatus: subscription.subscriptionStatus, missed },
          handledResult: applied,
          httpStatus: 200,
        });
        result.applied.push(contractId);
        continue;
      }
      if (lavaSubscriptionTerminallyFailed(subscription.subscriptionStatus)) {
        // Lava уже закрыл подписку сам (ответ поддержки: новых списаний нет),
        // DELETE не нужен. Закрываем только если ещё active — иначе вебхук успел раньше.
        const { data: closed, error: closeError } = await db
          .from("payment_contracts")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            failure_reason: RECONCILE_RENEWAL_FAILED_REASON,
          })
          .eq("contract_id", contractId)
          .eq("status", "active")
          .select("user_id,tier,currency,provider,buyer_email,current_period_end");
        if (closeError) throw closeError;
        if (!closed || closed.length === 0) {
          result.waiting += 1;
          continue;
        }
        const closedRow = closed[0] as RenewalCandidateRow & { provider: string | null };
        await logPaymentEvent(db, {
          provider: "lavatop",
          eventType: "lava.reconcile.renewal.failed",
          contractId,
          buyerEmail: subscription.buyer?.email ?? contract.buyer_email,
          status: "cancelled",
          errorMessage: RECONCILE_RENEWAL_FAILED_REASON,
          raw: subscription,
          httpStatus: 200,
        });
        // Письма — те же, что у вебхука subscription.recurring.payment.failed;
        // дедуп алерта по contract_id + event_type не даёт дубля, если вебхук
        // придёт позже.
        await sendPaymentAlert(db, {
          eventType: "subscription.recurring.payment.failed",
          contractId,
          userId: contract.user_id,
          buyerEmail: subscription.buyer?.email ?? contract.buyer_email,
          tier: contract.tier,
          productKind: "subscription",
          currency: contract.currency,
          provider: "lavatop",
          failureReason: RECONCILE_RENEWAL_FAILED_REASON,
          raw: subscription,
        });
        await sendRenewalFailedNotice(
          db,
          {
            user_id: closedRow.user_id,
            contract_id: contractId,
            tier: closedRow.tier,
            currency: closedRow.currency,
            provider: closedRow.provider ?? "lavatop",
            buyer_email: closedRow.buyer_email,
            current_period_end: closedRow.current_period_end,
          },
          subscription.buyer?.email ?? contract.buyer_email ?? null,
        );
        result.lapsed.push(contractId);
        continue;
      }
      // Списание ещё не прошло или Lava продолжает попытки (8ч / 24ч) — ждём.
      result.waiting += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[lava-reconcile] renewal", contractId, message);
      result.errors.push({ contractId, message: message.slice(0, 300) });
      await logPaymentEvent(db, {
        provider: "lavatop",
        eventType: "lava.reconcile.renewal.error",
        contractId,
        errorMessage: message,
        httpStatus: 200,
      });
    }
  }

  return result;
}
