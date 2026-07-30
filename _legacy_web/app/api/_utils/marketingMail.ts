/**
 * Marketing channel transport — Resend or Amazon SES via EMAIL_MARKETING profile.
 * Never used by Auth OTP — OTP uses send-auth-email + EMAIL_OTP.
 *
 * `resendId` on send rows = provider message id (Resend id or SES MessageId).
 */

import { resolveMarketingTransportProfile } from "./emailTransportProfile";
import { sendMarketingEmailViaSes } from "./sesMarketingSend";

export type MarketingSendInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  /** Content locale for From display name (ru → Сергей Замковой, else Sergei Zamkovoi). */
  locale?: string | null;
  tags?: { name: string; value: string }[];
};

export type MarketingSendResult =
  | { ok: true; resendId: string }
  | { ok: false; detail: string };

/** Same rule as Auth OTP: RU Cyrillic name, otherwise Latin. */
export function marketingSenderName(locale?: string | null): string {
  const loc = (locale ?? "ru").trim().toLowerCase().slice(0, 2);
  if (loc === "ru") return "Сергей Замковой";
  return "Sergei Zamkovoi";
}

function formatFrom(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  if (/^[A-Za-z0-9 ._-]+$/.test(name)) return `${name} <${fromEmail}>`;
  const escaped = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}" <${fromEmail}>`;
}

export function getMarketingTransportProfile() {
  return resolveMarketingTransportProfile({
    EMAIL_MARKETING: process.env.EMAIL_MARKETING,
  });
}

export function getMarketingFrom(locale?: string | null): {
  fromEmail: string;
  fromName: string;
} {
  const profile = getMarketingTransportProfile();
  // Display name always follows locale (same as OTP). Do not override with a
  // static env string — that would force one name for all languages.
  return {
    fromEmail:
      process.env.MAIL_MARKETING_FROM_EMAIL?.trim() || profile.defaultFromEmail,
    fromName: marketingSenderName(locale),
  };
}

export function getMarketingApiKey(): string {
  const profile = getMarketingTransportProfile();
  if (profile.provider !== "resend" || !profile.resendApiKeyEnv) return "";
  return (process.env[profile.resendApiKeyEnv] ?? "").trim();
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

async function sendViaResend(
  input: MarketingSendInput,
  fromEmail: string,
  fromName: string,
): Promise<MarketingSendResult> {
  const profile = getMarketingTransportProfile();
  const apiKey = getMarketingApiKey();
  if (!apiKey) {
    return {
      ok: false,
      detail: `${profile.resendApiKeyEnv ?? "RESEND_*_API_KEY"} is not set for EMAIL_MARKETING=${profile.id}`,
    };
  }

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

export async function sendMarketingEmail(
  input: MarketingSendInput,
): Promise<MarketingSendResult> {
  const profile = getMarketingTransportProfile();
  const { fromEmail, fromName } = getMarketingFrom(input.locale);

  if (profile.provider === "amazon") {
    const result = await sendMarketingEmailViaSes({
      fromName,
      fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      unsubscribeUrl: input.unsubscribeUrl,
    });
    if (!result.ok) return result;
    return { ok: true, resendId: result.messageId };
  }

  return sendViaResend(input, fromEmail, fromName);
}

/** Soft rate limit between provider calls. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
