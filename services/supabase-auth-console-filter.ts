/**
 * Supabase Auth (@supabase/auth-js) логирует временные сетевые сбои через
 * `console.error` (см. GoTrueClient: _autoRefreshTokenTick, _recoverAndRefresh).
 * В React Native это даёт красный LogBox и строки `ERROR` в Metro без полезного контекста.
 *
 * В __DEV__ на нативных платформах понижаем только сообщения, явно связанные с auth-js
 * и типичным сбоем fetch.
 */
import { LogBox, Platform } from "react-native";

import {
  isInvalidRefreshTokenError,
  isLikelyAuthJsFetchAbort,
  isLikelyFetchNetworkFailure,
} from "@/modules/auth/authNetworkErrors";
import { isAuthRetryableFetchError } from "@supabase/auth-js";

const SUPABASE_AUTH_TICK =
  "Auto refresh tick failed with error. This is likely a transient error.";

function argsText(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ""}`;
      return "";
    })
    .join("\n");
}

/**
 * `@supabase/auth-js` в `_handleRequest` делает `console.error(e)` до throw, где `e` —
 * часто «голый» TypeError из RN fetch polyfill; в стеке только fetch.umd.js, без пути auth-js.
 */
function isBareRnFetchNetworkTypeErrorLog(args: unknown[]): boolean {
  if (args.length !== 1) return false;
  const e = args[0];
  if (!(e instanceof TypeError)) return false;
  if (!isLikelyFetchNetworkFailure(e)) return false;
  const st = e.stack ?? "";
  return /fetch\.umd\.js|whatwg-fetch/i.test(st);
}

/** Сообщение DOMException/полифилла при AbortController — совпадает с таймаутом в `supabase.ts`. */
function isBareAbortAbortedArg(arg: unknown): boolean {
  if (arg == null || typeof arg !== "object") return false;
  const o = arg as { name?: unknown; message?: unknown };
  return (
    o.name === "AbortError" &&
    typeof o.message === "string" &&
    /^aborted$/i.test(o.message.trim())
  );
}

function shouldDemoteToWarn(args: unknown[]): boolean {
  if (args.some((a) => isInvalidRefreshTokenError(a))) return true;
  if (args.some((a) => isAuthRetryableFetchError(a))) return true;
  if (args.some((a) => isLikelyAuthJsFetchAbort(a))) return true;
  if (args.some((a) => isBareAbortAbortedArg(a))) return true;
  const joined = argsText(args);
  if (/Invalid Refresh Token|Refresh Token Not Found/i.test(joined)) return true;
  if (joined.includes(SUPABASE_AUTH_TICK)) return true;
  if (isBareRnFetchNetworkTypeErrorLog(args)) return true;
  if (args.length === 1 && /^(TypeError:\s*)?Network request failed/i.test(joined.trim())) return true;

  const fromSupabaseAuth =
    joined.includes("auth-js") ||
    joined.includes("GoTrueClient") ||
    joined.includes("@supabase/auth-js") ||
    /AuthRetryableFetchError|CustomAuthError/.test(joined);
  if (!fromSupabaseAuth) return false;
  return args.some((a) => isLikelyFetchNetworkFailure(a) || isAuthRetryableFetchError(a));
}

export function installSupabaseAuthConsoleFilter(): void {
  if (!__DEV__ || Platform.OS === "web") return;

  LogBox.ignoreLogs([
    SUPABASE_AUTH_TICK,
    /Auto refresh tick failed with error/i,
    /** RN/Hermes: иногда `console.error` получает только строку вида `[AbortError: Aborted]`. */
    /AbortError:\s*Aborted/i,
    /Invalid Refresh Token/i,
    /Refresh Token Not Found/i,
  ]);

  const g = globalThis as { __harmonizerSupabaseAuthConsoleFilter?: boolean };
  if (g.__harmonizerSupabaseAuthConsoleFilter) return;
  g.__harmonizerSupabaseAuthConsoleFilter = true;

  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      if (shouldDemoteToWarn(args)) {
        // eslint-disable-next-line no-console
        console.warn("[supabase-auth]", ...args);
        return;
      }
    } catch {
      /* never break logging */
    }
    orig(...args);
  };
}

installSupabaseAuthConsoleFilter();
