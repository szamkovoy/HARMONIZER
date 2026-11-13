/**
 * Письмо за 12 часов до конца оплаченных 30 дней тарифа (раньше человек
 * откладывает оплату): одна кнопка на /pay/renew (ещё 30 дней / подписка /
 * PayPal). Одно письмо на контракт; cron ежечасный.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { WIDGET_PUBLIC_ORIGIN } from "../../../lib/paymentWidget/config";
import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { htmlToPlaintext, sendMarketingEmail } from "../_utils/marketingMail";
import { fillPayCopy, formatPayDate, getPayPageCopy, payTierName } from "./payPageCopy";
import { PAY_RENEW_TOKEN_TTL_MS, signPayRetryToken } from "./payRetryToken";
import { isPassTier } from "./tierPass";
import { plainLetterToHtml } from "./widgetFulfillment";

export const PASS_REMINDER_HOURS_BEFORE = 12;
const BATCH_LIMIT = 100;
const RENEW_BUTTON_COLOR = "#2E8B57";

export type PassReminderResult = { due: number; sent: number; skipped: number; failed: number };

type DueContract = {
  contract_id: string;
  user_id: string | null;
  tier: string;
  currency: string | null;
  provider: string | null;
  buyer_email: string | null;
  current_period_end: string;
};

export function payRenewUrl(token: string): string {
  const url = new URL("/pay/renew", WIDGET_PUBLIC_ORIGIN);
  url.searchParams.set("t", token);
  return url.toString();
}

export function buildPassReminderEmail(params: {
  locale: string | null;
  tier: string;
  expiresAt: string;
  renewUrl: string;
}): { subject: string; html: string; text: string; lang: string } {
  const copy = getPayPageCopy(params.locale);
  const vars = { tier: payTierName(copy, params.tier), date: formatPayDate(params.expiresAt, copy.lang) };
  const subject = fillPayCopy(copy.reminderSubject, vars);
  const href = params.renewUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const label = copy.reminderButton.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const bodyHtml = [
    plainLetterToHtml(fillPayCopy(copy.reminderBody, vars)),
    `<p><a href="${href}" style="display:inline-block;padding:12px 22px;background:${RENEW_BUTTON_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a></p>`,
  ].join("\n");
  const html = wrapMarketingEmailHtml({ bodyHtml, lang: copy.lang, footer: null });
  return { subject, html, text: `${htmlToPlaintext(bodyHtml)}\n\n${params.renewUrl}`, lang: copy.lang };
}

export async function sendPassReminders(db: SupabaseClient, now = new Date()): Promise<PassReminderResult> {
  const horizon = new Date(now.getTime() + PASS_REMINDER_HOURS_BEFORE * 60 * 60 * 1000);
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,tier,currency,provider,buyer_email,current_period_end")
    .eq("product_kind", "one_time")
    .in("tier", ["oracle", "master"])
    .eq("status", "active")
    .is("pass_reminder_sent_at", null)
    .gt("current_period_end", now.toISOString())
    .lte("current_period_end", horizon.toISOString())
    .order("current_period_end", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) throw error;

  const result: PassReminderResult = { due: data?.length ?? 0, sent: 0, skipped: 0, failed: 0 };
  for (const contract of (data ?? []) as DueContract[]) {
    try {
      const outcome = await remindOne(db, contract);
      result[outcome] += 1;
    } catch (err) {
      result.failed += 1;
      console.error("[pass-reminders] failed", contract.contract_id, err);
    }
  }
  return result;
}

async function remindOne(db: SupabaseClient, contract: DueContract): Promise<"sent" | "skipped"> {
  if (!contract.user_id || !isPassTier(contract.tier)) return "skipped";

  const [{ data: user, error: userError }, { data: subs, error: subsError }] = await Promise.all([
    db.from("users").select("locale,membership_tier,membership_expires_at").eq("id", contract.user_id).maybeSingle(),
    db
      .from("payment_contracts")
      .select("contract_id")
      .eq("user_id", contract.user_id)
      .eq("product_kind", "subscription")
      .eq("status", "active")
      .limit(1),
  ]);
  if (userError) throw userError;
  if (subsError) throw subsError;

  // Уже продлил (подписка или новые 30 дней) — доступ кончается позже этого контракта.
  const accessEndMs = user?.membership_expires_at ? new Date(user.membership_expires_at as string).getTime() : 0;
  const renewed = (subs?.length ?? 0) > 0 || accessEndMs > new Date(contract.current_period_end).getTime() + 60 * 60 * 1000;
  if (renewed || user?.membership_tier !== contract.tier) {
    await claim(db, contract.contract_id);
    return "skipped";
  }

  const { data: authData } = await db.auth.admin.getUserById(contract.user_id);
  const to = authData?.user?.email ?? contract.buyer_email ?? "";
  if (!to) return "skipped";
  if (!(await claim(db, contract.contract_id))) return "skipped";

  const currency = contract.currency === "USD" || contract.currency === "EUR" ? contract.currency : "RUB";
  const locale = (user?.locale as string | null) ?? "ru";
  const token = signPayRetryToken(
    {
      userId: contract.user_id,
      tier: contract.tier,
      kind: "pass",
      currency,
      country: contract.provider === "yookassa" ? "RU" : null,
      locale,
    },
    PAY_RENEW_TOKEN_TTL_MS,
  );
  const letter = buildPassReminderEmail({
    locale,
    tier: contract.tier,
    expiresAt: contract.current_period_end,
    renewUrl: payRenewUrl(token),
  });
  const sent = await sendMarketingEmail({
    to,
    subject: letter.subject,
    html: letter.html,
    text: letter.text,
    locale: letter.lang,
    tags: [{ name: "kind", value: "pass_reminder" }],
  });
  if (!sent.ok) {
    await db.from("payment_contracts").update({ pass_reminder_sent_at: null }).eq("contract_id", contract.contract_id);
    throw new Error(`pass reminder failed: ${sent.detail}`);
  }
  return "sent";
}

async function claim(db: SupabaseClient, contractId: string): Promise<boolean> {
  const { data, error } = await db
    .from("payment_contracts")
    .update({ pass_reminder_sent_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .is("pass_reminder_sent_at", null)
    .select("contract_id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
