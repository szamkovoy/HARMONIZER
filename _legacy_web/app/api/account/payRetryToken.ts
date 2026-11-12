/**
 * Подписанная ссылка на страницу «Оплата не удалась» / «Продлить доступ».
 * Lava и ЮKassa возвращают покупателя без кабинетной сессии, поэтому всё нужное
 * для нового счёта (кто, какой тариф, валюта, страна, язык) лежит в токене.
 * Токен позволяет только создать новый счёт на email владельца аккаунта.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { isPassTier, type PassTier } from "./tierPass";

export type PayRetryKind = "subscription" | "pass";

export type PayRetryPayload = {
  userId: string;
  tier: PassTier;
  kind: PayRetryKind;
  currency: "RUB" | "USD" | "EUR";
  country: string | null;
  locale: string;
  exp: number;
};

/** Страница отказа открывается сразу; сутки — с запасом на «попробую вечером». */
export const PAY_FAILED_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Ссылка из письма о конце 30 дней живёт до окончания доступа и чуть после. */
export const PAY_RENEW_TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;

type Wire = { s: string; t: string; k: "s" | "p"; c: string; y?: string; l: string; e: number };

function secret(): string {
  const value = process.env.ACCOUNT_CABINET_SECRET?.trim();
  if (!value) throw new Error("Missing required env: ACCOUNT_CABINET_SECRET");
  return value;
}

function sign(body: string): Buffer {
  return createHmac("sha256", secret()).update(`pay-retry.${body}`).digest();
}

export function signPayRetryToken(payload: Omit<PayRetryPayload, "exp">, ttlMs: number, now = Date.now()): string {
  const wire: Wire = {
    s: payload.userId,
    t: payload.tier,
    k: payload.kind === "pass" ? "p" : "s",
    c: payload.currency,
    ...(payload.country ? { y: payload.country } : {}),
    l: payload.locale,
    e: now + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(wire)).toString("base64url");
  return `${body}.${sign(body).toString("base64url")}`;
}

export function verifyPayRetryToken(token: string | null | undefined, now = Date.now()): PayRetryPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const wire = JSON.parse(Buffer.from(body, "base64url").toString()) as Wire;
    if (typeof wire.s !== "string" || typeof wire.e !== "number" || wire.e <= now) return null;
    if (!isPassTier(wire.t)) return null;
    if (wire.c !== "RUB" && wire.c !== "USD" && wire.c !== "EUR") return null;
    return {
      userId: wire.s,
      tier: wire.t,
      kind: wire.k === "p" ? "pass" : "subscription",
      currency: wire.c,
      country: typeof wire.y === "string" && wire.y ? wire.y : null,
      locale: typeof wire.l === "string" && wire.l ? wire.l : "ru",
      exp: wire.e,
    };
  } catch {
    return null;
  }
}
