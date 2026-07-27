import { getBrowserSupabase } from "./supabaseBrowser";

/** Ошибка /api/admin/* с HTTP-статусом — чтобы UI не разлогинивал на сетевых сбоях. */
export class AdminApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

/** Один refresh за раз — иначе два параллельных refreshSession сжигают single-use refresh token → SIGNED_OUT. */
let refreshInFlight: Promise<string | null> | null = null;

const REFRESH_TIMEOUT_MS = 12_000;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const sessionPromise = getBrowserSupabase()
          .auth.refreshSession()
          .then(({ data }) => data.session?.access_token ?? null);
        const timeoutPromise = new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), REFRESH_TIMEOUT_MS);
        });
        return await Promise.race([sessionPromise, timeoutPromise]);
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
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
  return bodyError?.trim() || `Ошибка сервера (HTTP ${status})`;
}

/** fetch к /api/admin/* с Bearer-токеном текущей сессии. Бросает AdminApiError / Error. */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
  opts?: { accessToken?: string },
): Promise<T> {
  let token = opts?.accessToken?.trim();
  if (!token) {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
    if (!token) {
      token = (await refreshAccessToken()) ?? undefined;
    }
  }
  if (!token) throw new AdminApiError("Сессия не найдена — войдите заново", 401);

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
    return fetch(path, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers ?? {}),
      },
    });
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken && retryToken !== token) {
      res = await doFetch(retryToken);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AdminApiError(authErrorMessage(res.status, body?.error), res.status);
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
  let token = opts?.accessToken?.trim();
  if (!token) {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
    if (!token) {
      token = (await refreshAccessToken()) ?? undefined;
    }
  }
  if (!token) throw new AdminApiError("Сессия не найдена — войдите заново", 401);

  async function doFetch(accessToken: string) {
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    const retryToken = await refreshAccessToken();
    if (retryToken && retryToken !== token) {
      res = await doFetch(retryToken);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AdminApiError(authErrorMessage(res.status, body?.error), res.status);
  }
  return res.blob();
}
