import { createServiceSupabase, errorResponse, json } from "../../../_utils/supabase";
import {
  findPaymentContract,
  fulfillFirstPaymentSuccess,
  fulfillYookassaRenewal,
  markContractCancelled,
  markContractFailed,
} from "../../fulfillPaymentContract";
import { handleYookassaRenewalFailure } from "../../yookassaRenewals";
import { markContractAndSettlementsRefunded } from "../../refundPaymentContract";
import { fetchYookassaPayment, type YookassaPayment } from "../../yookassa";

/**
 * Вебхуки ЮKassa: payment.succeeded / payment.canceled / refund.succeeded.
 * URL: https://<vercel>/api/account/webhooks/yookassa
 *
 * Auth: если задан YOOKASSA_WEBHOOK_SECRET — требуем Authorization Bearer/Basic
 * или заголовок X-Yookassa-Signature с тем же секретом. Всегда перечитываем
 * платёж через API (источник правды) перед активацией.
 *
 * metadata.kind=renewal → продление; иначе первый платёж.
 */
export const runtime = "nodejs";

type YookassaNotification = {
  type?: string;
  event?: string;
  object?: YookassaPayment;
};

function authorized(req: Request): boolean {
  const secret = process.env.YOOKASSA_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth === `Bearer ${secret}`) return true;
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      if (decoded === secret || decoded === `:${secret}` || decoded.endsWith(`:${secret}`)) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  const sig = req.headers.get("x-yookassa-signature")?.trim();
  if (sig && sig === secret) return true;
  return false;
}

function parseAmount(payment: YookassaPayment): number | null {
  const raw = payment.amount?.value;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function persistPaymentMethodIfAny(
  db: ReturnType<typeof createServiceSupabase>,
  contractId: string,
  userId: string,
  payment: YookassaPayment,
): Promise<void> {
  const methodId = payment.payment_method?.id?.trim();
  if (!methodId) return;

  const nowIso = new Date().toISOString();
  const { error: contractErr } = await db
    .from("payment_contracts")
    .update({ payment_method_id: methodId, updated_at: nowIso })
    .eq("contract_id", contractId);
  if (contractErr) {
    console.error("[yookassa-webhook] failed to store payment_method_id on contract", contractErr);
  }

  if (payment.payment_method?.saved) {
    const { error: methodErr } = await db.from("yookassa_payment_methods").upsert(
      {
        user_id: userId,
        payment_method_id: methodId,
        status: "active",
        card_last4: payment.payment_method.card?.last4 ?? null,
        updated_at: nowIso,
      },
      { onConflict: "payment_method_id" },
    );
    if (methodErr) {
      console.error("[yookassa-webhook] failed to upsert yookassa_payment_methods", methodErr);
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!authorized(req)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as YookassaNotification | null;
    const event = body?.event ?? "";
    const objectId = body?.object?.id?.trim();
    if (!body || !event || !objectId) {
      return json({ error: "Malformed webhook body" }, { status: 400 });
    }

    if (event === "refund.succeeded") {
      // object for refund.succeeded is a refund; payment_id points to original payment.
      const refundObj = body.object as { payment_id?: string; id?: string } | undefined;
      const originalPaymentId = refundObj?.payment_id?.trim() || "";
      if (!originalPaymentId) {
        console.warn("[yookassa-webhook] refund.succeeded without payment_id", objectId);
        return json({ ok: true, ignored: "refund_without_payment_id" });
      }
      const payment = await fetchYookassaPayment(originalPaymentId);
      const contractId = payment.metadata?.contractId?.trim() || "";
      if (!contractId) {
        return json({ ok: true, unknownContract: true });
      }
      const db = createServiceSupabase();
      const contract = await findPaymentContract(db, contractId);
      if (!contract) return json({ ok: true, unknownContract: true });
      if (contract.status === "refunded") return json({ ok: true, already: true });
      await markContractAndSettlementsRefunded(db, {
        contract_id: contract.contract_id,
        user_id: contract.user_id,
        product_kind: contract.product_kind,
      });
      return json({ ok: true, refunded: contractId, refundId: refundObj?.id ?? objectId });
    }

    const payment = await fetchYookassaPayment(objectId);
    const contractId =
      payment.metadata?.contractId?.trim() ||
      body.object?.metadata?.contractId?.trim() ||
      "";
    const metaKind =
      payment.metadata?.kind?.trim() || body.object?.metadata?.kind?.trim() || "";

    console.log("[yookassa-webhook]", event, {
      paymentId: payment.id,
      status: payment.status,
      paid: payment.paid ?? null,
      contractId: contractId || null,
      kind: metaKind || null,
    });

    if (!contractId) {
      console.warn("[yookassa-webhook] missing metadata.contractId", payment.id);
      return json({ ok: true, unknownContract: true });
    }

    const db = createServiceSupabase();
    const contract = await findPaymentContract(db, contractId);
    if (!contract) {
      console.warn("[yookassa-webhook] unknown contract", contractId);
      return json({ ok: true, unknownContract: true });
    }

    if (payment.id) {
      // Always keep the latest succeeded/notified payment id — renewals must
      // overwrite the first-charge id so admin refund hits the current charge.
      await db
        .from("payment_contracts")
        .update({
          provider_payment_id: payment.id,
          updated_at: new Date().toISOString(),
        })
        .eq("contract_id", contractId);
    }

    const isRenewal = metaKind === "renewal";

    if (event === "payment.succeeded" || payment.status === "succeeded") {
      if (payment.status !== "succeeded") {
        return json({ ok: true, ignored: "notification ahead of status" });
      }

      await persistPaymentMethodIfAny(db, contractId, contract.user_id, payment);

      if (isRenewal) {
        const result = await fulfillYookassaRenewal(db, {
          contract,
          amount: parseAmount(payment),
          currency: payment.amount?.currency ?? "RUB",
          paidAt: payment.created_at ?? new Date().toISOString(),
          logTag: "yookassa-webhook",
        });
        return json(result);
      }

      const result = await fulfillFirstPaymentSuccess(db, {
        contract,
        amount: parseAmount(payment),
        currency: payment.amount?.currency ?? "RUB",
        paidAt: payment.created_at ?? new Date().toISOString(),
        provider: "yookassa",
        logTag: "yookassa-webhook",
      });
      return json(result);
    }

    if (event === "payment.canceled" || payment.status === "canceled") {
      if (isRenewal) {
        const outcome = await handleYookassaRenewalFailure(db, {
          contractId,
          userId: contract.user_id,
          paymentMethodId: payment.payment_method?.id ?? contract.payment_method_id,
          reason: payment.cancellation_details?.reason ?? "canceled",
        });
        return json({ ok: true, renewalFailed: true, ...outcome });
      }

      await markContractFailed(db, contractId);
      if (contract.status === "active") {
        await markContractCancelled(db, contractId);
      }
      return json({ ok: true, canceled: contractId });
    }

    return json({ ok: true, ignored: event });
  } catch (error) {
    return errorResponse(error);
  }
}
