import { getBrowserSupabase, resetBrowserSupabase } from "./supabaseBrowser";

/** Ошибка /api/admin/* с HTTP-статусом — чтобы UI не разлогинивал на сетевых сбоях. */
export class AdminApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.body = body;
  }
}

/** Один refresh за раз — иначе два параллельных refreshSession сжигают single-use refresh token → SIGNED_OUT. */
let refreshInFlight: Promise<string | null> | null = null;

const GET_SESSION_TIMEOUT_MS = 8_000;
const REFRESH_TIMEOUT_MS = 12_000;
const FETCH_TIMEOUT_MS = 45_000;
/** Refresh access token if it expires within this window. */
const PROACTIVE_REFRESH_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AdminApiError(`${label} — превышено время ожидания`, 408));
    }, ms);
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

function jwtExpiryMs(accessToken: string): number | null {
  try {
    const payloadPart = accessToken.split(".")[1];
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const sessionPromise = getBrowserSupabase()
          .auth.refreshSession()
          .then(({ data }) => data.session?.access_token ?? null);
        return await withTimeout(
          sessionPromise,
          REFRESH_TIMEOUT_MS,
          "Обновление сессии",
        );
      } catch {
        // Hung refresh holds supabase-js auth lock — drop client so login can proceed.
        resetBrowserSupabase();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

/**
 * Resolve a usable access token. Critical: supabase `getSession()` may internally
 * await auto-refresh and hang forever — always race it with a timeout.
 */
async function resolveAccessToken(explicit?: string): Promise<string> {
  const given = explicit?.trim();
  if (given) return given;

  let token: string | undefined;
  try {
    const sessionPromise = getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => data.session?.access_token ?? undefined);
    token = await withTimeout(sessionPromise, GET_SESSION_TIMEOUT_MS, "Чтение сессии");
  } catch {
    // Timed-out getSession still runs under the hood and blocks sign-in — reset.
    resetBrowserSupabase();
    token = undefined;
  }

  const expMs = token ? jwtExpiryMs(token) : null;
  const needsRefresh =
    !token || (expMs != null && expMs - Date.now() < PROACTIVE_REFRESH_MS);

  if (needsRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return refreshed;
  }

  if (token) return token;
  throw new AdminApiError("Сессия не найдена — войдите заново", 401);
}

function authErrorMessage(status: number, bodyError?: string | null): string {
  if (status === 401) {
    if (!bodyError || bodyError === "Unauthorized") {
      return "Сессия истекла — обновите страницу и войдите снова";
    }
    return bodyError;
  }
  if (status === 403 && (!bodyError || bodyError === "Forbidden")) {
    return "Нет прав администратора";
  }
  if (status === 408) {
    return bodyError?.trim() || "Превышено время ожидания — попробуйте ещё раз";
  }
  return bodyError?.trim() || `Ошибка сервера (HTTP ${status})`;
}

async function parseErrorPayload(
  res: Response,
): Promise<{ message: string | null; body: unknown }> {
  try {
    const body = (await res.json()) as { error?: string };
    return { message: body?.error ?? null, body };
  } catch {
    return { message: null, body: null };
  }
}

/** fetch к /api/admin/* с Bearer-токеном текущей сессии. Бросает AdminApiError / Error. */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
  opts?: { accessToken?: string; timeoutMs?: number },
): Promise<T> {
  let token = await resolveAccessToken(opts?.accessToken);
  const fetchTimeoutMs =
    typeof opts?.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : FETCH_TIMEOUT_MS;

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const hasBody = init?.body != null && init.body !== "";

  async function doFetch(accessToken: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    // Не ставим Content-Type на bodyless DELETE/GET — ломает часть прокси и провоцирует лишний preflight.
    if (!isFormData && hasBody) {
      headers["Content-Type"] = "application/json";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      return await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: {
          ...headers,
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AdminApiError("Сервер не ответил вовремя — попробуйте ещё раз", 408);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken && retryToken !== token) {
      token = retryToken;
      res = await doFetch(retryToken);
    }
  }

  if (!res.ok) {
    const { message, body } = await parseErrorPayload(res);
    throw new AdminApiError(authErrorMessage(res.status, message), res.status, body);
  }

  const text = await res.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

/** То же, что adminFetch, но возвращает Blob (для вложений / скачивания). */
export async function adminFetchBlob(
  path: string,
  init?: RequestInit,
  opts?: { accessToken?: string },
): Promise<Blob> {
  const token = await resolveAccessToken(opts?.accessToken);

  async function doFetch(accessToken: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(path, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers ?? {}),
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AdminApiError("Сервер не ответил вовремя — попробуйте ещё раз", 408);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken && retryToken !== token) {
      res = await doFetch(retryToken);
    }
  }

  if (!res.ok) {
    const { message, body } = await parseErrorPayload(res);
    throw new AdminApiError(authErrorMessage(res.status, message), res.status, body);
  }
  return res.blob();
}
