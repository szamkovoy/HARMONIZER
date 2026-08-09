import type { SupabaseClient } from "@supabase/supabase-js";

import { selectActiveMembershipFromPayments } from "../admin/_utils/membershipFromPayments";
import {
  createYookassaRefund,
  explainYookassaPaymentAccessError,
  fetchYookassaPayment,
} from "./yookassa";

export type RefundMode = "lavatop_mark" | "yookassa_api" | "yookassa_mark";

export type RefundResult =
  | { ok: true; mode: RefundMode; contractId: string; yookassaRefundId?: string }
  | { ok: false; error: string; code: string; yookassaRefundId?: string; yookassaStatus?: string };

type ContractRow = {
  contract_id: string;
  user_id: string | null;
  status: string;
  provider: string | null;
  provider_payment_id: string | null;
  amount: number | null;
  currency: string | null;
  product_kind: string | null;
};

/**
 * Marks the latest charge refunded for stats + contract status `refunded`,
 * then revokes/restores the user's membership for that subscription payment.
 *
 * - Lava / yookassa_mark: DB-only (operator handles money outside).
 * - yookassa_api: API refund; DB+membership only when ЮKassa status is `succeeded`.
 */
export async function refundPaymentContract(
  db: SupabaseClient,
  params: { contractId: string; mode: RefundMode },
): Promise<RefundResult> {
  const { data: contract, error } = await db
    .from("payment_contracts")
    .select(
      "contract_id,user_id,status,provider,provider_payment_id,amount,currency,product_kind",
    )
    .eq("contract_id", params.contractId)
    .maybeSingle();
  if (error) throw error;
  if (!contract) {
    return { ok: false, code: "not_found", error: "Платёж не найден" };
  }

  const row = contract as ContractRow;
  if (row.status === "refunded") {
    return { ok: false, code: "already_refunded", error: "Этот платёж уже отмечен как возврат" };
  }
  if (row.status !== "active" && row.status !== "cancelled") {
    return {
      ok: false,
      code: "not_refundable",
      error: `Нельзя вернуть платёж со статусом «${row.status}»`,
    };
  }

  const provider = (row.provider ?? "").toLowerCase();
  let yookassaRefundId: string | undefined;

  if (params.mode === "yookassa_api") {
    if (provider !== "yookassa") {
      return { ok: false, code: "wrong_provider", error: "Этот платёж не через ЮKassa" };
    }
    const paymentId = row.provider_payment_id?.trim();
    if (!paymentId) {
      return {
        ok: false,
        code: "missing_payment_id",
        error: "У платежа нет provider_payment_id — возврат через API невозможен",
      };
    }
    const amount = Number(row.amount);
    if (!(amount > 0)) {
      return { ok: false, code: "bad_amount", error: "Некорректная сумма платежа" };
    }
    try {
      // Preflight: тот же shopId, что и для POST /refunds. Иначе ЮKassa
      // отдаёт непрозрачный 400 «Refund not found or forbidden».
      try {
        const payment = await fetchYookassaPayment(paymentId);
        const payStatus = (payment.status || "").toLowerCase();
        if (payStatus !== "succeeded") {
          return {
            ok: false,
            code: "yookassa_payment_not_succeeded",
            error: `В ЮKassa платёж в статусе «${payment.status || "unknown"}» — возврат через API недоступен. Оформите возврат в кабинете ЮKassa при необходимости, затем «Сделать возврат вручную».`,
          };
        }
      } catch (preflightErr) {
        const raw = preflightErr instanceof Error ? preflightErr.message : String(preflightErr);
        const bodyMatch = raw.match(/HTTP\s+(\d+):\s*([\s\S]*)/);
        const status = bodyMatch ? Number(bodyMatch[1]) : 0;
        const body = bodyMatch?.[2] ?? raw;
        const explained = explainYookassaPaymentAccessError(status, body) || explainYookassaPaymentAccessError(404, raw);
        return {
          ok: false,
          code: "yookassa_api_error",
          error: explained || raw,
        };
      }

      const refund = await createYookassaRefund({
        paymentId,
        amount,
        currency: (row.currency ?? "RUB").toUpperCase() === "RUB" ? "RUB" : "RUB",
      });
      yookassaRefundId = refund.id;
      const status = (refund.status || "").toLowerCase();
      if (status !== "succeeded") {
        // Не трогаем статус платежа и тариф — только после явного успеха.
        if (status === "pending") {
          return {
            ok: false,
            code: "yookassa_pending",
            error:
              "ЮKassa приняла заявку на возврат, но успех ещё не подтверждён (статус: pending). Статус платежа и тариф пользователя не изменены. При подтверждении статус обновится по webhook refund.succeeded — либо отметьте возврат вручную.",
            yookassaRefundId,
            yookassaStatus: status,
          };
        }
        return {
          ok: false,
          code: "yookassa_not_succeeded",
          error: `ЮKassa не подтвердила успех возврата (статус: ${refund.status || "unknown"}). Статус платежа и тариф не изменены.`,
          yookassaRefundId,
          yookassaStatus: status || "unknown",
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, code: "yookassa_api_error", error: msg };
    }
  } else if (params.mode === "lavatop_mark") {
    if (provider !== "lavatop" && provider !== "lava") {
      return { ok: false, code: "wrong_provider", error: "Этот платёж не через Lava.top" };
    }
  } else if (params.mode === "yookassa_mark") {
    if (provider !== "yookassa") {
      return { ok: false, code: "wrong_provider", error: "Этот платёж не через ЮKassa" };
    }
  } else {
    return { ok: false, code: "bad_mode", error: "Неизвестный режим возврата" };
  }

  await markContractAndSettlementsRefunded(db, row);

  return {
    ok: true,
    mode: params.mode,
    contractId: row.contract_id,
    ...(yookassaRefundId ? { yookassaRefundId } : {}),
  };
}

/** DB side of refund (also used when YooKassa sends refund.succeeded webhook). */
export async function markContractAndSettlementsRefunded(
  db: SupabaseClient,
  contract: Pick<ContractRow, "contract_id" | "user_id" | "product_kind">,
): Promise<void> {
  const nowIso = new Date().toISOString();

  const { data: latestSettlement } = await db
    .from("payment_settlements")
    .select("id")
    .eq("contract_id", contract.contract_id)
    .is("refunded_at", null)
    .order("paid_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestSettlement?.id) {
    const { error: settleErr } = await db
      .from("payment_settlements")
      .update({ refunded_at: nowIso })
      .eq("id", latestSettlement.id as string);
    if (settleErr) throw settleErr;
  }

  const { error: contractErr } = await db
    .from("payment_contracts")
    .update({
      status: "refunded",
      refunded_at: nowIso,
      cancelled_at: nowIso,
      payment_method_id: null,
      updated_at: nowIso,
    })
    .eq("contract_id", contract.contract_id);
  if (contractErr) throw contractErr;

  if (contract.user_id && (contract.product_kind ?? "subscription") === "subscription") {
    await db
      .from("yookassa_payment_methods")
      .update({ status: "inactive", updated_at: nowIso })
      .eq("user_id", contract.user_id)
      .in("status", ["active", "pending"]);
    await revokeOrRestoreMembershipAfterRefund(db, contract.user_id);
  }
}

/**
 * После возврата подписки: лучший ещё действующий тариф среди оставшихся
 * subscription-контрактов (active/cancelled) и ручных грантов; иначе free.
 * Пример: возврат Master при живом Mentor → Mentor; иначе Navigator/free.
 */
async function revokeOrRestoreMembershipAfterRefund(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  const [contractsRes, grantsRes] = await Promise.all([
    db
      .from("payment_contracts")
      .select("tier,current_period_end,created_at,status,product_kind")
      .eq("user_id", userId)
      .in("status", ["active", "cancelled"]),
    db.from("payments").select("tier, paid_until, created_at").eq("user_id", userId),
  ]);
  if (contractsRes.error) throw contractsRes.error;
  if (grantsRes.error) throw grantsRes.error;

  const fromContracts = (contractsRes.data ?? [])
    .filter((c) => (c.product_kind ?? "subscription") === "subscription")
    .map((c) => ({
      tier: String(c.tier ?? ""),
      paid_until: (c.current_period_end as string | null) ?? null,
      created_at: String(c.created_at ?? new Date(0).toISOString()),
    }));

  const fromGrants = (grantsRes.data ?? []).map((p) => ({
    tier: String(p.tier ?? ""),
    paid_until: (p.paid_until as string | null) ?? null,
    created_at: String(p.created_at ?? new Date(0).toISOString()),
  }));

  const active = selectActiveMembershipFromPayments([...fromContracts, ...fromGrants]);
  if (!active) {
    const { error } = await db
      .from("users")
      .update({ membership_tier: "free", membership_expires_at: null })
      .eq("id", userId);
    if (error) throw error;
    return;
  }

  const { error: userErr } = await db
    .from("users")
    .update({
      membership_tier: active.tier,
      membership_expires_at: active.paid_until,
    })
    .eq("id", userId);
  if (userErr) throw userErr;
}
