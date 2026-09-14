import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isTimeoutError } from "./monitoring";

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

function isModernSupabaseApiKey(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

/** Per PostgREST call. Hangs without this become Vercel `Gateway Timeout` (Sentry). */
export const SUPABASE_FETCH_TIMEOUT_MS = 20_000;

export function mergeAbortSignals(signals: AbortSignal[]): AbortSignal {
  const viable = signals.filter((signal) => signal != null);
  if (viable.length === 0) return AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
  if (viable.length === 1) return viable[0]!;
  if (typeof AbortSignal.any === "function") return AbortSignal.any(viable);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const signal of viable) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

/**
 * Supabase API gateway answers `502/503/504 {"message":"Gateway Timeout"}` after exactly ~5s
 * on the first PostgREST request after an idle gap (keep-alive race gateway↔PostgREST,
 * "Warp server error: Thread killed by timeout manager"; observed 2026-09-14: 25 of 205
 * requests/h at night). The request never reaches Postgres, so an immediate retry succeeds.
 * Idempotent reads (GET/HEAD, incl. `rpc(..., { get: true })`) are retried up to
 * `SUPABASE_GATEWAY_RETRY_DELAYS_MS.length` times; writes and POST RPC are never retried.
 */
export const SUPABASE_GATEWAY_RETRY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
export const SUPABASE_GATEWAY_RETRY_DELAYS_MS: readonly number[] = [300, 800];

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

/** `attempt` = number of attempts already made (0 after the first response). */
export function shouldRetrySupabaseGatewayResponse(
  status: number,
  method: string,
  attempt: number,
): boolean {
  if (attempt >= SUPABASE_GATEWAY_RETRY_DELAYS_MS.length) return false;
  const normalized = method.toUpperCase();
  if (normalized !== "GET" && normalized !== "HEAD") return false;
  return SUPABASE_GATEWAY_RETRY_STATUSES.has(status);
}

/** sb_* keys are not JWTs — never send them as Authorization: Bearer. */
function fetchWithoutSbBearer(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (isModernSupabaseApiKey(apiKey)) {
      const auth = headers.get("Authorization");
      if (auth && /^Bearer\s+sb_/i.test(auth)) {
        headers.delete("Authorization");
      }
      if (!headers.has("apikey")) headers.set("apikey", apiKey);
    }
    const method = requestMethod(input, init);
    const attemptFetch = () => {
      const timeout = AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS);
      const signal = init?.signal ? mergeAbortSignals([init.signal, timeout]) : timeout;
      return fetch(input, { ...init, headers, signal });
    };
    let response = await attemptFetch();
    for (let attempt = 0; ; attempt += 1) {
      if (!shouldRetrySupabaseGatewayResponse(response.status, method, attempt)) return response;
      if (init?.signal?.aborted) return response;
      await new Promise((resolve) => setTimeout(resolve, SUPABASE_GATEWAY_RETRY_DELAYS_MS[attempt]));
      if (init?.signal?.aborted) return response;
      response = await attemptFetch();
    }
  };
}

function clientOptions(apiKey: string) {
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: fetchWithoutSbBearer(apiKey),
    },
  } as const;
}

export function createAnonSupabase(): SupabaseClient {
  const key = requiredEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
  );
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    key,
    clientOptions(key),
  );
}

export function createServiceSupabase(): SupabaseClient {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    key,
    clientOptions(key),
  );
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

const AUTH_PROBE_TIMEOUT_MS = 8_000;

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
}

function authUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: "Сервис авторизации временно недоступен — подождите минуту и обновите страницу",
    }),
    { status: 503 },
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("AUTH_PROBE_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type AccessTokenClaims = {
  sub: string;
  email: string | null;
  exp: number | null;
};

/** Decode JWT payload without trusting it until PostgREST/Auth accepts the token. */
function decodeAccessTokenClaims(token: string): AccessTokenClaims | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      sub?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
    return {
      sub: payload.sub.trim(),
      email: typeof payload.email === "string" ? payload.email.trim() || null : null,
      exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local JWT signature verification (Supabase asymmetric signing keys, ES256).
// Removes one PostgREST round trip (`user_roles` probe) per authenticated route —
// three of them at app launch alone. JWKS is public and served with max-age=600.
// Any doubt (HS256 legacy token, unknown kid, JWKS unreachable) → fall back to the
// proven probe path below, so behaviour never gets stricter than before.
// ---------------------------------------------------------------------------
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_FETCH_TIMEOUT_MS = 3_000;
type JsonWebKey256 = { kid?: string; kty: string; crv?: string; x?: string; y?: string; alg?: string };
let jwksCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null;
let jwksInFlight: Promise<Map<string, CryptoKey>> | null = null;

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const buf = Buffer.from(padded, "base64");
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

function decodeTokenHeader(token: string): { alg?: string; kid?: string } | null {
  try {
    const headerPart = token.split(".")[0];
    if (!headerPart) return null;
    return JSON.parse(Buffer.from(base64UrlToBytes(headerPart)).toString("utf8")) as { alg?: string; kid?: string };
  } catch {
    return null;
  }
}

async function loadJwks(): Promise<Map<string, CryptoKey>> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  if (jwksInFlight) return jwksInFlight;
  jwksInFlight = (async () => {
    const base = requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL").replace(/\/+$/, "");
    const res = await fetch(`${base}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body = (await res.json()) as { keys?: JsonWebKey256[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.kid) continue;
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      keys.set(jwk.kid, key);
    }
    jwksCache = { keys, expiresAt: Date.now() + JWKS_TTL_MS };
    return keys;
  })().finally(() => {
    jwksInFlight = null;
  });
  return jwksInFlight;
}

/**
 * `true` = signature valid, `false` = definitely invalid, `null` = cannot decide locally
 * (non-ES256 token, unknown kid after refresh, JWKS unavailable).
 */
export async function verifyAccessTokenLocally(token: string): Promise<boolean | null> {
  const header = decodeTokenHeader(token);
  if (!header || header.alg !== "ES256" || !header.kid) return null;
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return false;
  try {
    let keys = await loadJwks();
    let key = keys.get(header.kid);
    if (!key && jwksCache) {
      // Key rotation: refresh once, then give up locally.
      jwksCache = null;
      keys = await loadJwks();
      key = keys.get(header.kid);
    }
    if (!key) return null;
    const signature = base64UrlToBytes(s);
    if (signature.length !== 64) return false;
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    return null;
  }
}

function isJwtRejectError(message: string | undefined): boolean {
  const msg = (message ?? "").toLowerCase();
  return (
    msg.includes("jwt") ||
    msg.includes("unauthorized") ||
    msg.includes("invalid claim") ||
    msg.includes("token is expired") ||
    msg.includes("bad_jwt")
  );
}

/** Anon client with the caller's Bearer — PostgREST verifies HS256 without Auth /user. */
function createUserScopedSupabase(accessToken: string): SupabaseClient {
  const key = requiredEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
  );
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    key,
    {
      ...clientOptions(key),
      global: {
        ...clientOptions(key).global,
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  );
}

export async function requireUserId(req: Request): Promise<string> {
  const user = await requireUser(req);
  return user.id;
}

/**
 * JWT → id + email.
 * Prefer PostgREST probe (validates signature locally on API) over Auth getUser —
 * Auth /auth/v1/user often 522/504 under load and would hang every admin route.
 */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();

  const claims = decodeAccessTokenClaims(token);
  if (!claims) throw unauthorized();
  if (claims.exp != null && claims.exp * 1000 <= Date.now()) throw unauthorized();

  // 0) Local ES256 verification against the project JWKS — no DB round trip at all.
  const local = await verifyAccessTokenLocally(token);
  if (local === true) return { id: claims.sub, email: claims.email };
  if (local === false) throw unauthorized();

  // 1) PostgREST: verifies JWT with project secret; no Auth round-trip.
  try {
    const probe = createUserScopedSupabase(token)
      .from("user_roles")
      .select("user_id")
      .limit(1);
    const { error } = await withTimeout(Promise.resolve(probe), AUTH_PROBE_TIMEOUT_MS);
    if (!error) {
      return { id: claims.sub, email: claims.email };
    }
    if (isJwtRejectError(error.message) || error.code === "PGRST301") {
      throw unauthorized();
    }
    // Non-JWT PostgREST error — fall through to Auth.
  } catch (err) {
    if (err instanceof Response) throw err;
    // timeout / network — try Auth once, then 503
  }

  // 2) Auth getUser (single attempt, hard timeout). Avoids double anon+service hang.
  try {
    const anon = await withTimeout(
      Promise.resolve(createAnonSupabase().auth.getUser(token)),
      AUTH_PROBE_TIMEOUT_MS,
    );
    if (!anon.error && anon.data.user) {
      return {
        id: anon.data.user.id,
        email: anon.data.user.email?.trim() || claims.email,
      };
    }
    if (anon.error && isJwtRejectError(anon.error.message)) {
      throw unauthorized();
    }
  } catch (err) {
    if (err instanceof Response) throw err;
  }

  throw authUnavailable();
}

/**
 * Гейт админ-панели: валидный JWT + роль admin в public.user_roles.
 * Использовать в КАЖДОМ роуте app/api/admin/*. Возвращает userId админа.
 * Проверка роли идёт через service client (RLS user_roles разрешает читать
 * только свои строки, но нам нужен детерминированный ответ без RLS-нюансов).
 */
export async function requireAdmin(req: Request): Promise<string> {
  const userId = await requireUserId(req);
  const { data, error } = await createServiceSupabase()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  return userId;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  const message = extractErrorMessage(error);
  console.error("[api]", message, error);
  return json({ error: message }, { status: isTimeoutError(error) ? 504 : 500 });
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; error_description?: unknown; details?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error_description === "string" && record.error_description.trim()) {
      return record.error_description;
    }
    if (typeof record.details === "string" && record.details.trim()) return record.details;
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Internal server error";
}
