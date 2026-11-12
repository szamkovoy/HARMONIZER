/**
 * Письмо покупателю: продление не прошло, доступ ещё действует до даты,
 * кнопка ведёт на /pay/renew. Язык — users.locale. Ошибка отправки не бросается.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { htmlToPlaintext, sendMarketingEmail } from "../_utils/marketingMail";
import { fillPayCopy, formatPayDate, getPayPageCopy, payTierName } from "./payPageCopy";
import { payRenewUrl } from "./passReminders";
import { PAY_RENEW_TOKEN_TTL_MS, signPayRetryToken } from "./payRetryToken";
import { isPassTier } from "./tierPass";
import { plainLetterToHtml } from "./widgetFulfillment";

const RENEW_BUTTON_COLOR = "#2E8B57";

export function buildRenewalFailedEmail(params: {
  locale: string | null;
  tier: string;
  accessUntil: string;
  renewUrl: string;
}): { subject: string; html: string; text: string; lang: string } {
  const copy = getPayPageCopy(params.locale);
  const vars = { tier: payTierName(copy, params.tier), date: formatPayDate(params.accessUntil, copy.lang) };
  const subject = fillPayCopy(copy.renewalFailedSubject, vars);
  const href = params.renewUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const label = copy.renewalFailedButton.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const bodyHtml = [
    plainLetterToHtml(fillPayCopy(copy.renewalFailedBody, vars)),
    `<p><a href="${href}" style="display:inline-block;padding:12px 22px;background:${RENEW_BUTTON_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a></p>`,
  ].join("\n");
  const html = wrapMarketingEmailHtml({ bodyHtml, previewText: subject, lang: copy.lang, footer: null });
  return { subject, html, text: `${htmlToPlaintext(bodyHtml)}\n\n${params.renewUrl}`, lang: copy.lang };
}

type NoticeContract = {
  user_id: string | null;
  contract_id: string;
  tier: string;
  currency?: string | null;
  provider?: string | null;
  buyer_email?: string | null;
  current_period_end: string | null;
};

export async function sendRenewalFailedNotice(
  db: SupabaseClient,
  contract: NoticeContract,
  buyerEmail?: string | null,
): Promise<void> {
  try {
    if (!contract.user_id || !isPassTier(contract.tier) || !contract.current_period_end) return;
    const { data: user, error } = await db
      .from("users")
      .select("locale")
      .eq("id", contract.user_id)
      .maybeSingle();
    if (error) throw error;
    const { data: authData } = await db.auth.admin.getUserById(contract.user_id);
    const to = authData?.user?.email ?? buyerEmail ?? contract.buyer_email ?? "";
    if (!to) return;
    const locale = (user?.locale as string | null) ?? "ru";
    const currency = contract.currency === "USD" || contract.currency === "EUR" ? contract.currency : "RUB";
    const token = signPayRetryToken(
      {
        userId: contract.user_id,
        tier: contract.tier,
        kind: "subscription",
        currency,
        country: contract.provider === "yookassa" ? "RU" : null,
        locale,
      },
      PAY_RENEW_TOKEN_TTL_MS,
    );
    const letter = buildRenewalFailedEmail({
      locale,
      tier: contract.tier,
      accessUntil: contract.current_period_end,
      renewUrl: payRenewUrl(token),
    });
    const sent = await sendMarketingEmail({
      to,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
      locale: letter.lang,
      tags: [{ name: "kind", value: "renewal_failed" }],
    });
    if (!sent.ok) console.error("[renewal-failed-notice]", contract.contract_id, sent.detail);
  } catch (err) {
    console.error("[renewal-failed-notice]", contract.contract_id, err);
  }
}
