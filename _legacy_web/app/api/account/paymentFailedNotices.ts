/**
 * Письмо покупателю: первая оплата из кабинета не прошла — тариф (подписка или
 * 30 дней), вебинар или книга. Кнопка ведёт на /pay/failed. Язык — users.locale.
 * Брошенная форма письмом не считается. Покупки через виджет сюда не входят.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { paidTierFromRow } from "@/modules/access/core/paidAccess";
import { WEBINAR_JOIN_GRACE_HOURS } from "@/modules/webinars/core/webinarTiming";
import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { htmlToPlaintext, sendMarketingEmail } from "../_utils/marketingMail";
import { logPaymentEvent } from "./paymentEvents";
import { isAbandonedFailure } from "./paymentFailureKind";
import { fillPayCopy, getPayPageCopy, payTierName } from "./payPageCopy";
import { oneTimeAlreadyPaid } from "./oneTimeCheckout";
import {
  PAY_RENEW_TOKEN_TTL_MS,
  signOneTimeRetryToken,
  signPayRetryToken,
  type OneTimeRetryProduct,
  type PayRetryKind,
} from "./payRetryToken";
import { isPassTier } from "./tierPass";
import { payFailedUrl } from "./tierCheckout";
import { plainLetterToHtml } from "./widgetFulfillment";

const NOTICE_BUTTON_COLOR = "#2E8B57";
const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 500;
export const PAYMENT_FAILED_NOTICE_EVENT = "notice.payment_failed";

export type PaymentFailedNoticeResult = {
  candidates: number;
  sent: number;
  skipped: number;
  suppressed: number;
  failed: number;
};

export type FailedNoticeFacts = {
  failureReason: string | null;
  /** Active oracle/master subscription or pass_30d created after this failure. */
  laterPaidAccess: boolean;
  /** paidTierFromRow(users) != null */
  hasPaidTier: boolean;
  /** This user already received this letter in the last 24 hours. */
  noticeSentWithin24h: boolean;
};

/**
 * Напоминаем, только если после отказа нет оплаты того же продукта;
 * oracle/master/подписка/30 дней — одна группа «доступ».
 */
export function shouldSendFailedNotice(facts: FailedNoticeFacts): boolean {
  if (isAbandonedFailure(facts.failureReason)) return false;
  if (facts.laterPaidAccess) return false;
  if (facts.hasPaidTier) return false;
  if (facts.noticeSentWithin24h) return false;
  return true;
}

export type NoticeCandidate = {
  userId: string;
  contractId: string;
  updatedAt: string;
};

/** Самый свежий отказ пользователя получает письмо, остальные только помечаются. */
export function groupFailedNoticeCandidates<T extends NoticeCandidate>(rows: T[]): { send: T; suppress: T[] }[] {
  const byUser = new Map<string, T[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  const groups = [...byUser.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { send: sorted[0], suppress: sorted.slice(1) };
  });
  groups.sort((a, b) => b.send.updatedAt.localeCompare(a.send.updatedAt));
  return groups;
}

type ContractRow = {
  contract_id: string;
  user_id: string;
  tier: string;
  currency: string | null;
  provider: string | null;
  buyer_email: string | null;
  product_kind: string | null;
  product_ref: string | null;
  failure_reason: string | null;
  updated_at: string;
  source?: string | null;
};

function isOneTimeProduct(tier: string): tier is OneTimeRetryProduct {
  return tier === "webinar" || tier === "book";
}

/** Кабинетные покупки, по которым шлём письмо: доступ по тарифу, вебинар, книга. */
function isNoticeProduct(row: ContractRow): boolean {
  if (row.source === "widget") return false;
  if (isOneTimeProduct(row.tier)) return row.product_kind === "one_time";
  return isPassTier(row.tier) && isAccessProduct(row);
}

function isAccessProduct(row: { product_kind: string | null; product_ref: string | null }): boolean {
  return row.product_kind === "subscription" || row.product_ref === "pass_30d";
}

export function buildPaymentFailedEmail(params: {
  locale: string | null;
  tier: string;
  payUrl: string;
}): { subject: string; html: string; text: string; lang: string } {
  const copy = getPayPageCopy(params.locale);
  const vars = { tier: payTierName(copy, params.tier) };
  const subjectText =
    params.tier === "webinar"
      ? copy.webinarFailedSubject
      : params.tier === "book"
        ? copy.bookFailedSubject
        : copy.paymentFailedSubject;
  const bodyText =
    params.tier === "webinar"
      ? copy.webinarFailedBody
      : params.tier === "book"
        ? copy.bookFailedBody
        : copy.paymentFailedBody;
  const subject = fillPayCopy(subjectText, vars);
  const href = params.payUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const label = copy.paymentFailedButton.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const bodyHtml = [
    plainLetterToHtml(fillPayCopy(bodyText, vars)),
    `<p><a href="${href}" style="display:inline-block;padding:12px 22px;background:${NOTICE_BUTTON_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${label}</a></p>`,
  ].join("\n");
  const html = wrapMarketingEmailHtml({ bodyHtml, lang: copy.lang, footer: null });
  return { subject, html, text: `${htmlToPlaintext(bodyHtml)}\n\n${params.payUrl}`, lang: copy.lang };
}

export async function runPaymentFailedNotices(
  db: SupabaseClient,
  now = new Date(),
): Promise<PaymentFailedNoticeResult> {
  const minUpdated = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const maxUpdated = new Date(now.getTime() - MIN_AGE_MS).toISOString();
  const { data, error } = await db
    .from("payment_contracts")
    .select(
      "contract_id,user_id,tier,currency,provider,buyer_email,product_kind,product_ref,failure_reason,updated_at,source",
    )
    .eq("status", "failed")
    .in("tier", ["oracle", "master", "webinar", "book"])
    .not("user_id", "is", null)
    .is("failed_notice_sent_at", null)
    .gte("updated_at", minUpdated)
    .lte("updated_at", maxUpdated)
    .order("updated_at", { ascending: false })
    .limit(BATCH_LIMIT);
  if (error) throw error;

  const rows = ((data ?? []) as ContractRow[]).filter(
    (row) => isNoticeProduct(row) && !isAbandonedFailure(row.failure_reason),
  );
  const result: PaymentFailedNoticeResult = {
    candidates: rows.length,
    sent: 0,
    skipped: 0,
    suppressed: 0,
    failed: 0,
  };

  for (const group of groupFailedNoticeCandidates(
    rows.map((row) => ({ ...row, userId: row.user_id, contractId: row.contract_id, updatedAt: row.updated_at })),
  )) {
    for (const extra of group.suppress) {
      try {
        if (await markNotice(db, extra.contractId, now)) result.suppressed += 1;
      } catch (err) {
        result.failed += 1;
        console.error("[payment-failed-notice] suppress", extra.contractId, err);
      }
    }
    try {
      const outcome = await noticeOne(db, group.send, now);
      result[outcome] += 1;
    } catch (err) {
      result.failed += 1;
      console.error("[payment-failed-notice]", group.send.contractId, err);
    }
  }
  return result;
}

/** Вебинар из контракта ещё можно купить: опубликован и не закончился. */
async function webinarStillOpen(db: SupabaseClient, webinarId: string | null, now: Date): Promise<boolean> {
  if (!webinarId) return false;
  const { data, error } = await db
    .from("webinars")
    .select("starts_at,is_published")
    .eq("id", webinarId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_published !== true) return false;
  const startsMs = new Date(data.starts_at as string).getTime();
  return Number.isFinite(startsMs) && startsMs + WEBINAR_JOIN_GRACE_HOURS * 60 * 60 * 1000 > now.getTime();
}

/** Покупка уже не нужна: оплачена после отказа, тариф действует, вебинар прошёл. */
async function purchaseSettled(
  db: SupabaseClient,
  contract: ContractRow & NoticeCandidate,
  user: Parameters<typeof paidTierFromRow>[0],
  now: Date,
): Promise<{ laterPaidAccess: boolean; hasPaidTier: boolean }> {
  const { data: later, error } = await db
    .from("payment_contracts")
    .select("contract_id,product_kind,product_ref,tier")
    .eq("user_id", contract.userId)
    .eq("status", "active")
    .in("tier", isOneTimeProduct(contract.tier) ? [contract.tier] : ["oracle", "master"])
    .gt("created_at", contract.updatedAt);
  if (error) throw error;
  const rows = (later ?? []) as { product_kind: string | null; product_ref: string | null }[];

  if (isOneTimeProduct(contract.tier)) {
    if (rows.length > 0) return { laterPaidAccess: true, hasPaidTier: false };
    const paid = await oneTimeAlreadyPaid(db, {
      userId: contract.userId,
      product: contract.tier,
      webinarId: contract.product_ref,
    });
    if (paid) return { laterPaidAccess: true, hasPaidTier: false };
    if (contract.tier === "webinar" && !(await webinarStillOpen(db, contract.product_ref, now))) {
      return { laterPaidAccess: true, hasPaidTier: false };
    }
    return { laterPaidAccess: false, hasPaidTier: false };
  }
  return { laterPaidAccess: rows.some(isAccessProduct), hasPaidTier: paidTierFromRow(user) != null };
}

async function noticeOne(
  db: SupabaseClient,
  contract: ContractRow & NoticeCandidate,
  now: Date,
): Promise<"sent" | "skipped"> {
  if (!isPassTier(contract.tier) && !isOneTimeProduct(contract.tier)) return "skipped";
  const [userRes, recentRes] = await Promise.all([
    db
      .from("users")
      .select("locale,membership_tier,membership_expires_at")
      .eq("id", contract.userId)
      .maybeSingle(),
    stampedContractIds(db, contract.userId, now),
  ]);
  if (userRes.error) throw userRes.error;

  const settled = await purchaseSettled(db, contract, userRes.data, now);
  const noticeSentWithin24h = await hasNoticeEvent(db, recentRes, now);
  if (
    !shouldSendFailedNotice({
      failureReason: contract.failure_reason,
      laterPaidAccess: settled.laterPaidAccess,
      hasPaidTier: settled.hasPaidTier,
      noticeSentWithin24h,
    })
  ) {
    await markNotice(db, contract.contractId, now);
    return "skipped";
  }

  const { data: authData } = await db.auth.admin.getUserById(contract.userId);
  const to = authData?.user?.email ?? contract.buyer_email ?? "";
  if (!to) {
    await markNotice(db, contract.contractId, now);
    return "skipped";
  }
  if (!(await markNotice(db, contract.contractId, now))) return "skipped";

  const locale = (userRes.data?.locale as string | null) ?? "ru";
  const currency = contract.currency === "USD" || contract.currency === "EUR" ? contract.currency : "RUB";
  const country = contract.provider === "yookassa" ? "RU" : null;
  const token = isOneTimeProduct(contract.tier)
    ? signOneTimeRetryToken(
        {
          userId: contract.userId,
          product: contract.tier,
          webinarId: contract.tier === "webinar" ? contract.product_ref : null,
          currency,
          country,
          locale,
        },
        PAY_RENEW_TOKEN_TTL_MS,
      )
    : signPayRetryToken(
        {
          userId: contract.userId,
          tier: contract.tier as "oracle" | "master",
          kind: (contract.product_kind === "subscription" ? "subscription" : "pass") satisfies PayRetryKind,
          currency,
          country,
          locale,
        },
        PAY_RENEW_TOKEN_TTL_MS,
      );
  const payUrl = payFailedUrl(token, contract.contractId);
  const letter = buildPaymentFailedEmail({ locale, tier: contract.tier, payUrl });
  const sent = await sendMarketingEmail({
    to,
    subject: letter.subject,
    html: letter.html,
    text: letter.text,
    locale: letter.lang,
    tags: [{ name: "kind", value: "payment_failed_notice" }],
  });
  if (!sent.ok) {
    await db.from("payment_contracts").update({ failed_notice_sent_at: null }).eq("contract_id", contract.contractId);
    throw new Error(sent.detail || "payment failed notice was not sent");
  }
  await logPaymentEvent(db, {
    provider: contract.provider ?? "unknown",
    eventType: PAYMENT_FAILED_NOTICE_EVENT,
    contractId: contract.contractId,
    buyerEmail: to,
    currency,
    status: "failed",
    errorMessage: contract.failure_reason,
  });
  return "sent";
}

async function stampedContractIds(db: SupabaseClient, userId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id")
    .eq("user_id", userId)
    .gte("failed_notice_sent_at", since);
  if (error) throw error;
  return ((data ?? []) as { contract_id: string }[]).map((row) => row.contract_id);
}

async function hasNoticeEvent(db: SupabaseClient, contractIds: string[], now: Date): Promise<boolean> {
  if (contractIds.length === 0) return false;
  const since = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  const { data, error } = await db
    .from("payment_events")
    .select("id")
    .eq("event_type", PAYMENT_FAILED_NOTICE_EVENT)
    .in("contract_id", contractIds)
    .gte("created_at", since)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
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
