/**
 * Landing-widget purchases after payment: buyer account + mailing contact,
 * webinar pass, product letter. Called from fulfillFirstPaymentSuccess.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { applyEmailPlaceholders, wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { buildSignedUnsubscribeUrl, generateUnsubscribeToken } from "../_utils/emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail } from "../_utils/marketingMail";
import { purchaseLetterLocale, ownI18nText } from "../_utils/webinarNoticeCopy";
import { getWidgetEmailCopy } from "../_utils/widgetEmailCopy";
import { asWidgetLocale } from "../../../lib/paymentWidget/copy";

const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeBuyerEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function waitForUsersRow(db: SupabaseClient, userId: string): Promise<boolean> {
  for (let i = 0; i < 25; i += 1) {
    const { data } = await db.from("users").select("id").eq("id", userId).maybeSingle();
    if (data?.id) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

export async function userIdFromContact(db: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await db
    .from("email_contacts")
    .select("user_id")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) throw error;
  const id = (data?.user_id as string | null) ?? null;
  if (!id) return null;
  const { data: user } = await db.from("users").select("id").eq("id", id).maybeSingle();
  return user?.id ? id : null;
}

/** Existing auth user only (called after createUser reported a duplicate). */
async function userIdFromAuth(db: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.user?.id) return null;
  return data.user.id;
}

/** A purchase means the person wants to hear from us again. Complaints and bad addresses stay as they are. */
export function marketingStatusAfterPurchase(status: string): string {
  return status === "unsubscribed" ? "active" : status;
}

export async function resubscribeContactOnPurchase(
  db: SupabaseClient,
  params: { email?: string | null; userId?: string | null },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const patch = { marketing_status: "active", updated_at: nowIso };
  const email = params.email ? normalizeBuyerEmail(params.email) : "";
  if (email) {
    const { error } = await db
      .from("email_contacts")
      .update(patch)
      .eq("email_normalized", email)
      .eq("marketing_status", "unsubscribed");
    if (error) throw error;
  }
  if (params.userId) {
    const { error } = await db
      .from("email_contacts")
      .update(patch)
      .eq("user_id", params.userId)
      .eq("marketing_status", "unsubscribed");
    if (error) throw error;
  }
}

/** Link (or create) the mailing contact. An unsubscribed contact is subscribed again. */
export async function ensureWidgetContact(
  db: SupabaseClient,
  params: { email: string; userId: string; locale: string },
): Promise<void> {
  const email = normalizeBuyerEmail(params.email);
  const { data: existing, error } = await db
    .from("email_contacts")
    .select("id,user_id,unsubscribe_token")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) throw error;
  const nowIso = new Date().toISOString();
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.user_id) patch.user_id = params.userId;
    if (!existing.unsubscribe_token) patch.unsubscribe_token = generateUnsubscribeToken();
    if (Object.keys(patch).length) {
      patch.updated_at = nowIso;
      const { error: upErr } = await db.from("email_contacts").update(patch).eq("id", existing.id);
      if (upErr) throw upErr;
    }
    await resubscribeContactOnPurchase(db, { email, userId: params.userId });
    return;
  }
  const { error: insErr } = await db.from("email_contacts").insert({
    email,
    email_normalized: email,
    user_id: params.userId,
    source: "widget",
    locale: params.locale,
    marketing_status: "active",
    unsubscribe_token: generateUnsubscribeToken(),
  });
  // A parallel webhook may have inserted it first.
  if (insErr && insErr.code !== "23505") throw insErr;
  await resubscribeContactOnPurchase(db, { email, userId: params.userId });
}

/**
 * Account for a widget buyer: existing user by email, otherwise a confirmed
 * free account. The demo trial starts at the first real sign-in, not now.
 */
export async function ensureWidgetBuyer(
  db: SupabaseClient,
  params: { email: string; name: string | null; locale: string },
): Promise<{ userId: string; created: boolean }> {
  const email = normalizeBuyerEmail(params.email);
  const name = (params.name ?? "").trim().slice(0, 120);

  let userId = await userIdFromContact(db, email);
  let created = false;
  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { ...(name ? { full_name: name } : {}), locale: params.locale },
    });
    if (data?.user?.id) {
      userId = data.user.id;
      created = true;
    } else {
      userId = await userIdFromAuth(db, email);
      if (!userId) throw error ?? new Error(`widget buyer: cannot resolve user for ${email}`);
    }
  }

  if (!(await waitForUsersRow(db, userId))) {
    throw new Error(`widget buyer: users row missing for ${userId}`);
  }

  if (created) {
    const { error: upErr } = await db
      .from("users")
      .update({ trial_expires_at: null })
      .eq("id", userId);
    if (upErr) throw upErr;
  } else if (name) {
    const { data: row } = await db.from("users").select("display_name").eq("id", userId).maybeSingle();
    const current = ((row?.display_name as string | null) ?? "").trim();
    if (!current || current === email.split("@")[0]) {
      await db.from("users").update({ display_name: name }).eq("id", userId);
    }
  }

  await ensureWidgetContact(db, { email, userId, locale: params.locale });
  return { userId, created };
}

export type WebinarPassProduct = { credits: number; windowDays: number };

/** Pass window: webinars with starts_at in [paidAt, paidAt + windowDays). */
export function webinarPassWindow(paidAt: Date, windowDays: number): { from: Date; until: Date } {
  return { from: paidAt, until: new Date(paidAt.getTime() + windowDays * DAY_MS) };
}

export async function loadWebinarPassProduct(
  db: SupabaseClient,
  params: { catalogId: string | null; tier: string },
): Promise<WebinarPassProduct | null> {
  let query = db.from("payment_catalog").select("webinar_credits,webinar_window_days");
  query = params.catalogId
    ? query.eq("id", params.catalogId)
    : query.eq("provider", "yookassa").eq("tier", params.tier).eq("currency", "RUB");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  const credits = Number(data?.webinar_credits);
  const windowDays = Number(data?.webinar_window_days);
  if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(windowDays) || windowDays <= 0) {
    return null;
  }
  return { credits, windowDays };
}

/** Create the pass (idempotent per contract) and register for webinars already published. */
export async function grantWebinarPass(
  db: SupabaseClient,
  params: { userId: string; contractId: string; product: WebinarPassProduct; paidAt: Date },
): Promise<{ registered: number }> {
  const window = webinarPassWindow(params.paidAt, params.product.windowDays);
  const { error } = await db.from("webinar_passes").upsert(
    {
      user_id: params.userId,
      contract_id: params.contractId,
      credits: params.product.credits,
      valid_from: window.from.toISOString(),
      valid_until: window.until.toISOString(),
    },
    { onConflict: "contract_id", ignoreDuplicates: true },
  );
  if (error) throw error;
  const { data, error: rpcErr } = await db.rpc("apply_webinar_passes", { p_user_id: params.userId });
  if (rpcErr) throw rpcErr;
  return { registered: Number(data ?? 0) };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text letter → paragraphs; URLs become links. */
export function plainLetterToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const html = escapeHtml(para)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0f3d2e;">$1</a>')
        .replace(/\n/g, "<br />");
      return `<p>${html}</p>`;
    })
    .join("\n");
}

/**
 * Product letter in the buyer's language. Subject, body and footer are the
 * same language: a missing translation sends the whole letter in Russian.
 * Claims buyer_letter_sent_at first so webhook retries do not send twice.
 * Sent even when the contact is unsubscribed — this is about a purchase.
 */
export async function sendWidgetPurchaseLetter(
  db: SupabaseClient,
  contractId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const { data: contract, error } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,buyer_email,buyer_name,buyer_locale,catalog_id,tier,source,buyer_letter_sent_at,status")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  if (!contract || contract.source !== "widget") return { sent: false, reason: "not_widget" };
  if (contract.buyer_letter_sent_at) return { sent: false, reason: "already_sent" };
  if (contract.status !== "active") return { sent: false, reason: "not_active" };
  const to = normalizeBuyerEmail((contract.buyer_email as string | null) ?? "");
  if (!to) return { sent: false, reason: "no_email" };

  let catalogQuery = db.from("payment_catalog").select("letter_subject_i18n,letter_body_i18n");
  catalogQuery = contract.catalog_id
    ? catalogQuery.eq("id", contract.catalog_id)
    : catalogQuery.eq("provider", "yookassa").eq("tier", contract.tier).eq("currency", "RUB");
  const { data: catalog, error: catErr } = await catalogQuery.maybeSingle();
  if (catErr) throw catErr;

  let recipientLocale = (contract.buyer_locale as string | null) ?? null;
  if (contract.user_id) {
    const { data: user } = await db.from("users").select("locale").eq("id", contract.user_id).maybeSingle();
    if (asWidgetLocale(user?.locale)) recipientLocale = user?.locale as string;
  }
  const locale = purchaseLetterLocale(recipientLocale, catalog?.letter_subject_i18n, catalog?.letter_body_i18n);
  if (!locale) return { sent: false, reason: "no_letter" };
  const subjectRaw = ownI18nText(catalog?.letter_subject_i18n, locale);
  const bodyRaw = ownI18nText(catalog?.letter_body_i18n, locale);

  const { data: claimed, error: claimErr } = await db
    .from("payment_contracts")
    .update({ buyer_letter_sent_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .is("buyer_letter_sent_at", null)
    .select("contract_id");
  if (claimErr) throw claimErr;
  if (!claimed?.length) return { sent: false, reason: "already_sent" };

  const { data: contact } = await db
    .from("email_contacts")
    .select("unsubscribe_token")
    .eq("email_normalized", to)
    .maybeSingle();
  const token = (contact?.unsubscribe_token as string | null) ?? null;
  const unsubscribeUrl = token ? buildSignedUnsubscribeUrl(token) : "";

  const name = ((contract.buyer_name as string | null) ?? "").trim();
  const subject = applyEmailPlaceholders(subjectRaw, { name });
  const bodyHtml = applyEmailPlaceholders(plainLetterToHtml(bodyRaw), { name, unsubscribeUrl });
  const copy = getWidgetEmailCopy(locale);
  const html = wrapMarketingEmailHtml({
    bodyHtml,
    unsubscribeUrl,
    previewText: subject,
    lang: locale,
    footer: copy.footer,
  });

  const result = await sendMarketingEmail({
    to,
    subject,
    html,
    text: htmlToPlaintext(bodyHtml),
    unsubscribeUrl,
    locale,
    tags: [{ name: "kind", value: "widget_purchase" }],
  });
  if (!result.ok) {
    await db
      .from("payment_contracts")
      .update({ buyer_letter_sent_at: null })
      .eq("contract_id", contractId);
    throw new Error(`widget letter failed: ${result.detail}`);
  }
  return { sent: true };
}
