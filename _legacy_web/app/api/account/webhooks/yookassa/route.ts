import { createServiceSupabase, errorResponse, json } from "../../../_utils/supabase";
import {
  findPaymentContract,
  fulfillFirstPaymentSuccess,
  markContractCancelled,
  markContractFailed,
} from "../../fulfillPaymentContract";
import { fetchYookassaPayment, type YookassaPayment } from "../../yookassa";

/**
 * Вебхуки ЮKassa: payment.succeeded / payment.canceled.
 * URL: https://<vercel>/api/account/webhooks/yookassa
 *
 * Auth: если задан YOOKASSA_WEBHOOK_SECRET — требуем Authorization Bearer/Basic
 * или заголовок X-Yookassa-Signature с тем же секретом. Всегда перечитываем
 * платёж через API (источник правды) перед активацией.
 *
 * Чеки 54-ФЗ в первом релизе не передаём. Рекуррент — задел (сохранение
 * payment_method_id при наличии в ответе API).
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

export async function POST(req: Request) {
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

    // Источник правды — GET /v3/payments/{id}
    const payment = await fetchYookassaPayment(objectId);
    const contractId =
      payment.metadata?.contractId?.trim() ||
      body.object?.metadata?.contractId?.trim() ||
      "";

    console.log("[yookassa-webhook]", event, {
      paymentId: payment.id,
      status: payment.status,
      paid: payment.paid ?? null,
      contractId: contractId || null,
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

    // Связываем внешний payment id с контрактом (идемпотентно).
    if (payment.id) {
      await db
        .from("payment_contracts")
        .update({
          provider_payment_id: payment.id,
          updated_at: new Date().toISOString(),
        })
        .eq("contract_id", contractId)
        .is("provider_payment_id", null);
    }

    if (event === "payment.succeeded" || payment.status === "succeeded") {
      if (payment.status !== "succeeded") {
        return json({ ok: true, ignored: "notification ahead of status" });
      }

      await persistPaymentMethodIfAny(db, contractId, contract.user_id, payment);

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
      await markContractFailed(db, contractId);
      // Если уже был active — cancelled (редкий кейс refund/cancel после успеха).
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
