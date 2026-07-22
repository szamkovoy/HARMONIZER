import { randomUUID } from "crypto";

import { isYookassaRecurringEnabled } from "./selectPaymentProvider";

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
};

function truncateDescription(text: string): string {
  const t = text.trim();
  return t.length <= 128 ? t : `${t.slice(0, 125)}…`;
}

/**
 * Создаёт платёж ЮKassa (redirect confirmation) и возвращает confirmation_url.
 * capture: true — одностадийный платёж.
 */
export async function createYookassaPayment(
  params: YookassaCreatePaymentParams,
): Promise<{ payment: YookassaPayment; confirmationUrl: string }> {
  const returnUrl = requiredEnv("YOOKASSA_RETURN_URL");
  const amountValue = params.amount.toFixed(2);
  const recurring = isYookassaRecurringEnabled() && params.kind === "subscription";

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

  if (recurring) {
    body.save_payment_method = true;
  }

  // Подписки: только банковская карта (задел под рекуррент). Разовые — Умный платёж.
  if (params.cardOnly ?? params.kind === "subscription") {
    body.payment_method_data = { type: "bank_card" };
  }

  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
      "Idempotence-Key": params.contractId || randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
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
