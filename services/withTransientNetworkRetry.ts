import { isLikelyFetchNetworkFailure } from "@/modules/auth/authNetworkErrors";
import { appUserErrorKind, isAppUserError } from "@/services/userFacingErrors";

const DEFAULT_DELAYS_MS = [450, 900] as const;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/** PostgREST «schema cache» / 502–503 — кратковременный сбой API Supabase. */
function isTransientBackendError(error: unknown): boolean {
  const message = errorText(error);
  if (/schema cache/i.test(message)) return true;
  if (/\bHTTP 502\b|\bHTTP 503\b/i.test(message)) return true;
  if (/account\/ott HTTP 50[23]/i.test(message)) return true;
  if (isAppUserError(error) && appUserErrorKind(error) === "service_busy") return true;
  return false;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (isLikelyFetchNetworkFailure(error)) return true;
  if (error instanceof Error && /network error for /i.test(error.message)) return true;
  if (isAppUserError(error) && appUserErrorKind(error) === "network") return true;
  if (isTransientBackendError(error)) return true;
  const cause =
    isAppUserError(error) && error.causeDetail !== undefined ? error.causeDetail : null;
  if (cause && isLikelyFetchNetworkFailure(cause)) return true;
  if (cause && isTransientBackendError(cause)) return true;
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });
}

/**
 * Runs `fn` up to `attempts` times when the failure looks like a transient RN network drop.
 * Aborts are not retried.
 */
export async function withTransientNetworkRetry<T>(
  fn: () => Promise<T>,
  options?: {
    attempts?: number;
    delaysMs?: readonly number[];
    signal?: AbortSignal;
  },
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 1 + DEFAULT_DELAYS_MS.length);
  const delays = options?.delaysMs ?? DEFAULT_DELAYS_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options?.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const aborted =
        options?.signal?.aborted ||
        (error instanceof Error && error.name === "AbortError") ||
        (typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError");
      if (aborted) throw error;
      if (!isRetryableNetworkError(error) || attempt >= attempts - 1) throw error;
      await sleep(delays[attempt] ?? delays[delays.length - 1] ?? 900, options?.signal);
    }
  }

  throw lastError;
}
