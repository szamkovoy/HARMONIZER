/**
 * Письмо админу о сбое оплаты. Отправка не должна ронять вебхук.
 * Дедуп: одна отправка на contract_id + event_type.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { WIDGET_PUBLIC_ORIGIN } from "../../../lib/paymentWidget/config";
import { sendMarketingEmail } from "../_utils/marketingMail";
import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";

export function paymentAlertRecipient(): string | null {
  const value = process.env.PAYMENT_ALERT_EMAIL?.trim() ?? "";
  return value.includes("@") ? value : null;
}

export function formatAlertMoscowTime(date: Date): string {
  return DateTime.fromJSDate(date, { zone: "utc" }).setZone("Europe/Moscow").toFormat("dd.MM.yyyy HH:mm");
}

export type PaymentAlertInput = {
  eventType: string;
  contractId?: string | null;
  userId?: string | null;
  buyerEmail?: string | null;
  tier?: string | null;
  productKind?: string | null;
  amount?: number | null;
  currency?: string | null;
  provider?: string | null;
  failureReason?: string | null;
  raw?: unknown;
  at?: Date;
};

export function buildPaymentAlertLetter(input: PaymentAlertInput): { subject: string; text: string; html: string } {
  const at = formatAlertMoscowTime(input.at ?? new Date());
  const email = input.buyerEmail?.trim() || "—";
  const profile =
    input.userId ? `${WIDGET_PUBLIC_ORIGIN}/admin/users/${input.userId}` : "—";
  const product = [input.tier, input.productKind].filter(Boolean).join(" / ") || "—";
  const money =
    input.amount != null && input.currency ? `${input.amount} ${input.currency}` : input.currency || "—";
  const lines = [
    `Время (Europe/Moscow): ${at}`,
    `Email: ${email}`,
    `Профиль: ${profile}`,
    `Продукт: ${product}`,
    `Сумма: ${money}`,
    `Шлюз: ${input.provider || "—"}`,
    `contractId: ${input.contractId || "—"}`,
    `failure_reason: ${input.failureReason || "—"}`,
    "",
    "Сырой JSON:",
    JSON.stringify(input.raw ?? null, null, 2),
  ];
  const text = lines.join("\n");
  const subject = `Оплата: ${input.eventType}${input.contractId ? ` · ${input.contractId.slice(0, 8)}` : ""}`;
  const html = wrapMarketingEmailHtml({
    bodyHtml: `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:13px;">${escapeHtml(text)}</pre>`,
    previewText: subject,
    lang: "ru",
    footer: null,
  });
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** true — это первая заявка на письмо. Без contract_id дедуп невозможен, письмо уходит каждый раз. */
export async function claimPaymentAlert(
  db: SupabaseClient,
  contractId: string | null | undefined,
  eventType: string,
): Promise<boolean> {
  if (!contractId) return true;
  const { error } = await db.from("payment_alert_sends").insert({
    contract_id: contractId,
    event_type: eventType,
  });
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === "23505") return false;
  console.error("[payment-alert] claim failed", contractId, eventType, error.message ?? error);
  return false;
}

export async function sendPaymentAlert(db: SupabaseClient, input: PaymentAlertInput): Promise<void> {
  try {
    const to = paymentAlertRecipient();
    if (!to) {
      console.error("[payment-alert] PAYMENT_ALERT_EMAIL is not set");
      return;
    }
    if (!(await claimPaymentAlert(db, input.contractId, input.eventType))) return;
    const letter = buildPaymentAlertLetter(input);
    const sent = await sendMarketingEmail({
      to,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
      locale: "ru",
      tags: [{ name: "kind", value: "payment_alert" }],
    });
    if (!sent.ok) console.error("[payment-alert] send failed", input.contractId, sent.detail);
  } catch (err) {
    console.error("[payment-alert]", input.contractId, err);
  }
}
