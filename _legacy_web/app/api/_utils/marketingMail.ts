/**
 * Marketing channel transport (Resend zamkovoi.ru).
 * Never used by Auth OTP — OTP stays on send-auth-email + yoga key.
 */

export type MarketingSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  tags?: { name: string; value: string }[];
};

export type MarketingSendResult =
  | { ok: true; resendId: string }
  | { ok: false; detail: string };

const DEFAULT_FROM = "sergei@zamkovoi.ru";
const DEFAULT_FROM_NAME = "Гармонизатор";

function formatFrom(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  if (/^[A-Za-z0-9 ._-]+$/.test(name)) return `${name} <${fromEmail}>`;
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}" <${fromEmail}>`;
}

export function getMarketingFrom(): { fromEmail: string; fromName: string } {
  return {
    fromEmail:
      process.env.MAIL_MARKETING_FROM_EMAIL?.trim() || DEFAULT_FROM,
    fromName: process.env.MAIL_MARKETING_FROM_NAME?.trim() || DEFAULT_FROM_NAME,
  };
}

export function getMarketingApiKey(): string {
  return (process.env.RESEND_ZAMKOVOI_RU_API_KEY ?? "").trim();
}

export function getEmailPublicBaseUrl(): string {
  const explicit = process.env.EMAIL_PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    || process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  return "https://zamkovoi.yoga";
}

/** Plaintext fallback from HTML (very light). */
export function htmlToPlaintext(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendMarketingEmail(
  input: MarketingSendInput,
): Promise<MarketingSendResult> {
  const apiKey = getMarketingApiKey();
  if (!apiKey) {
    return { ok: false, detail: "RESEND_ZAMKOVOI_RU_API_KEY is not set" };
  }
  const { fromEmail, fromName } = getMarketingFrom();

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatFrom(fromName, fromEmail),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      headers: {
        "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: input.tags,
    }),
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    return {
      ok: false,
      detail: `Resend HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 400)}` : ""}`,
    };
  }
  let resendId = "";
  try {
    const parsed = JSON.parse(bodyText) as { id?: string };
    resendId = parsed.id?.trim() ?? "";
  } catch {
    /* ignore */
  }
  if (!resendId) {
    return { ok: false, detail: "Resend response missing id" };
  }
  return { ok: true, resendId };
}

/** Soft rate limit between Resend calls. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
