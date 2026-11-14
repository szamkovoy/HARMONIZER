/**
 * Письмо покупателю: оплата через виджет на лендинге не прошла (настоящий отказ, не брошенная форма).
 * Аккаунта у покупателя может ещё не быть, поэтому всё считается по email. Кнопка ведёт обратно
 * на лендинг — там в виджете доступны все способы оплаты. Язык — buyer_locale контракта.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { sendMarketingEmail } from "../_utils/marketingMail";
import { returnPageUrl } from "../widget/widgetReturn";
import { buildPayLetterBody } from "./payLetter";
import { getPayPageCopy } from "./payPageCopy";
import { logPaymentEvent } from "./paymentEvents";
import { PAYMENT_FAILED_NOTICE_EVENT, type PaymentFailedNoticeResult } from "./paymentFailedNotices";
import { isAbandonedFailure } from "./paymentFailureKind";

const NOTICE_BUTTON_COLOR = "#2E8B57";
const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

type WidgetContractRow = {
  contract_id: string;
  buyer_email: string | null;
  buyer_locale: string | null;
  widget_id: string | null;
  page_url: string | null;
  provider: string | null;
  currency: string | null;
  failure_reason: string | null;
  updated_at: string;
};

export function buildWidgetFailedEmail(params: {
  locale: string | null;
  payUrl: string;
}): { subject: string; html: string; text: string; lang: string } {
  const copy = getPayPageCopy(params.locale);
  const { bodyHtml, text } = buildPayLetterBody({
    copy,
    text: copy.widgetFailedBody,
    buttonLabel: copy.widgetFailedButton,
    buttonUrl: params.payUrl,
    buttonColor: NOTICE_BUTTON_COLOR,
  });
  const html = wrapMarketingEmailHtml({ bodyHtml, lang: copy.lang, footer: null });
  return { subject: copy.widgetFailedSubject, html, text, lang: copy.lang };
}

/** Самый свежий отказ на email получает письмо, остальные только помечаются. */
export function groupWidgetCandidates<T extends { buyer_email: string | null; updated_at: string }>(
  rows: T[],
): { send: T; suppress: T[] }[] {
  const byEmail = new Map<string, T[]>();
  for (const row of rows) {
    const email = (row.buyer_email ?? "").trim().toLowerCase();
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(row);
    byEmail.set(email, list);
  }
  return [...byEmail.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return { send: sorted[0], suppress: sorted.slice(1) };
  });
}

export async function runWidgetFailedNotices(
  db: SupabaseClient,
  now = new Date(),
): Promise<PaymentFailedNoticeResult> {
  const minUpdated = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const maxUpdated = new Date(now.getTime() - MIN_AGE_MS).toISOString();
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,buyer_email,buyer_locale,widget_id,page_url,provider,currency,failure_reason,updated_at")
    .eq("status", "failed")
    .eq("source", "widget")
    .is("failed_notice_sent_at", null)
    .not("buyer_email", "is", null)
    .not("page_url", "is", null)
    .gte("updated_at", minUpdated)
    .lte("updated_at", maxUpdated)
    .order("updated_at", { ascending: false })
    .limit(BATCH_LIMIT);
  if (error) throw error;

  // Без причины отказа письмо не шлём: счёт мог не создаться вовсе, покупатель этого не видел как отказ банка.
  const rows = ((data ?? []) as WidgetContractRow[]).filter(
    (row) => !!row.failure_reason && !isAbandonedFailure(row.failure_reason),
  );
  const result: PaymentFailedNoticeResult = { candidates: rows.length, sent: 0, skipped: 0, suppressed: 0, failed: 0 };

  for (const group of groupWidgetCandidates(rows)) {
    for (const extra of group.suppress) {
      try {
        if (await markNotice(db, extra.contract_id, now)) result.suppressed += 1;
      } catch (err) {
        result.failed += 1;
        console.error("[widget-failed-notice] suppress", extra.contract_id, err);
      }
    }
    try {
      result[await noticeOne(db, group.send, now)] += 1;
    } catch (err) {
      result.failed += 1;
      console.error("[widget-failed-notice]", group.send.contract_id, err);
    }
  }
  return result;
}

async function noticeOne(db: SupabaseClient, contract: WidgetContractRow, now: Date): Promise<"sent" | "skipped"> {
  const to = (contract.buyer_email ?? "").trim();
  // Обычный адрес лендинга: виджет открывается как всегда, без сообщения о прошлой попытке.
  const payUrl = contract.widget_id ? returnPageUrl(contract.page_url) : null;
  if (!to || !payUrl) {
    await markNotice(db, contract.contract_id, now);
    return "skipped";
  }

  const since = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const [paidRes, noticeRes] = await Promise.all([
    // Тот же виджет оплачен этим email после отказа — напоминать не о чем.
    db
      .from("payment_contracts")
      .select("contract_id")
      .eq("source", "widget")
      .eq("widget_id", contract.widget_id)
      .eq("buyer_email", contract.buyer_email)
      .eq("status", "active")
      .gt("created_at", contract.updated_at)
      .limit(1),
    // Одно письмо об отказе на адрес за сутки, включая письма по покупкам из кабинета.
    db
      .from("payment_events")
      .select("id")
      .eq("event_type", PAYMENT_FAILED_NOTICE_EVENT)
      .eq("buyer_email", to)
      .gte("created_at", since)
      .limit(1),
  ]);
  if (paidRes.error) throw paidRes.error;
  if (noticeRes.error) throw noticeRes.error;
  if ((paidRes.data?.length ?? 0) > 0 || (noticeRes.data?.length ?? 0) > 0) {
    await markNotice(db, contract.contract_id, now);
    return "skipped";
  }
  if (!(await markNotice(db, contract.contract_id, now))) return "skipped";

  const letter = buildWidgetFailedEmail({ locale: contract.buyer_locale, payUrl });
  const sent = await sendMarketingEmail({
    to,
    subject: letter.subject,
    html: letter.html,
    text: letter.text,
    locale: letter.lang,
    tags: [{ name: "kind", value: "payment_failed_notice" }],
  });
  if (!sent.ok) {
    await db.from("payment_contracts").update({ failed_notice_sent_at: null }).eq("contract_id", contract.contract_id);
    throw new Error(sent.detail || "widget failed notice was not sent");
  }
  await logPaymentEvent(db, {
    provider: contract.provider ?? "unknown",
    eventType: PAYMENT_FAILED_NOTICE_EVENT,
    contractId: contract.contract_id,
    buyerEmail: to,
    currency: contract.currency,
    status: "failed",
    errorMessage: contract.failure_reason,
  });
  return "sent";
}

async function markNotice(db: SupabaseClient, contractId: string, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from("payment_contracts")
    .update({ failed_notice_sent_at: now.toISOString() })
    .eq("contract_id", contractId)
    .is("failed_notice_sent_at", null)
    .select("contract_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
