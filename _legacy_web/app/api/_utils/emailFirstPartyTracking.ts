/**
 * First-party open/click tracking for marketing mail on zamkovoi.ru.
 * Resend custom tracking subdomains are unavailable for .ru (TLS/cert restrictions),
 * so we embed our own pixel + click redirects on EMAIL_PUBLIC_BASE_URL.
 */
import { createHash, randomUUID, timingSafeEqual } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEmailPublicBaseUrl } from "./marketingMail";

const PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function trackingSecret(): string {
  return (
    process.env.EMAIL_TRACKING_SECRET?.trim() ||
    process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() ||
    ""
  );
}

export function newEmailTrackId(): string {
  return randomUUID();
}

export function signEmailTrackToken(trackId: string): string {
  const secret = trackingSecret();
  if (!secret) return trackId;
  const sig = createHash("sha256")
    .update(`${secret}:track:${trackId}`)
    .digest("hex")
    .slice(0, 32);
  return `${trackId}.${sig}`;
}

export function parseEmailTrackToken(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const secret = trackingSecret();
  if (!secret || !value.includes(".")) {
    // UUID only — accept when secret unset (dev) or legacy.
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  }
  const [id, sig] = value.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const expected = createHash("sha256")
    .update(`${secret}:track:${id}`)
    .digest("hex")
    .slice(0, 32);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return id;
}

function isSkippableHref(url: string): boolean {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return true;
  if (/\/unsubscribe\/email/i.test(u)) return true;
  if (/\/api\/email\/track\//i.test(u)) return true;
  if (u.startsWith("mailto:") || u.startsWith("#")) return true;
  return false;
}

/** Full document HTML ready to send: wrap chrome + first-party track. */
export async function prepareTrackedMarketingEmailHtml(
  opts: {
    bodyHtml: string;
    unsubscribeUrl: string;
    previewText?: string;
    trackId: string;
  },
): Promise<string> {
  const { prepareMarketingEmailHtml } = await import("./emailImgDimensions");
  const wrapped = await prepareMarketingEmailHtml({
    bodyHtml: opts.bodyHtml,
    unsubscribeUrl: opts.unsubscribeUrl,
    previewText: opts.previewText,
  });
  return injectFirstPartyEmailTracking(wrapped, opts.trackId);
}

/** Inject open pixel + wrap http(s) links. Call before Resend send. */
export function injectFirstPartyEmailTracking(
  html: string,
  trackId: string,
): string {
  const base = getEmailPublicBaseUrl();
  const t = encodeURIComponent(signEmailTrackToken(trackId));
  const pixelUrl = `${base}/api/email/track/open?t=${t}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;max-height:1px;overflow:hidden;" />`;

  let out = html.replace(
    /href=("|')(https?:\/\/[^"']+)\1/gi,
    (full, quote: string, url: string) => {
      if (isSkippableHref(url)) return full;
      const tracked = `${base}/api/email/track/click?t=${t}&u=${encodeURIComponent(url)}`;
      return `href=${quote}${tracked}${quote}`;
    },
  );

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${pixel}</body>`);
  } else {
    out = `${out}${pixel}`;
  }
  return out;
}

export type RegisterTrackKeyInput = {
  trackId: string;
  resendId: string;
  contactId?: string | null;
  campaignId?: string | null;
  stepId?: string | null;
  sendId?: string | null;
};

export async function registerEmailTrackKey(
  db: SupabaseClient,
  input: RegisterTrackKeyInput,
): Promise<void> {
  const { error } = await db.from("email_tracking_keys").insert({
    id: input.trackId,
    resend_id: input.resendId,
    contact_id: input.contactId ?? null,
    campaign_id: input.campaignId ?? null,
    step_id: input.stepId ?? null,
    send_id: input.sendId ?? null,
  });
  if (error) throw error;
}

type TrackRow = {
  id: string;
  resend_id: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  step_id: string | null;
  send_id: string | null;
};

async function loadTrackKey(
  db: SupabaseClient,
  trackId: string,
): Promise<TrackRow | null> {
  const { data, error } = await db
    .from("email_tracking_keys")
    .select("id, resend_id, contact_id, campaign_id, step_id, send_id")
    .eq("id", trackId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function bumpCounter(
  db: SupabaseClient,
  table: "email_campaigns" | "email_automation_steps",
  id: string,
  counter: "opened_count" | "clicked_count",
): Promise<void> {
  const { data } = await db
    .from(table)
    .select(counter)
    .eq("id", id)
    .maybeSingle();
  if (!data) return;
  const prev = Number((data as Record<string, number>)[counter] ?? 0);
  await db
    .from(table)
    .update({ [counter]: prev + 1, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Record open/click from first-party pixel/redirect.
 * Uses same event_type names as Resend webhooks for deliverability totals.
 */
export async function recordFirstPartyTrackEvent(
  db: SupabaseClient,
  opts: { trackId: string; kind: "opened" | "clicked"; clickUrl?: string | null },
): Promise<{ ok: boolean; duplicate?: boolean }> {
  const row = await loadTrackKey(db, opts.trackId);
  if (!row) return { ok: false };

  const eventType = opts.kind === "opened" ? "email.opened" : "email.clicked";
  const { error: insertError } = await db.from("email_events").insert({
    send_id: row.send_id,
    contact_id: row.contact_id,
    campaign_id: row.campaign_id,
    resend_id: row.resend_id,
    event_type: eventType,
    payload: {
      source: "first_party",
      track_id: row.id,
      ...(opts.kind === "clicked" && opts.clickUrl
        ? { click: { link: opts.clickUrl } }
        : {}),
    },
  });

  if (insertError) {
    if (insertError.code === "23505") return { ok: true, duplicate: true };
    throw insertError;
  }

  if (row.contact_id) {
    const stamp =
      opts.kind === "opened"
        ? { last_open_at: new Date().toISOString() }
        : { last_click_at: new Date().toISOString() };
    await db
      .from("email_contacts")
      .update({ ...stamp, updated_at: new Date().toISOString() })
      .eq("id", row.contact_id);
  }

  if (row.campaign_id) {
    await bumpCounter(
      db,
      "email_campaigns",
      row.campaign_id,
      opts.kind === "opened" ? "opened_count" : "clicked_count",
    );
  }
  if (row.step_id) {
    await bumpCounter(
      db,
      "email_automation_steps",
      row.step_id,
      opts.kind === "opened" ? "opened_count" : "clicked_count",
    );
  }

  return { ok: true };
}

export function trackingPixelResponse(): Response {
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Length": String(PIXEL_GIF.length),
    },
  });
}

/** Safe redirect target — only http(s). */
export function safeClickRedirectUrl(raw: string | null): string | null {
  const u = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
