import { isAuthRetryableFetchError } from "@supabase/auth-js";

/**
 * React Native / fetch часто отдают только `TypeError: Network request failed`
 * без URL и без кода — пользователю и разработчику это не помогает.
 */
export function isLikelyFetchNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  const name = error instanceof Error ? error.name : "";
  if (/Network request failed/i.test(message)) return true;
  if (name === "TypeError" && /Failed to fetch|NetworkError|network/i.test(message)) return true;
  return false;
}

/**
 * Наш таймаут refresh в `services/supabase.ts` даёт `AbortError` с сообщением «Aborted».
 * Обычно в стеке есть `whatwg-fetch` / `fetch.umd.js`, но на Hermes/iOS кадры polyfill
 * иногда отсутствуют — тогда остаётся только путь `@supabase/auth-js/.../fetch.js`.
 * `DOMException` из polyfill не всегда проходит `instanceof Error` — проверяем поля.
 */
export function isLikelyAuthJsFetchAbort(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const o = error as { name?: unknown; message?: unknown; stack?: unknown };
  const name = typeof o.name === "string" ? o.name : "";
  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (name !== "AbortError" || !/^aborted$/i.test(message)) return false;
  const st = typeof o.stack === "string" ? o.stack : "";
  return (
    /fetch\.umd\.js|whatwg-fetch/i.test(st) ||
    /[/\\]@supabase[/\\]auth-js[/\\]|[/\\]auth-js[/\\]dist[/\\]/i.test(st)
  );
}

/** Ошибка при старте / рефреше сессии, после которой токены в SecureStore ещё могут быть валидны. */
export function isTransientAuthConnectivityFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (isLikelyAuthJsFetchAbort(error)) return true;
  if (isLikelyFetchNetworkFailure(error)) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
  if (/getSession timed out/i.test(message)) return true;
  return false;
}

export function isAuthSessionResultTransientFailure(error: unknown | null | undefined): boolean {
  if (!error) return false;
  return (
    isAuthRetryableFetchError(error) || isLikelyAuthJsFetchAbort(error) || isLikelyFetchNetworkFailure(error)
  );
}

export function rewriteAuthNetworkError(
  error: unknown,
  context: "session" | "sign_in" | "refresh" | "profile",
): Error {
  if (isLikelyFetchNetworkFailure(error)) {
    const hint =
      context === "session"
        ? "Не удалось восстановить сессию"
        : context === "sign_in"
          ? "Не удалось завершить вход"
          : context === "refresh"
            ? "Не удалось обновить сессию в фоне"
            : "Не удалось загрузить профиль";
    return new Error(
      `${hint}: нет связи с сервером авторизации (Supabase). Проверьте Wi‑Fi/VPN, ` +
        `что в .env.local заданы EXPO_PUBLIC_SUPABASE_URL (https://…supabase.co) и ` +
        `EXPO_PUBLIC_SUPABASE_ANON_KEY, затем перезапустите Metro с очисткой кэша: npx expo start -c`,
    );
  }
  if (error instanceof Error) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error(String(error));
}
