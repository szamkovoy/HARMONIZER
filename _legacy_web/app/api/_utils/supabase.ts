import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

/** sb_* keys are not JWTs — never send them as Authorization: Bearer. */
function fetchWithoutSbBearer(apiKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (isModernSupabaseApiKey(apiKey)) {
      const auth = headers.get("Authorization");
      if (auth && /^Bearer\s+sb_/i.test(auth)) {
        headers.delete("Authorization");
      }
      if (!headers.has("apikey")) headers.set("apikey", apiKey);
    }
    return fetch(input, { ...init, headers });
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
  return json({ error: message }, { status: 500 });
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
