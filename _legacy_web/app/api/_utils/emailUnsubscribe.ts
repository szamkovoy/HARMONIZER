import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getUnsubscribePageCopy,
  localeFromAcceptLanguage,
} from "./emailUnsubscribeCopy";
import { getEmailPublicBaseUrl } from "./marketingMail";
import { createServiceSupabase } from "./supabase";

/** Opaque token stored on contact; URL HMAC-wraps it when EMAIL_UNSUBSCRIBE_SECRET is set. */
export function generateUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

function unsubscribeSecret(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ?? "";
}

function hmacSig(secret: string, token: string): string {
  return createHmac("sha256", secret).update(token).digest("hex").slice(0, 32);
}

/** Pre-HMAC hash (sha256 of `secret:token`) — still accepted on verify. */
function legacyHashSig(secret: string, token: string): string {
  return createHash("sha256").update(`${secret}:${token}`).digest("hex").slice(0, 32);
}

function timingSafeHexEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function signUnsubscribeToken(token: string): string {
  const secret = unsubscribeSecret();
  if (!secret) return token;
  return `${token}.${hmacSig(secret, token)}`;
}

/**
 * Accepts `token`, `token.hmac`, or legacy `token.sha256`.
 * Bare contact tokens stay valid: DB lookup is the capability check.
 */
export function parseUnsubscribeParam(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const secret = unsubscribeSecret();
  if (!value.includes(".")) {
    return /^[a-f0-9]{32,64}$/i.test(value) ? value : null;
  }
  const lastDot = value.lastIndexOf(".");
  const token = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!token || !sig || !/^[a-f0-9]{32,64}$/i.test(token)) return null;
  if (!secret) return token;
  if (timingSafeHexEqual(sig, hmacSig(secret, token))) return token;
  if (timingSafeHexEqual(sig, legacyHashSig(secret, token))) return token;
  return null;
}

export function unsubscribeTokenFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  return parseUnsubscribeParam(
    url.searchParams.get("t") ?? url.searchParams.get("token"),
  );
}

/** Canonical public URL used in the footer, body buttons, and List-Unsubscribe. */
export function buildSignedUnsubscribeUrl(token: string): string {
  const base = getEmailPublicBaseUrl();
  const signed = signUnsubscribeToken(token);
  return `${base}/unsubscribe?t=${encodeURIComponent(signed)}`;
}

/** @deprecated Prefer buildSignedUnsubscribeUrl — kept for callers that pass a raw token. */
export function buildUnsubscribeUrl(token: string): string {
  return buildSignedUnsubscribeUrl(token);
}

export type UnsubscribeApplyResult =
  | { ok: true; already: boolean; locale: string }
  | { ok: false; locale: string };

export async function applyMarketingUnsubscribe(
  db: SupabaseClient,
  rawParam: string | null,
): Promise<UnsubscribeApplyResult> {
  const token = parseUnsubscribeParam(rawParam);
  if (!token) return { ok: false, locale: "ru" };

  const { data: contact } = await db
    .from("email_contacts")
    .select("id, locale, marketing_status")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!contact) return { ok: false, locale: "ru" };

  const locale = (contact.locale as string) || "ru";
  if (contact.marketing_status === "unsubscribed") {
    return { ok: true, already: true, locale };
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await db
    .from("email_contacts")
    .update({
      marketing_status: "unsubscribed",
      updated_at: nowIso,
    })
    .eq("id", contact.id)
    .neq("marketing_status", "unsubscribed");
  if (updateError) throw updateError;

  try {
    await db
      .from("email_automation_enrollments")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("contact_id", contact.id)
      .eq("status", "active");
  } catch {
    /* contact is already opted out; drip cancel is best-effort */
  }

  try {
    const { data: lastSend } = await db
      .from("email_campaign_sends")
      .select("id, campaign_id")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await db.from("email_events").insert({
      send_id: lastSend?.id ?? null,
      contact_id: contact.id,
      campaign_id: lastSend?.campaign_id ?? null,
      event_type: "email.unsubscribed",
      payload: { source: "one_click" },
    });

    if (lastSend?.campaign_id) {
      const { data: campaign } = await db
        .from("email_campaigns")
        .select("unsubscribed_count")
        .eq("id", lastSend.campaign_id)
        .maybeSingle();
      const prev = Number(campaign?.unsubscribed_count ?? 0);
      await db
        .from("email_campaigns")
        .update({
          unsubscribed_count: prev + 1,
          updated_at: nowIso,
        })
        .eq("id", lastSend.campaign_id);
    }
  } catch {
    /* audit counters must not undo a successful opt-out */
  }

  return { ok: true, already: false, locale };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(locale: string, title: string, body: string): Response {
  const copy = getUnsubscribePageCopy(locale);
  const doc = `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f6f5; color: #1a1a1a;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; max-width: 420px;
      box-shadow: 0 8px 30px rgba(0,0,0,.06); text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
    p { margin: 0; color: #4b5563; line-height: 1.5; font-size: .95rem; }
  </style>
</head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></body>
</html>`;
  return new Response(doc, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function pageForResult(
  req: Request,
  result: UnsubscribeApplyResult,
): Response {
  const fallback = localeFromAcceptLanguage(req.headers.get("accept-language"));
  if (!result.ok) {
    const copy = getUnsubscribePageCopy(fallback);
    return htmlPage(copy.lang, copy.invalidTitle, copy.invalidBody);
  }
  const copy = getUnsubscribePageCopy(result.locale || fallback);
  return htmlPage(copy.lang, copy.successTitle, copy.successBody);
}

/** Human click: opt out immediately and show a confirmation page. */
export async function handleMarketingUnsubscribeGet(req: Request): Promise<Response> {
  const db = createServiceSupabase();
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? url.searchParams.get("token");
  const result = await applyMarketingUnsubscribe(db, raw);
  return pageForResult(req, result);
}

/**
 * RFC 8058 one-click: mail providers POST `List-Unsubscribe=One-Click`
 * to the same URL (token stays in the query). No browser confirm.
 */
export async function handleMarketingUnsubscribePost(req: Request): Promise<Response> {
  const db = createServiceSupabase();
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? url.searchParams.get("token");
  const result = await applyMarketingUnsubscribe(db, raw);
  return new Response(result.ok ? "OK" : "invalid", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
