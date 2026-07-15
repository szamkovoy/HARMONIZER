/**
 * Общие утилиты группы /api/account/* — OTT-переход из приложения
 * в Личный кабинет на zamkovoi.yoga и кабинетные сессии.
 *
 * Безопасность:
 *   - OTT: 32 случайных байта, в БД хранится только sha256-хэш, TTL 5 минут,
 *     строго одноразовый (гашение атомарным UPDATE ... WHERE used_at IS NULL).
 *   - Кабинетная сессия: компактный HMAC-SHA256 токен (payload.sig, base64url),
 *     TTL 60 минут, секрет ACCOUNT_CABINET_SECRET. Прав хватает только на
 *     чтение overview — токен не даёт доступа к Supabase.
 *   - CORS: только домен сайта (ACCOUNT_CABINET_ALLOWED_ORIGIN).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OTT_TTL_MS = 5 * 60 * 1000;
export const CABINET_SESSION_TTL_MS = 60 * 60 * 1000;

function allowedOrigin(): string {
  return process.env.ACCOUNT_CABINET_ALLOWED_ORIGIN?.trim() || "https://zamkovoi.yoga";
}

function cabinetSecret(): string {
  const secret = process.env.ACCOUNT_CABINET_SECRET?.trim();
  if (!secret) throw new Error("Missing required env: ACCOUNT_CABINET_SECRET");
  return secret;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** Доклеить CORS-заголовки к готовому Response (например, из errorResponse). */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(res.body, { status: res.status, headers });
}

export function corsJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...(init?.headers ?? {}),
    },
  });
}

export function generateOtt(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashOtt(token) };
}

export function hashOtt(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type CabinetSessionPayload = {
  sub: string;
  exp: number; // unix ms
};

export function signCabinetToken(userId: string, now = Date.now()): string {
  const payload: CabinetSessionPayload = { sub: userId, exp: now + CABINET_SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", cabinetSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** userId из валидного кабинетного токена; null при любой ошибке. */
export function verifyCabinetToken(token: string, now = Date.now()): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", cabinetSecret()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as CabinetSessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= now) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export function cabinetBearerUserId(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? verifyCabinetToken(match[1]) : null;
}
