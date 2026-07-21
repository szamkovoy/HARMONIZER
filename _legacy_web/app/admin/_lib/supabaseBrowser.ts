import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let authConsoleFilterInstalled = false;

// Должно совпадать с EXPIRY_MARGIN_MS в @supabase/auth-js
// (AUTO_REFRESH_TICK_THRESHOLD * AUTO_REFRESH_TICK_DURATION_MS = 3 * 30_000).
const SESSION_EXPIRY_MARGIN_MS = 90_000;

type StoredAuthBlob = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  currentSession?: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_at?: unknown;
  } | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Decode JWT `exp` (seconds) without verifying signature — only for local expiry prune. */
function jwtExpirySec(accessToken: unknown): number | null {
  if (typeof accessToken !== "string" || !accessToken.includes(".")) return null;
  try {
    const payloadPart = accessToken.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return asFiniteNumber(payload.exp);
  } catch {
    return null;
  }
}

function sessionExpirySec(blob: StoredAuthBlob): number | null {
  return (
    asFiniteNumber(blob.expires_at) ??
    asFiniteNumber(blob.currentSession?.expires_at) ??
    jwtExpirySec(blob.access_token) ??
    jwtExpirySec(blob.currentSession?.access_token)
  );
}

function sessionAccessToken(blob: StoredAuthBlob): string | null {
  const direct = blob.access_token;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = blob.currentSession?.access_token;
  if (typeof nested === "string" && nested.trim()) return nested;
  return null;
}

function sessionRefreshToken(blob: StoredAuthBlob): string | null {
  const direct = blob.refresh_token;
  if (typeof direct === "string" && direct.trim()) return direct;
  const nested = blob.currentSession?.refresh_token;
  if (typeof nested === "string" && nested.trim()) return nested;
  return null;
}

/**
 * True when local session cannot be recovered quietly by supabase-js.
 * Incomplete / expired / near-expiry sessions are removed so
 * `_recoverAndRefresh` never calls refresh with a revoked token and
 * `console.error(AuthApiError)` (Next.js dev overlay).
 */
function shouldDiscardStoredSession(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!parsed || typeof parsed !== "object") return true;
  const blob = parsed as StoredAuthBlob;
  if (!sessionAccessToken(blob) || !sessionRefreshToken(blob)) return true;
  const expiresAt = sessionExpirySec(blob);
  if (expiresAt == null) return true;
  return expiresAt * 1000 - Date.now() < SESSION_EXPIRY_MARGIN_MS;
}

function isSupabaseAuthTokenKey(key: string): boolean {
  // Default persist key: `sb-<project-ref>-auth-token`
  return key.includes("-auth-token") && !key.endsWith("-auth-token-code-verifier");
}

/**
 * Подчищает из localStorage непригодную сессию Supabase ДО createClient(),
 * чтобы `_initialize → _recoverAndRefresh` не делал console.error(AuthApiError).
 */
function pruneUnusableSupabaseSession(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const storage = window.localStorage;
    for (const key of Object.keys(storage)) {
      if (!isSupabaseAuthTokenKey(key)) continue;
      const raw = storage.getItem(key);
      if (!raw || shouldDiscardStoredSession(raw)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Лучший случай — supabase-js сам почистит сессию через _removeSession.
  }
}

function errorText(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message}`;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { name?: unknown; message?: unknown; code?: unknown };
    return [record.name, record.message, record.code].filter(Boolean).map(String).join(" ");
  }
  return "";
}

/** Auth refresh failures that supabase-js logs via console.error (triggers Next.js overlay). */
function isIgnorableSupabaseAuthConsoleError(args: unknown[]): boolean {
  const text = args.map(errorText).join(" ");
  if (!text) return false;
  if (/Invalid Refresh Token/i.test(text)) return true;
  if (/Refresh Token Not Found/i.test(text)) return true;
  if (/AuthApiError/i.test(text) && /refresh token/i.test(text)) return true;
  if (/AuthSessionMissingError/i.test(text)) return true;
  return false;
}

/**
 * Next.js 15 dev overlay treats console.error as a blocking "Issue".
 * supabase-js intentionally console.error's non-retryable refresh failures
 * even after it removes the session — suppress only those known auth cases
 * so login/admin UI stays usable. Real app errors still go through.
 */
function installSupabaseAuthConsoleFilter(): void {
  if (authConsoleFilterInstalled || typeof window === "undefined") return;
  authConsoleFilterInstalled = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (isIgnorableSupabaseAuthConsoleError(args)) return;
    original(...args);
  };
}

/**
 * Браузерный Supabase-клиент админки (anon key, сессия в localStorage).
 * Используется ТОЛЬКО для аутентификации; данные админка получает через
 * /api/admin/* (service role на сервере), а не прямыми запросами к БД.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    installSupabaseAuthConsoleFilter();
    pruneUnusableSupabaseSession();
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}
