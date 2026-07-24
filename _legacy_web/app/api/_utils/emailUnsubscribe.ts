import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { getEmailPublicBaseUrl } from "./marketingMail";

/** Opaque token stored on contact; URL uses contact token directly (phase A). */
export function generateUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

export function buildUnsubscribeUrl(token: string): string {
  const base = getEmailPublicBaseUrl();
  return `${base}/unsubscribe/email?t=${encodeURIComponent(token)}`;
}

/**
 * Optional HMAC wrapper if EMAIL_UNSUBSCRIBE_SECRET is set —
 * format `token.sig` where sig = hex hmac of token.
 * Phase A also accepts bare contact.unsubscribe_token.
 */
export function signUnsubscribeToken(token: string): string {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
  if (!secret) return token;
  const sig = createHash("sha256").update(`${secret}:${token}`).digest("hex").slice(0, 32);
  return `${token}.${sig}`;
}

export function parseUnsubscribeParam(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim();
  if (!secret || !value.includes(".")) return value;
  const [token, sig] = value.split(".");
  if (!token || !sig) return null;
  const expected = createHash("sha256").update(`${secret}:${token}`).digest("hex").slice(0, 32);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return token;
}

export function buildSignedUnsubscribeUrl(token: string): string {
  const base = getEmailPublicBaseUrl();
  const signed = signUnsubscribeToken(token);
  return `${base}/unsubscribe/email?t=${encodeURIComponent(signed)}`;
}
