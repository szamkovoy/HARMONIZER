/**
 * Resend marketing API helpers (zamkovoi.ru key).
 * Suppressions + domains for deliverability dashboard / auto-suppress.
 */

import { getMarketingApiKey } from "./marketingMail";

const RESEND_BASE = "https://api.resend.com";

export type ResendSuppression = {
  id: string;
  email: string;
  origin: "bounce" | "complaint" | "manual" | string;
  source_id: string | null;
  created_at: string;
};

export type ResendDomain = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  region?: string;
};

async function resendFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const apiKey = getMarketingApiKey();
  if (!apiKey) {
    return { ok: false, status: 0, json: null, text: "RESEND_ZAMKOVOI_RU_API_KEY is not set" };
  }
  const res = await fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** List account suppressions (paginated; fetches up to maxPages * limit). */
export async function listResendSuppressions(opts?: {
  origin?: "bounce" | "complaint" | "manual";
  limit?: number;
  maxPages?: number;
}): Promise<{ suppressions: ResendSuppression[]; error?: string }> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 100));
  const maxPages = Math.min(10, Math.max(1, opts?.maxPages ?? 5));
  const out: ResendSuppression[] = [];
  let after: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts?.origin) params.set("origin", opts.origin);
    if (after) params.set("after", after);
    const { ok, status, json, text } = await resendFetch(`/suppressions?${params}`);
    if (!ok) {
      return {
        suppressions: out,
        error: `Resend suppressions HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    const body = json as {
      data?: ResendSuppression[];
      has_more?: boolean;
    } | null;
    const batch = body?.data ?? [];
    out.push(...batch);
    if (!body?.has_more || batch.length === 0) break;
    after = batch[batch.length - 1]?.id;
    if (!after) break;
  }
  return { suppressions: out };
}

/** Add email to Resend account suppression list (idempotent best-effort). */
export async function addResendSuppression(
  email: string,
): Promise<{ ok: boolean; id?: string; detail?: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { ok: false, detail: "empty email" };
  const { ok, status, json, text } = await resendFetch("/suppressions", {
    method: "POST",
    body: JSON.stringify({ email: normalized }),
  });
  if (ok) {
    const id = (json as { id?: string } | null)?.id;
    return { ok: true, id };
  }
  // Already suppressed → treat as success
  if (status === 409 || /already|exists/i.test(text)) {
    return { ok: true, detail: "already_suppressed" };
  }
  return {
    ok: false,
    detail: `Resend HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`,
  };
}

/** Remove suppression by email or id. */
export async function removeResendSuppression(
  emailOrId: string,
): Promise<{ ok: boolean; detail?: string }> {
  const key = encodeURIComponent(emailOrId.trim());
  if (!key) return { ok: false, detail: "empty" };
  const { ok, status, text } = await resendFetch(`/suppressions/${key}`, {
    method: "DELETE",
  });
  if (ok || status === 404) return { ok: true };
  return {
    ok: false,
    detail: `Resend HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`,
  };
}

export async function listResendDomains(): Promise<{
  domains: ResendDomain[];
  error?: string;
}> {
  const { ok, status, json, text } = await resendFetch("/domains?limit=100");
  if (!ok) {
    return {
      domains: [],
      error: `Resend domains HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  }
  const body = json as { data?: ResendDomain[] } | null;
  return { domains: body?.data ?? [] };
}

export type ResendDomainDetail = ResendDomain & {
  records?: {
    record: string;
    name: string;
    type: string;
    ttl: string;
    status: string;
    value: string;
    priority?: number;
  }[];
  open_tracking?: boolean;
  click_tracking?: boolean;
  tls?: string;
};

/** Retrieve one domain (DNS records + tracking flags). */
export async function getResendDomain(
  domainId: string,
): Promise<{ domain: ResendDomainDetail | null; error?: string }> {
  const id = domainId.trim();
  if (!id) return { domain: null, error: "empty domain id" };
  const { ok, status, json, text } = await resendFetch(`/domains/${encodeURIComponent(id)}`);
  if (!ok) {
    return {
      domain: null,
      error: `Resend domain HTTP ${status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    };
  }
  return { domain: json as ResendDomainDetail };
}

/** Marketing domain tracking status (opens/clicks via Resend require custom subdomain). */
export async function getMarketingDomainTrackingStatus(): Promise<{
  domain: string | null;
  open_tracking: boolean;
  click_tracking: boolean;
  tracking_subdomain: string | null;
  resend_open_click_available: boolean;
  note: string | null;
  error?: string;
}> {
  const listed = await listResendDomains();
  if (listed.error) {
    return {
      domain: null,
      open_tracking: false,
      click_tracking: false,
      tracking_subdomain: null,
      resend_open_click_available: false,
      note: null,
      error: listed.error,
    };
  }
  const fromEmail =
    process.env.MAIL_MARKETING_FROM_EMAIL?.trim() || "sergei@zamkovoi.ru";
  const host = fromEmail.includes("@") ? fromEmail.split("@")[1]!.toLowerCase() : "";
  const match =
    listed.domains.find((d) => d.name.toLowerCase() === host) ??
    listed.domains.find((d) => d.name.toLowerCase().endsWith(".ru")) ??
    listed.domains[0] ??
    null;
  if (!match) {
    return {
      domain: host || null,
      open_tracking: false,
      click_tracking: false,
      tracking_subdomain: null,
      resend_open_click_available: false,
      note: "Домен отправки не найден в Resend.",
    };
  }
  const detail = await getResendDomain(match.id);
  if (detail.error || !detail.domain) {
    return {
      domain: match.name,
      open_tracking: false,
      click_tracking: false,
      tracking_subdomain: null,
      resend_open_click_available: false,
      note: null,
      error: detail.error,
    };
  }
  const d = detail.domain as ResendDomainDetail & {
    tracking_subdomain?: string;
  };
  const open = Boolean(d.open_tracking);
  const click = Boolean(d.click_tracking);
  const sub = d.tracking_subdomain ?? null;
  const available = open && click && Boolean(sub);
  let note: string | null = null;
  if (!available && /\.ru$/i.test(match.name)) {
    note =
      "Resend не может выдать TLS для tracking-поддомена на .ru — открытия/клики считает наш пиксель и редирект (не Resend).";
  } else if (!available) {
    note =
      "В Resend выключен open/click tracking. Для zamkovoi.ru используется наш собственный учёт.";
  }
  return {
    domain: match.name,
    open_tracking: open,
    click_tracking: click,
    tracking_subdomain: sub,
    resend_open_click_available: available,
    note,
  };
}
