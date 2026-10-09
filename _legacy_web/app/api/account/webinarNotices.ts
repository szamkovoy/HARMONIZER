/**
 * Webinar letters, sent when something happens — not on a timer.
 *
 * Invite: the announcement is published with a description and a room link,
 * or the person pays while such a webinar already exists.
 * Recording: the admin sends the letter from the recording tab. The text is the whole letter.
 * No reminder letters.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { applyEmailPlaceholders, wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { buildSignedUnsubscribeUrl } from "../_utils/emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail } from "../_utils/marketingMail";
import { getWidgetEmailCopy } from "../_utils/widgetEmailCopy";
import {
  authoredRecordingLetter,
  buildNoticePlainText,
  fillLetterName,
  getWebinarNoticeCopy,
  letterLocale,
  type WebinarNoticeKind,
} from "../_utils/webinarNoticeCopy";
import { asWidgetLocale, type WidgetLocale } from "../../../lib/paymentWidget/copy";
import { plainLetterToHtml } from "./widgetFulfillment";

const JOIN_GRACE_MS = 60 * 60 * 1000;

export type NoticeResult = { sent: number; failed: number; already?: number };

type WebinarRow = {
  id: string;
  title: string;
  description: string | null;
  description_i18n: unknown;
  join_url: string | null;
  starts_at: string;
  is_published: boolean;
};

export function startsStillOpen(startsAt: string, now: Date): boolean {
  const t = new Date(startsAt).getTime();
  return !Number.isNaN(t) && t > now.getTime() - JOIN_GRACE_MS;
}

export function instantInHalfOpenWindow(startsAt: string, from: string, until: string): boolean {
  const t = new Date(startsAt).getTime();
  return t >= new Date(from).getTime() && t < new Date(until).getTime();
}

export function isActiveMaster(tier: string | null | undefined, expiresAt: string | null | undefined, now: Date): boolean {
  if (tier !== "master" || !expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}

/** Subscription covered the moment the webinar started. */
export function masterCoveredStart(row: {
  status: string;
  createdAt: string;
  periodEnd: string | null;
  startsAt: string;
}): boolean {
  if (row.status !== "active" && row.status !== "cancelled" && row.status !== "refunded") return false;
  if (!row.periodEnd) return false;
  const start = new Date(row.startsAt).getTime();
  return new Date(row.createdAt).getTime() <= start && new Date(row.periodEnd).getTime() >= start;
}

export function ticketCoveredStart(row: { status: string; createdAt: string; startsAt: string }): boolean {
  return row.status === "active" && new Date(row.createdAt).getTime() <= new Date(row.startsAt).getTime();
}

/**
 * A pass holder had this webinar paid for when it started: the window covers
 * the start, and either they were registered on it or a credit was still free
 * (earlier webinars in the window had not used them all up).
 */
export function passCoveredWebinar(row: {
  status: string;
  credits: number;
  validFrom: string;
  validUntil: string;
  startsAt: string;
  earlierRegistrations: number;
  registeredForThis: boolean;
}): boolean {
  if (!instantInHalfOpenWindow(row.startsAt, row.validFrom, row.validUntil)) return false;
  if (row.registeredForThis) return row.status === "active" || row.status === "revoked";
  if (row.status !== "active") return false;
  return row.earlierRegistrations < row.credits;
}

export function recordingRecipientIds(input: {
  startsAt: string;
  masters: { userId: string | null; status: string; createdAt: string; periodEnd: string | null }[];
  tickets: { userId: string | null; status: string; createdAt: string }[];
  passes: {
    id: string;
    userId: string;
    status: string;
    credits: number;
    validFrom: string;
    validUntil: string;
  }[];
  /** Registrations that belong to these passes (any webinar). */
  passRegistrations: { passId: string; webinarId: string; startsAt: string }[];
  webinarId: string;
}): string[] {
  const ids = new Set<string>();
  for (const row of input.masters) {
    if (!row.userId) continue;
    if (masterCoveredStart({ ...row, startsAt: input.startsAt })) ids.add(row.userId);
  }
  for (const row of input.tickets) {
    if (!row.userId) continue;
    if (ticketCoveredStart({ ...row, startsAt: input.startsAt })) ids.add(row.userId);
  }
  const startMs = new Date(input.startsAt).getTime();
  for (const pass of input.passes) {
    const regs = input.passRegistrations.filter((r) => r.passId === pass.id);
    const covered = passCoveredWebinar({
      status: pass.status,
      credits: pass.credits,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      startsAt: input.startsAt,
      earlierRegistrations: regs.filter(
        (r) => r.webinarId !== input.webinarId && new Date(r.startsAt).getTime() < startMs,
      ).length,
      registeredForThis: regs.some((r) => r.webinarId === input.webinarId),
    });
    if (covered) ids.add(pass.userId);
  }
  return [...ids];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function noticeHtml(params: {
  kind: WebinarNoticeKind;
  locale: WidgetLocale;
  name: string;
  body: string;
  joinUrl?: string | null;
}): string {
  const copy = getWebinarNoticeCopy(params.locale);
  const greeting = params.name.trim() ? copy.greeting(params.name.trim()) : copy.greetingNoName;
  const parts = [`<p>${escapeHtml(greeting)}</p>`, plainLetterToHtml(params.body)];
  const joinUrl = params.joinUrl?.trim();
  if (params.kind === "invite" && joinUrl) {
    const href = escapeHtml(joinUrl);
    parts.push(
      `<p><a href="${href}" style="display:inline-block;padding:12px 22px;background:#0f3d2e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">${escapeHtml(copy.joinButton)}</a></p>`,
      `<p>${escapeHtml(copy.accessCode)}</p>`,
    );
  }
  parts.push(`<p>${escapeHtml(copy.closing)}<br />${escapeHtml(copy.signature)}</p>`);
  return parts.join("\n");
}

async function loadWebinar(db: SupabaseClient, webinarId: string): Promise<WebinarRow | null> {
  const { data, error } = await db
    .from("webinars")
    .select("id,title,description,description_i18n,join_url,starts_at,is_published")
    .eq("id", webinarId)
    .maybeSingle();
  if (error) throw error;
  return (data as WebinarRow | null) ?? null;
}

function inviteReady(webinar: WebinarRow, now: Date): boolean {
  return Boolean(
    webinar.is_published &&
      webinar.join_url?.trim() &&
      (webinar.description ?? "").trim() &&
      startsStillOpen(webinar.starts_at, now),
  );
}

/** Published announcement still ahead, even if the room link is not filled in yet. */
export async function hasPublishedWebinarForPass(db: SupabaseClient, userId: string, now = new Date()): Promise<boolean> {
  const { data: passes, error } = await db
    .from("webinar_passes")
    .select("valid_from,valid_until")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  if (!passes?.length) return false;

  const { data: webinars, error: wErr } = await db
    .from("webinars")
    .select("starts_at")
    .eq("is_published", true)
    .gt("starts_at", new Date(now.getTime() - JOIN_GRACE_MS).toISOString());
  if (wErr) throw wErr;

  return (webinars ?? []).some((w) =>
    passes.some((p) => instantInHalfOpenWindow(w.starts_at as string, p.valid_from as string, p.valid_until as string)),
  );
}

export async function ticketWebinarIsPublished(db: SupabaseClient, webinarId: string): Promise<boolean> {
  const webinar = await loadWebinar(db, webinarId);
  return Boolean(webinar?.is_published);
}

async function registerActiveMasters(db: SupabaseClient, webinarId: string, onlyUserId?: string): Promise<void> {
  const nowIso = new Date().toISOString();
  let query = db.from("users").select("id").eq("membership_tier", "master").gt("membership_expires_at", nowIso);
  if (onlyUserId) query = query.eq("id", onlyUserId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map((u) => ({ webinar_id: webinarId, user_id: u.id as string }));
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200);
    const { error: upErr } = await db.from("webinar_registrations").upsert(slice, {
      onConflict: "webinar_id,user_id",
      ignoreDuplicates: true,
    });
    if (upErr) throw upErr;
  }
}

type Recipient = {
  userId: string;
  email: string;
  name: string;
  locale: string;
  unsubscribeUrl: string;
};

async function emailsByRpc(db: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const { data, error } = await db.rpc("emails_for_user_ids", { p_ids: userIds });
  if (error) {
    console.error("[webinar-notice] emails_for_user_ids failed", error.message);
    return out;
  }
  for (const row of (data ?? []) as { user_id?: string; email?: string }[]) {
    const email = (row.email ?? "").trim().toLowerCase();
    if (row.user_id && email) out.set(row.user_id, email);
  }
  return out;
}

async function loadRecipients(db: SupabaseClient, userIds: string[]): Promise<Recipient[]> {
  if (!userIds.length) return [];
  const users = new Map<string, { name: string; locale: string | null }>();
  const contacts = new Map<string, { email: string; locale: string | null; token: string | null }>();
  const buyers = new Map<string, { email: string; name: string; locale: string | null }>();

  for (let i = 0; i < userIds.length; i += 200) {
    const slice = userIds.slice(i, i + 200);
    const [userRes, contactRes, buyerRes] = await Promise.all([
      db.from("users").select("id,display_name,locale").in("id", slice),
      db.from("email_contacts").select("user_id,email,locale,unsubscribe_token").in("user_id", slice),
      db
        .from("payment_contracts")
        .select("user_id,buyer_email,buyer_name,buyer_locale,created_at")
        .in("user_id", slice)
        .not("buyer_email", "is", null)
        .order("created_at", { ascending: false }),
    ]);
    if (userRes.error) throw userRes.error;
    if (contactRes.error) throw contactRes.error;
    if (buyerRes.error) throw buyerRes.error;
    for (const row of userRes.data ?? []) {
      users.set(row.id as string, {
        name: ((row.display_name as string | null) ?? "").trim(),
        locale: (row.locale as string | null) ?? null,
      });
    }
    for (const row of contactRes.data ?? []) {
      const userId = row.user_id as string | null;
      if (!userId || contacts.has(userId)) continue;
      contacts.set(userId, {
        email: ((row.email as string | null) ?? "").trim().toLowerCase(),
        locale: (row.locale as string | null) ?? null,
        token: (row.unsubscribe_token as string | null) ?? null,
      });
    }
    for (const row of buyerRes.data ?? []) {
      const userId = row.user_id as string | null;
      if (!userId || buyers.has(userId)) continue;
      buyers.set(userId, {
        email: ((row.buyer_email as string | null) ?? "").trim().toLowerCase(),
        name: ((row.buyer_name as string | null) ?? "").trim(),
        locale: (row.buyer_locale as string | null) ?? null,
      });
    }
  }

  const missing = userIds.filter((id) => !contacts.get(id)?.email && !buyers.get(id)?.email);
  const fromAuth = await emailsByRpc(db, missing);

  const recipients: Recipient[] = [];
  for (const userId of userIds) {
    const contact = contacts.get(userId);
    const buyer = buyers.get(userId);
    const email = contact?.email || buyer?.email || fromAuth.get(userId) || "";
    if (!email) continue;
    const user = users.get(userId);
    const locale =
      asWidgetLocale(user?.locale) ?? asWidgetLocale(contact?.locale) ?? asWidgetLocale(buyer?.locale) ?? "ru";
    recipients.push({
      userId,
      email,
      name: user?.name || buyer?.name || "",
      locale,
      unsubscribeUrl: contact?.token ? buildSignedUnsubscribeUrl(contact.token) : "",
    });
  }
  return recipients;
}

async function alreadySent(db: SupabaseClient, webinarId: string, kind: WebinarNoticeKind): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data, error } = await db
    .from("webinar_notice_sends")
    .select("user_id")
    .eq("webinar_id", webinarId)
    .eq("kind", kind);
  if (error) throw error;
  for (const row of data ?? []) ids.add(row.user_id as string);
  return ids;
}

async function claimSend(
  db: SupabaseClient,
  webinarId: string,
  userId: string,
  kind: WebinarNoticeKind,
  locale: string,
): Promise<boolean> {
  const { error } = await db.from("webinar_notice_sends").insert({
    webinar_id: webinarId,
    user_id: userId,
    kind,
    locale,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw error;
}

async function releaseSend(
  db: SupabaseClient,
  webinarId: string,
  userId: string,
  kind: WebinarNoticeKind,
): Promise<void> {
  await db.from("webinar_notice_sends").delete().eq("webinar_id", webinarId).eq("user_id", userId).eq("kind", kind);
}

async function deliver(
  db: SupabaseClient,
  webinar: { id: string; description: string | null; description_i18n: unknown; join_url: string | null },
  kind: WebinarNoticeKind,
  bodyRu: string,
  bodyI18n: unknown,
  recipient: Recipient,
): Promise<"sent" | "failed" | "skipped"> {
  const letter = letterLocale(recipient.locale, bodyRu, bodyI18n);
  if (!letter) return "skipped";
  const claimed = await claimSend(db, webinar.id, recipient.userId, kind, letter.locale);
  if (!claimed) return "skipped";

  const name = recipient.name;
  const { subject, text } = buildNoticePlainText({
    kind,
    locale: letter.locale,
    name,
    body: letter.text,
    joinUrl: webinar.join_url,
  });
  const bodyHtml = noticeHtml({
    kind,
    locale: letter.locale,
    name,
    body: letter.text,
    joinUrl: webinar.join_url,
  });
  const copy = getWidgetEmailCopy(letter.locale);
  const html = wrapMarketingEmailHtml({
    bodyHtml: applyEmailPlaceholders(bodyHtml, { name, unsubscribeUrl: recipient.unsubscribeUrl }),
    unsubscribeUrl: recipient.unsubscribeUrl,
    previewText: subject,
    lang: letter.locale,
    footer: copy.footer,
  });
  const result = await sendMarketingEmail({
    to: recipient.email,
    subject: applyEmailPlaceholders(subject, { name }),
    html,
    text: htmlToPlaintext(applyEmailPlaceholders(text, { name, unsubscribeUrl: recipient.unsubscribeUrl })),
    unsubscribeUrl: recipient.unsubscribeUrl,
    locale: letter.locale,
    tags: [{ name: "kind", value: kind === "invite" ? "webinar_invite" : "webinar_recording" }],
  });
  if (!result.ok) {
    await releaseSend(db, webinar.id, recipient.userId, kind);
    console.error("[webinar-notice] send failed", kind, recipient.userId, result.detail);
    return "failed";
  }
  return "sent";
}

async function sendToUsers(
  db: SupabaseClient,
  webinar: WebinarRow,
  kind: WebinarNoticeKind,
  bodyRu: string,
  bodyI18n: unknown,
  userIds: string[],
): Promise<NoticeResult> {
  const sentAlready = await alreadySent(db, webinar.id, kind);
  const pending = userIds.filter((id) => !sentAlready.has(id));
  const recipients = await loadRecipients(db, pending);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += 5) {
    const slice = recipients.slice(i, i + 5);
    const results = await Promise.all(slice.map((r) => deliver(db, webinar, kind, bodyRu, bodyI18n, r)));
    for (const result of results) {
      if (result === "sent") sent += 1;
      else if (result === "failed") failed += 1;
    }
  }
  return { sent, failed };
}

/**
 * Invite everyone who should hear about this webinar: active Master, and
 * pass holders the registration function just placed on it. One letter each.
 */
export async function sendWebinarInvites(
  db: SupabaseClient,
  webinarId: string,
  opts?: { onlyUserId?: string },
): Promise<NoticeResult> {
  const webinar = await loadWebinar(db, webinarId);
  if (!webinar || !inviteReady(webinar, new Date())) return { sent: 0, failed: 0 };

  const { error: passErr } = await db.rpc("apply_webinar_passes", {
    p_user_id: opts?.onlyUserId ?? null,
  });
  if (passErr) throw passErr;
  await registerActiveMasters(db, webinarId, opts?.onlyUserId);

  let query = db.from("webinar_registrations").select("user_id").eq("webinar_id", webinarId);
  if (opts?.onlyUserId) query = query.eq("user_id", opts.onlyUserId);
  const { data, error } = await query;
  if (error) throw error;
  const userIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  return sendToUsers(db, webinar, "invite", webinar.description ?? "", webinar.description_i18n, userIds);
}

/** After a Master purchase: invite to every webinar that is already on the schedule. */
export async function sendMasterWebinarInvites(db: SupabaseClient, userId: string): Promise<NoticeResult> {
  const now = new Date();
  const { data, error } = await db
    .from("webinars")
    .select("id")
    .eq("is_published", true)
    .gt("starts_at", new Date(now.getTime() - JOIN_GRACE_MS).toISOString());
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const result = await sendWebinarInvites(db, row.id as string, { onlyUserId: userId });
    sent += result.sent;
    failed += result.failed;
  }
  return { sent, failed };
}

/** After a 1- or 4-webinar purchase: invite to the webinars already in the window. */
export async function sendPassWebinarInvites(db: SupabaseClient, userId: string): Promise<NoticeResult> {
  const { data: regs, error } = await db
    .from("webinar_registrations")
    .select("webinar_id")
    .eq("user_id", userId)
    .not("pass_id", "is", null);
  if (error) throw error;
  const ids = [...new Set((regs ?? []).map((r) => r.webinar_id as string))];
  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const result = await sendWebinarInvites(db, id, { onlyUserId: userId });
    sent += result.sent;
    failed += result.failed;
  }
  return { sent, failed };
}

async function deliverAuthored(
  db: SupabaseClient,
  webinarId: string,
  subjectRu: string,
  subjectI18n: unknown,
  bodyRu: string,
  bodyI18n: unknown,
  recipient: Recipient,
): Promise<"sent" | "failed" | "skipped"> {
  const letter = authoredRecordingLetter(recipient.locale, subjectRu, subjectI18n, bodyRu, bodyI18n);
  if (!letter) return "skipped";
  const claimed = await claimSend(db, webinarId, recipient.userId, "recording", letter.locale);
  if (!claimed) return "skipped";

  const name = recipient.name;
  const subject = fillLetterName(letter.subject, name);
  const text = fillLetterName(letter.body, name);
  const bodyHtml = fillLetterName(plainLetterToHtml(letter.body), escapeHtml(name));
  const copy = getWidgetEmailCopy(letter.locale);
  const html = wrapMarketingEmailHtml({
    bodyHtml,
    unsubscribeUrl: recipient.unsubscribeUrl,
    previewText: subject,
    lang: letter.locale,
    footer: copy.footer,
  });
  const result = await sendMarketingEmail({
    to: recipient.email,
    subject,
    html,
    text: htmlToPlaintext(text),
    unsubscribeUrl: recipient.unsubscribeUrl,
    locale: letter.locale,
    tags: [{ name: "kind", value: "webinar_recording" }],
  });
  if (!result.ok) {
    await releaseSend(db, webinarId, recipient.userId, "recording");
    console.error("[webinar-notice] recording letter failed", recipient.userId, result.detail);
    return "failed";
  }
  return "sent";
}

/** Recording letter: the authored subject and body, to everyone who had paid access at the start. */
export async function sendRecordingNotices(db: SupabaseClient, webinarId: string): Promise<NoticeResult> {
  const webinar = await loadWebinar(db, webinarId);
  if (!webinar) return { sent: 0, failed: 0 };

  const { data: post, error: postErr } = await db
    .from("posts")
    .select("title,title_i18n,body,body_i18n")
    .eq("webinar_id", webinarId)
    .eq("kind", "webinar_recording")
    .maybeSingle();
  if (postErr) throw postErr;
  const subjectRu = ((post?.title as string | null) ?? "").trim();
  const bodyRu = ((post?.body as string | null) ?? "").trim();
  if (!subjectRu || !bodyRu) return { sent: 0, failed: 0 };

  const startsAt = webinar.starts_at;
  const [mastersRes, ticketsRes, passesRes] = await Promise.all([
    db
      .from("payment_contracts")
      .select("user_id,status,created_at,current_period_end")
      .eq("tier", "master")
      .eq("product_kind", "subscription")
      .in("status", ["active", "cancelled", "refunded"])
      .lte("created_at", startsAt),
    db
      .from("payment_contracts")
      .select("user_id,status,created_at")
      .eq("tier", "webinar")
      .eq("product_ref", webinarId)
      .eq("product_kind", "one_time")
      .lte("created_at", startsAt),
    db
      .from("webinar_passes")
      .select("id,user_id,status,credits,valid_from,valid_until")
      .lte("valid_from", startsAt)
      .gt("valid_until", startsAt),
  ]);
  if (mastersRes.error) throw mastersRes.error;
  if (ticketsRes.error) throw ticketsRes.error;
  if (passesRes.error) throw passesRes.error;

  const passIds = (passesRes.data ?? []).map((p) => p.id as string);
  let passRegistrations: { passId: string; webinarId: string; startsAt: string }[] = [];
  if (passIds.length) {
    const { data: regs, error: regErr } = await db
      .from("webinar_registrations")
      .select("pass_id,webinar_id,webinars(starts_at)")
      .in("pass_id", passIds);
    if (regErr) throw regErr;
    passRegistrations = (regs ?? []).map((r) => {
      const linked = r.webinars as { starts_at?: string } | { starts_at?: string }[] | null;
      const starts = Array.isArray(linked) ? linked[0]?.starts_at : linked?.starts_at;
      return {
        passId: r.pass_id as string,
        webinarId: r.webinar_id as string,
        startsAt: starts ?? startsAt,
      };
    });
  }

  const userIds = recordingRecipientIds({
    startsAt,
    webinarId,
    masters: (mastersRes.data ?? []).map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      status: r.status as string,
      createdAt: r.created_at as string,
      periodEnd: (r.current_period_end as string | null) ?? null,
    })),
    tickets: (ticketsRes.data ?? []).map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      status: r.status as string,
      createdAt: r.created_at as string,
    })),
    passes: (passesRes.data ?? []).map((p) => ({
      id: p.id as string,
      userId: p.user_id as string,
      status: p.status as string,
      credits: Number(p.credits),
      validFrom: p.valid_from as string,
      validUntil: p.valid_until as string,
    })),
    passRegistrations,
  });

  const sentAlready = await alreadySent(db, webinarId, "recording");
  const pending = userIds.filter((id) => !sentAlready.has(id));
  const recipients = await loadRecipients(db, pending);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += 5) {
    const slice = recipients.slice(i, i + 5);
    const results = await Promise.all(
      slice.map((r) => deliverAuthored(db, webinarId, subjectRu, post?.title_i18n, bodyRu, post?.body_i18n, r)),
    );
    for (const result of results) {
      if (result === "sent") sent += 1;
      else if (result === "failed") failed += 1;
    }
  }
  return { sent, failed, already: userIds.length - pending.length };
}
