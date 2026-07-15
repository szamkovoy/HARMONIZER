import { createServiceSupabase, errorResponse, json } from "../../../_utils/supabase";
import { cancelLavaSubscription, nextPeriodEnd } from "../../lava";

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
//   subscription.recurring.payment.failed  неудачное списание (Lava ретраит сама);
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

function authorized(req: Request): boolean {
  const secret = process.env.LAVATOP_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  return req.headers.get("x-api-key")?.trim() === secret;
}

export async function POST(req: Request) {
  try {
    if (!authorized(req)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as LavaWebhookBody | null;
    const eventType = body?.eventType ?? "";
    const contractId = body?.contractId?.trim();
    if (!body || !eventType || !contractId) {
      return json({ error: "Malformed webhook body" }, { status: 400 });
    }

    console.log("[lava-webhook]", eventType, {
      contractId,
      parentContractId: body.parentContractId ?? null,
      email: body.buyer?.email ?? null,
      status: body.status ?? null,
    });

    switch (eventType) {
      case "payment.success":
        return await handleFirstPaymentSuccess(contractId);
      case "payment.failed":
        return await handleFirstPaymentFailed(contractId);
      case "subscription.recurring.payment.success":
        return await handleRenewal(body.parentContractId?.trim() || contractId, body.timestamp);
      case "subscription.recurring.payment.failed":
        // Lava сама ретраит (8ч/24ч); при финальном провале придёт
        // subscription.cancelled. Здесь только фиксируем факт.
        return json({ ok: true, noted: "recurring failure, awaiting retries" });
      case "subscription.cancelled":
        return await handleCancelled(body.parentContractId?.trim() || contractId);
      default:
        return json({ ok: true, ignored: eventType });
    }
  } catch (error) {
    // 5xx -> Lava повторит доставку (до 20 попыток) — правильно для
    // транзиентных ошибок БД.
    return errorResponse(error);
  }
}

type ContractRow = {
  user_id: string;
  contract_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
};

async function findContract(db: ReturnType<typeof createServiceSupabase>, contractId: string) {
  const { data, error } = await db
    .from("payment_contracts")
    .select("user_id,contract_id,tier,status,current_period_end")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  return data as ContractRow | null;
}

async function handleFirstPaymentSuccess(contractId: string): Promise<Response> {
  const db = createServiceSupabase();
  const contract = await findContract(db, contractId);
  if (!contract) {
    // Контракт создан не через наш checkout (например, прямая ссылка Lava).
    // Отвечаем 200, чтобы Lava не ретраила: привязать его не к кому.
    console.warn("[lava-webhook] payment.success for unknown contract", contractId);
    return json({ ok: true, unknownContract: true });
  }
  if (contract.status === "active") {
    return json({ ok: true, alreadyActive: true });
  }

  const periodEnd = nextPeriodEnd();
  const nowIso = new Date().toISOString();

  const { error: contractError } = await db
    .from("payment_contracts")
    .update({ status: "active", current_period_end: periodEnd.toISOString(), updated_at: nowIso })
    .eq("contract_id", contractId);
  if (contractError) throw contractError;

  // Апгрейд тарифа пользователя (политика A3: немедленно, без пересчёта).
  const { error: userError } = await db
    .from("users")
    .update({
      membership_tier: contract.tier,
      membership_expires_at: new Date(periodEnd.getTime() + RENEWAL_GRACE_MS).toISOString(),
    })
    .eq("id", contract.user_id);
  if (userError) throw userError;

  // Отменяем прежние активные подписки пользователя (остаток — в пользу автора).
  const { data: others, error: othersError } = await db
    .from("payment_contracts")
    .select("contract_id")
    .eq("user_id", contract.user_id)
    .eq("status", "active")
    .neq("contract_id", contractId);
  if (othersError) throw othersError;

  if (others?.length) {
    const { data: authData } = await db.auth.admin.getUserById(contract.user_id);
    const email = authData?.user?.email;
    for (const other of others) {
      try {
        if (email) await cancelLavaSubscription({ contractId: other.contract_id, email });
        const { error: cancelError } = await db
          .from("payment_contracts")
          .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
          .eq("contract_id", other.contract_id);
        if (cancelError) throw cancelError;
      } catch (cancelIssue) {
        // Не валим активацию нового тарифа: старый контракт можно отменить
        // повторно вручную/через ЛК Lava. Логируем для разбора.
        console.error("[lava-webhook] failed to cancel prior contract", other.contract_id, cancelIssue);
      }
    }
  }

  return json({ ok: true, activated: contractId });
}

async function handleFirstPaymentFailed(contractId: string): Promise<Response> {
  const db = createServiceSupabase();
  const { error } = await db
    .from("payment_contracts")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .eq("status", "pending");
  if (error) throw error;
  return json({ ok: true, failed: contractId });
}

async function handleRenewal(parentContractId: string, timestamp?: string): Promise<Response> {
  const db = createServiceSupabase();
  const contract = await findContract(db, parentContractId);
  if (!contract) {
    console.warn("[lava-webhook] renewal for unknown contract", parentContractId);
    return json({ ok: true, unknownContract: true });
  }

  const paidAt = timestamp ? new Date(timestamp) : new Date();
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

  return json({ ok: true, renewed: contract.contract_id });
}

async function handleCancelled(parentContractId: string): Promise<Response> {
  const db = createServiceSupabase();
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
