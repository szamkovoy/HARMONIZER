import type { AppLocale } from "@/modules/i18n";

export type LocaleRebuildPhase = "idle" | "probing" | "confirm" | "loading" | "error";

export class LocalePickAbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "LocalePickAbortedError";
  }
}

export function isLocalePickAborted(error: unknown): boolean {
  return error instanceof LocalePickAbortedError;
}

/**
 * Ignore a combo tap that would restart the same in-flight pick.
 * A stuck combo (optimistic label, idle phase, store still on the old locale)
 * is NOT ignored — the user can tap the same language again to retry.
 */
export function isRedundantLocalePick(input: {
  code: AppLocale;
  committed: AppLocale;
  optimistic: AppLocale | null;
  phase: LocaleRebuildPhase;
}): boolean {
  if (input.code === input.committed && input.optimistic == null) return true;
  if (input.code === input.optimistic && input.phase !== "idle") return true;
  return false;
}

/**
 * True when this operation is no longer the active one (newer pick/cancel).
 * Callers must not reset optimistic/UI in that case — the newer op owns it.
 */
export function isStaleLocaleOp(opId: number, currentOpId: number, signal: AbortSignal): boolean {
  return currentOpId !== opId || signal.aborted;
}

/**
 * Await `promise` until it settles, `signal` aborts, or `timeoutMs` elapses.
 * A late abort/timeout after success does not reject — needed so probe→ensure
 * can share one AbortController without the ensure start aborting the probe result.
 */
export function raceAbortTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("locale probe timeout"))), timeoutMs);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      action();
    };

    const onAbort = () => finish(() => reject(new LocalePickAbortedError()));

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort);
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
