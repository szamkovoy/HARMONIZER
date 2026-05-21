import { isLikelyFetchNetworkFailure } from "@/modules/auth/authNetworkErrors";

const DEFAULT_DELAYS_MS = [450, 900] as const;

function isRetryableNetworkError(error: unknown): boolean {
  if (isLikelyFetchNetworkFailure(error)) return true;
  if (error instanceof Error && /network error for /i.test(error.message)) return true;
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
