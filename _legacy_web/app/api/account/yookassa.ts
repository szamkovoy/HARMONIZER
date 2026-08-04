import { randomUUID } from "crypto";

const YOOKASSA_API = "https://api.yookassa.ru/v3";

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function basicAuthHeader(): string {
  const shopId = requiredEnv("YOOKASSA_SHOP_ID");
  const secret = requiredEnv("YOOKASSA_SECRET_KEY");
  return `Basic ${Buffer.from(`${shopId}:${secret}`).toString("base64")}`;
}

function isRecurringNotAllowedError(status: number, bodyText: string): boolean {
  return status === 403 && /can'?t make recurring|recurring payments/i.test(bodyText);
}

export type YookassaCreatePaymentParams = {
  /** Наш contract_id (uuid), уходит в metadata и Idempotence-Key namespace. */
  contractId: string;
  userId: string;
  amount: number;
  currency: "RUB";
  description: string;
  tier: string;
  kind: "subscription" | "one_time";
  webinarId?: string | null;
  /** Подписки: ограничить картой; разовые — Умный платёж (все методы магазина). */
  cardOnly?: boolean;
};

export type YookassaPayment = {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  confirmation?: { type?: string; confirmation_url?: string };
  payment_method?: {
    id?: string;
    saved?: boolean;
    type?: string;
    card?: { last4?: string };
  };
  metadata?: Record<string, string>;
  created_at?: string;
  cancellation_details?: { party?: string; reason?: string };
};

function truncateDescription(text: string): string {
  const t = text.trim();
  return t.length <= 128 ? t : `${t.slice(0, 125)}…`;
}

/**
 * Создаёт платёж ЮKassa (redirect confirmation) и возвращает confirmation_url.
 * capture: true — одностадийный платёж.
 *
 * Подписки: всегда просим `save_payment_method` (автоплатёж). Если магазин ещё
 * не разрешил recurring — один retry без save (обычная оплата +30d), без смены env.
 */
export async function createYookassaPayment(
  params: YookassaCreatePaymentParams,
): Promise<{ payment: YookassaPayment; confirmationUrl: string }> {
  const returnUrl = requiredEnv("YOOKASSA_RETURN_URL");
  const amountValue = params.amount.toFixed(2);
  const wantSaveMethod = params.kind === "subscription";

  const buildBody = (savePaymentMethod: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      amount: { value: amountValue, currency: params.currency },
      capture: true,
      confirmation: { type: "redirect", return_url: returnUrl },
      description: truncateDescription(params.description),
      metadata: {
        contractId: params.contractId,
        userId: params.userId,
        tier: params.tier,
        kind: params.kind,
        ...(params.webinarId ? { webinarId: params.webinarId } : {}),
      },
    };
    if (savePaymentMethod) {
      body.save_payment_method = true;
    }
    // Подписки: только банковская карта (задел под рекуррент). Разовые — Умный платёж.
    if (params.cardOnly ?? params.kind === "subscription") {
      body.payment_method_data = { type: "bank_card" };
    }
    return body;
  };

  const postPayment = async (savePaymentMethod: boolean, idempotenceKey: string) => {
    const res = await fetch(`${YOOKASSA_API}/payments`, {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey,
      },
      body: JSON.stringify(buildBody(savePaymentMethod)),
    });
    const text = await res.text();
    return { res, text };
  };

  const baseKey = params.contractId || randomUUID();
  let { res, text } = await postPayment(wantSaveMethod, baseKey);

  if (!res.ok && wantSaveMethod && isRecurringNotAllowedError(res.status, text)) {
    console.warn(
      "[yookassa] shop rejected save_payment_method — retrying without recurring;",
      "payment still works; auto-renew starts once YooKassa enables autopay on the shop",
    );
    ({ res, text } = await postPayment(false, `${baseKey}:nosave`.slice(0, 64)));
  }

  if (!res.ok) {
    throw new Error(`YooKassa create payment HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const payment = JSON.parse(text) as YookassaPayment;
  const confirmationUrl = payment.confirmation?.confirmation_url?.trim();
  if (!payment.id || !confirmationUrl) {
    throw new Error("YooKassa payment: missing id or confirmation_url");
  }
  return { payment, confirmationUrl };
}

/** Проверка вебхука: читаем платёж у ЮKassa (источник правды по статусу). */
export async function fetchYookassaPayment(paymentId: string): Promise<YookassaPayment> {
  const res = await fetch(`${YOOKASSA_API}/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: {
      Authorization: basicAuthHeader(),
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YooKassa get payment HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as YookassaPayment;
}

export type YookassaRenewChargeParams = {
  contractId: string;
  userId: string;
  tier: string;
  amount: number;
  paymentMethodId: string;
  /** current_period_end ISO — часть Idempotence-Key */
  periodKey: string;
  description: string;
};

/**
 * Безакцептное списание по сохранённому payment_method_id (автоплатёж).
 * Без confirmation — пользователь не подтверждает UI.
 */
/** Полный возврат платежа через API ЮKassa. */
export async function createYookassaRefund(params: {
  paymentId: string;
  amount: number;
  currency: "RUB";
}): Promise<{ id: string; status: string }> {
  const amountValue = params.amount.toFixed(2);
  const res = await fetch(`${YOOKASSA_API}/refunds`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      "Idempotence-Key": `refund:${params.paymentId}`.slice(0, 64),
    },
    body: JSON.stringify({
      payment_id: params.paymentId,
      amount: { value: amountValue, currency: params.currency },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Платёж не найден в ЮKassa (возможно, неверный shopId или payment id)");
    }
    if (/already refunded|refunded|недоступен для возврата/i.test(text)) {
      throw new Error("ЮKassa отклонила возврат: платёж уже возвращён или недоступен для возврата");
    }
    throw new Error(`ЮKassa refund HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as { id?: string; status?: string };
  if (!body.id) throw new Error("ЮKassa refund: в ответе нет id");
  return { id: body.id, status: body.status ?? "unknown" };
}

export async function chargeYookassaSavedMethod(
  params: YookassaRenewChargeParams,
): Promise<YookassaPayment> {
  const amountValue = params.amount.toFixed(2);
  const idempotenceKey = `renew:${params.contractId}:${params.periodKey}`.slice(0, 64);

  const body = {
    amount: { value: amountValue, currency: "RUB" },
    capture: true,
    payment_method_id: params.paymentMethodId,
    description: truncateDescription(params.description),
    metadata: {
      contractId: params.contractId,
      userId: params.userId,
      tier: params.tier,
      kind: "renewal",
      periodKey: params.periodKey,
    },
  };

  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      "Idempotence-Key": idempotenceKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`YooKassa renew charge HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const payment = JSON.parse(text) as YookassaPayment;
  if (!payment.id) {
    throw new Error("YooKassa renew charge: missing payment id");
  }
  return payment;
}
