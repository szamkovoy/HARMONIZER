import { after } from "next/server";

import { createServiceSupabase, errorResponse, json } from "../../../_utils/supabase";
import { settlePayment } from "../../fx";
import { findPaymentContract, fulfillFirstPaymentSuccess, markContractFailed } from "../../fulfillPaymentContract";
import { cancelLavaSubscription, nextPeriodEnd } from "../../lava";
import { sendPaymentAlert } from "../../paymentAlerts";
import { logPaymentEvent } from "../../paymentEvents";
import { sendRenewalFailedNotice } from "../../renewalFailedNotice";
import { resubscribeContactOnPurchase } from "../../widgetFulfillment";

// Приём вебхуков Lava.top (оба типа: «Результат платежа» и «Регулярный платёж»).
// Аутентификация: заголовок X-Api-Key = LAVATOP_WEBHOOK_SECRET (настраивается
// в ЛК Lava при создании вебхука). Ответ 2xx останавливает ретраи Lava
// (до 20 попыток), поэтому "бизнес-невозможные" ситуации (контракт не найден)
// отвечаем 200 с пометкой, а не 5xx.
//
// События:
//   payment.success                        первый платёж -> активация контракта,
//                                          апгрейд тарифа, отмена старой подписки;
//   payment.failed                         первый платёж не прошёл -> failed;
//   subscription.recurring.payment.success продление -> сдвиг периода;
//   subscription.recurring.payment.failed  финальный отказ продления -> cancelled
//                                          (+ failure_reason), доступ до конца грейса;
//   subscription.cancelled                 отмена -> cancelled, доступ до конца периода.
export const runtime = "nodejs";

/**
 * Грейс к membership_expires_at поверх точного конца периода: ретраи списания
 * у Lava идут через 8 и 24 часа — не роняем доступ в этом окне.
 */
const RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000;

type LavaWebhookBody = {
  eventType?: string;
  contractId?: string;
  parentContractId?: string | null;
  buyer?: { email?: string };
  amount?: number;
  currency?: string;
  status?: string;
  timestamp?: string;
  errorMessage?: string | null;
  product?: { id?: string; title?: string };
};

/** Lava treats anything slower than 10s as a timeout. A stuck database call must not sit for 20s. */
const WEBHOOK_DB_TIMEOUT_MS = 4_000;

function webhookDb() {
  return createServiceSupabase({ fetchTimeoutMs: WEBHOOK_DB_TIMEOUT_MS });
}

function scheduleAfterResponse(work: () => Promise<void>) {
  after(async () => {
    try {
      await work();
    } catch (error) {
      console.error("[lava-webhook] deferred work failed", error);
    }
  });
}

function authorized(req: Request): boolean {
  const secret = process.env.LAVATOP_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-api-key")?.trim() === secret;
}

export async function POST(req: Request) {
  let rawBody: unknown = null;
  let eventName = "";
  try {
    if (!authorized(req)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as LavaWebhookBody | null;
    rawBody = body;
    const eventType = body?.eventType ?? "";
    eventName = eventType;
    const contractId = body?.contractId?.trim();
    if (!body || !eventType || !contractId) {
      const response = json({ error: "Malformed webhook body" }, { status: 400 });
      scheduleAfterResponse(() =>
        logPaymentEvent(webhookDb(), {
          provider: "lavatop",
          eventType: eventType || "malformed",
          contractId,
          raw: body,
          errorMessage: "Malformed webhook body",
          httpStatus: 400,
        }),
      );
      return response;
    }

    console.log("[lava-webhook]", eventType, {
      contractId,
      parentContractId: body.parentContractId ?? null,
      email: body.buyer?.email ?? null,
      status: body.status ?? null,
    });

    const parentContractId = body.parentContractId?.trim() || contractId;
    let response: Response;
    switch (eventType) {
      case "payment.success":
        response = await handleFirstPaymentSuccess(contractId, body);
        break;
      case "payment.failed":
        response = await handleFirstPaymentFailed(contractId, body);
        break;
      case "subscription.recurring.payment.success":
        response = await handleRenewal(parentContractId, body);
        break;
      case "subscription.recurring.payment.failed":
        // Lava шлёт это событие только по ПОСЛЕДНЕЙ попытке списания
        // (status: subscription-failed); subscription.cancelled после него
        // не приходит. Поэтому событие терминально: закрываем контракт.
        response = await handleRenewalFailed(parentContractId, body);
        break;
      case "subscription.cancelled":
        response = await handleCancelled(parentContractId);
        break;
      default:
        response = json({ ok: true, ignored: eventType });
    }
    const snapshot = response.clone();
    scheduleAfterResponse(() => recordLavaWebhook(body, parentContractId, response.status, snapshot));
    return response;
  } catch (error) {
    // 5xx -> Lava повторит доставку (до 20 попыток) — правильно для
    // транзиентных ошибок БД.
    const message = error instanceof Error ? error.message : String(error);
    scheduleAfterResponse(() =>
      logPaymentEvent(webhookDb(), {
        provider: "lavatop",
        eventType: eventName || "lava.error",
        errorMessage: message,
        raw: rawBody,
        httpStatus: 500,
      }),
    );
    return errorResponse(error);
  }
}

type ContractRow = {
  user_id: string;
  contract_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
  product_kind: string | null;
  product_ref: string | null;
  currency?: string | null;
  provider?: string | null;
  buyer_email?: string | null;
};

async function findContract(db: ReturnType<typeof createServiceSupabase>, contractId: string) {
  const { data, error } = await db
    .from("payment_contracts")
    .select(
      "user_id,contract_id,tier,status,current_period_end,product_kind,product_ref,currency,provider,buyer_email",
    )
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  return data as ContractRow | null;
}

async function settleLavaCharge(
  db: ReturnType<typeof createServiceSupabase>,
  contractId: string,
  eventType: "payment.success" | "subscription.recurring.payment.success",
  body: LavaWebhookBody,
  userId: string | null,
) {
  try {
    const settled = await settlePayment(db, {
      contractId,
      eventType,
      amount: body.amount,
      currency: body.currency,
      paidAt: body.timestamp ?? new Date().toISOString(),
      userId,
      provider: "lavatop",
    });
    if (settled) {
      console.log("[lava-webhook] settled", {
        contractId,
        eventType,
        inserted: settled.inserted,
        fx: settled.nets.fx_source,
        nets: {
          rub: settled.nets.net_amount_rub,
          eur: settled.nets.net_amount_eur,
          usd: settled.nets.net_amount_usd,
        },
      });
    }
  } catch (settleErr) {
    // Не валим активацию членства из‑за FX: Lava 2xx; nets можно досчитать позже.
    console.error("[lava-webhook] settle failed", contractId, settleErr);
  }
}

async function handleFirstPaymentSuccess(
  contractId: string,
  body: LavaWebhookBody,
): Promise<Response> {
  const db = webhookDb();
  const contract = await findPaymentContract(db, contractId);
  if (!contract) {
    // Контракт создан не через наш checkout (например, прямая ссылка Lava).
    // Отвечаем 200, чтобы Lava не ретраила: привязать его не к кому.
    console.warn("[lava-webhook] payment.success for unknown contract", contractId);
    return json({ ok: true, unknownContract: true });
  }
  // Единая активация для подписки, 30 дней, разовых покупок и виджета (общая с
  // ЮKassa): доступ пишется до ответа, расчёт курса / отмена прежней подписки /
  // письма — после. Прежние разовые покупки при этом не трогаются.
  const result = await fulfillFirstPaymentSuccess(db, {
    contract,
    amount: body.amount,
    currency: body.currency,
    paidAt: body.timestamp ?? new Date().toISOString(),
    provider: "lavatop",
    logTag: "lava-webhook",
    scheduleSlow: scheduleAfterResponse,
  });
  return json(result);
}

async function handleFirstPaymentFailed(contractId: string, body: LavaWebhookBody): Promise<Response> {
  await markContractFailed(webhookDb(), contractId, body.errorMessage);
  return json({ ok: true, failed: contractId });
}

async function handleRenewal(parentContractId: string, body: LavaWebhookBody): Promise<Response> {
  const db = webhookDb();
  const contract = await findContract(db, parentContractId);
  if (!contract) {
    console.warn("[lava-webhook] renewal for unknown contract", parentContractId);
    return json({ ok: true, unknownContract: true });
  }

  const paidAt = body.timestamp ? new Date(body.timestamp) : new Date();
  const periodEnd = nextPeriodEnd(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt);
  const nowIso = new Date().toISOString();

  const { error: contractError } = await db
    .from("payment_contracts")
    .update({ status: "active", current_period_end: periodEnd.toISOString(), updated_at: nowIso })
    .eq("contract_id", contract.contract_id);
  if (contractError) throw contractError;

  const { error: userError } = await db
    .from("users")
    .update({
      membership_tier: contract.tier,
      membership_expires_at: new Date(periodEnd.getTime() + RENEWAL_GRACE_MS).toISOString(),
    })
    .eq("id", contract.user_id);
  if (userError) throw userError;

  // Курс (внешний запрос) и рассылочный контакт — после ответа: Lava ждёт 10 секунд.
  scheduleAfterResponse(async () => {
    await settleLavaCharge(
      db,
      contract.contract_id,
      "subscription.recurring.payment.success",
      body,
      contract.user_id,
    );
    try {
      await resubscribeContactOnPurchase(db, {
        email: body.buyer?.email ?? null,
        userId: contract.user_id,
      });
    } catch (err) {
      console.error("[lava-webhook] resubscribe failed", contract.contract_id, err);
    }
  });

  return json({ ok: true, renewed: contract.contract_id, deferred: true });
}

/** Оплаченный период ещё далеко впереди — отказ продления к этому периоду не относится. */
const RENEWAL_FAILED_MAX_AHEAD_MS = 5 * 24 * 60 * 60 * 1000;

async function handleRenewalFailed(parentContractId: string, body: LavaWebhookBody): Promise<Response> {
  const db = webhookDb();
  const contract = await findContract(db, parentContractId);
  if (!contract) {
    console.warn("[lava-webhook] renewal failure for unknown contract", parentContractId);
    return json({ ok: true, unknownContract: true });
  }
  if ((contract.product_kind ?? "subscription") !== "subscription") {
    return json({ ok: true, ignored: "not a subscription" });
  }
  if (contract.status !== "active") {
    return json({ ok: true, alreadyClosed: contract.status });
  }
  const endMs = contract.current_period_end ? new Date(contract.current_period_end).getTime() : NaN;
  if (Number.isFinite(endMs) && endMs - Date.now() > RENEWAL_FAILED_MAX_AHEAD_MS) {
    console.warn("[lava-webhook] renewal failure ignored: period still ahead", contract.contract_id);
    return json({ ok: true, ignored: "period still ahead" });
  }

  const nowIso = new Date().toISOString();
  const detail = (body.errorMessage ?? body.status ?? "failed").toString().trim() || "failed";
  const { error } = await db
    .from("payment_contracts")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      updated_at: nowIso,
      failure_reason: `renewal: ${detail}`.slice(0, 500),
    })
    .eq("contract_id", contract.contract_id)
    .eq("status", "active");
  if (error) throw error;
  console.warn("[lava-webhook] subscription lapsed after failed renewal", {
    contractId: contract.contract_id,
    email: body.buyer?.email ?? null,
    reason: detail,
  });

  // users.membership_* не трогаем: доступ доживает до membership_expires_at.
  // На стороне Lava закрываем подписку явно, чтобы не было позднего списания.
  const email = body.buyer?.email?.trim();
  if (email) {
    scheduleAfterResponse(async () => {
      await cancelLavaSubscription({ contractId: contract.contract_id, email });
    });
  }
  scheduleAfterResponse(() =>
    sendRenewalFailedNotice(
      webhookDb(),
      {
        user_id: contract.user_id,
        contract_id: contract.contract_id,
        tier: contract.tier,
        currency: contract.currency,
        provider: contract.provider ?? "lavatop",
        buyer_email: contract.buyer_email ?? email ?? null,
        current_period_end: contract.current_period_end,
      },
      email,
    ),
  );
  return json({ ok: true, lapsed: contract.contract_id });
}

async function recordLavaWebhook(
  body: LavaWebhookBody,
  parentContractId: string,
  httpStatus: number,
  snapshot: Response,
): Promise<void> {
  let handled: unknown = null;
  try {
    handled = await snapshot.json();
  } catch {
    handled = null;
  }
  const db = webhookDb();
  const eventType = body.eventType ?? "unknown";
  await logPaymentEvent(db, {
    provider: "lavatop",
    eventType,
    contractId: body.contractId ?? parentContractId,
    parentContractId: body.parentContractId,
    buyerEmail: body.buyer?.email,
    amount: typeof body.amount === "number" ? body.amount : null,
    currency: body.currency,
    status: body.status,
    errorMessage: body.errorMessage,
    raw: body,
    handledResult: handled,
    httpStatus,
  });
  if (eventType !== "payment.failed" && eventType !== "subscription.recurring.payment.failed") return;
  const { data } = await db
    .from("payment_contracts")
    .select("user_id,tier,product_kind,amount,currency,buyer_email,failure_reason")
    .eq("contract_id", parentContractId)
    .maybeSingle();
  await sendPaymentAlert(db, {
    eventType,
    contractId: parentContractId,
    userId: (data?.user_id as string | null) ?? null,
    buyerEmail: body.buyer?.email ?? (data?.buyer_email as string | null) ?? null,
    tier: (data?.tier as string | null) ?? null,
    productKind: (data?.product_kind as string | null) ?? null,
    amount: typeof body.amount === "number" ? body.amount : ((data?.amount as number | null) ?? null),
    currency: body.currency ?? (data?.currency as string | null) ?? null,
    provider: "lavatop",
    failureReason: (data?.failure_reason as string | null) ?? body.errorMessage ?? null,
    raw: body,
  });
}

async function handleCancelled(parentContractId: string): Promise<Response> {
  const db = webhookDb();
  const contract = await findContract(db, parentContractId);
  if (!contract) {
    console.warn("[lava-webhook] cancellation for unknown contract", parentContractId);
    return json({ ok: true, unknownContract: true });
  }
  if (contract.status === "cancelled") {
    return json({ ok: true, alreadyCancelled: true });
  }

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("payment_contracts")
    .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
    .eq("contract_id", contract.contract_id);
  if (error) throw error;

  // users.membership_* не трогаем: доступ по оплаченному периоду сохраняется
  // до membership_expires_at, дальше paidAccess сам вернёт free.
  return json({ ok: true, cancelled: contract.contract_id });
}
