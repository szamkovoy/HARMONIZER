/**
 * Контекст авторизации.
 *
 * Обязанности:
 *   • Подписаться на изменения session в Supabase (`onAuthStateChange`) и
 *     отдавать свежее состояние потребителям через React Context.
 *   • При старте приложения — дождаться первого события `onAuthStateChange`
 *     (SDK сам читает SecureStore и рефрешит токен). Пока идёт проверка,
 *     `initializing = true` — гейт в
 *     `app/_layout.tsx` показывает сплэш. Если SDK отдал `null` из‑за
 *     транзиентной сети при refresh, но в SecureStore сессия ещё есть,
 *     выполняется восстановление через `setSession` (см. `bootstrapRecoverSession.ts`).
 *   • Синхронизировать профиль `public.users` (авто-создаётся серверным
 *     триггером `on_auth_user_created`; мы дожидаемся появления и тянем
 *     строку).
 *   • Автоматически рефрешить токен при возвращении приложения из фона —
 *     через подписку на `AppState`.
 */
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import type { Session, User } from "@supabase/supabase-js";

import { resetLocationPermissionAutoPrompt } from "@/modules/location/acquireAndPersistUserCoordinates";
import { saveCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { rememberSupabaseSession, readPersistedAuthSessionFromStorage, requireSupabase } from "@/services/supabase";
import { recoverAuthSessionFromPersistedStorageWithRetries } from "./bootstrapRecoverSession";
import { rewriteAuthNetworkError } from "./authNetworkErrors";
import {
  provisionRestoreCredential,
  revokeRestoreCredentialOnSignOut,
  tryRestoreCredentialSignIn,
} from "./restoreCredentials";
import { requestEmailOtpCode, verifyEmailOtpCode } from "./sign-in-email";
import type { AuthContextValue, AuthUserRow } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);
export { AuthContext };

/** Один attempt; при таймауте/сети syncProfile делает несколько коротких попыток.
 *  5s на cold QR/dev-client часто рвалось AbortError → profile=null → free
 *  global-content и вечный сплэш «Собираем общий настрой дня». */
const PROFILE_FETCH_TIMEOUT_MS = 15_000;
const PROFILE_FETCH_MAX_ATTEMPTS = 4;
const PROFILE_FETCH_RETRY_GAP_MS = 600;
/** Если подписка GoTrue по какой-то причине не отдала первое событие — не держим сплэш вечно. */
const AUTH_BOOTSTRAP_SAFETY_MS = 35_000;
/**
 * Редко SDK отдаёт INITIAL_SESSION с session=null, а через мгновение — второе
 * событие с реальной сессией. Не завершаем bootstrap сразу, чтобы не мигнул
 * /sign-in и не сработал гейт с «ложным выходом».
 */
const INITIAL_SESSION_NULL_DEBOUNCE_MS = 1_200;

interface AuthProviderProps {
  children: ReactNode;
}

function getProfileRequestUrl(userId: string): string {
  const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const url = new URL("/rest/v1/users", baseUrl);
  url.searchParams.set("select", "*");
  url.searchParams.set("id", `eq.${userId}`);
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProfileOnce(userId: string): Promise<{ row: AuthUserRow | null; failed: boolean }> {
  const supabase = requireSupabase();
  // eslint-disable-next-line no-console
  console.log("[auth] fetchProfile url", getProfileRequestUrl(userId));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROFILE_FETCH_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .abortSignal(controller.signal)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[auth] fetchProfile error", error.message);
      return { row: null, failed: true };
    }
    return { row: data, failed: false };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] fetchProfile network error",
      controller.signal.aborted
        ? `Supabase users fetch timed out after ${Math.round(PROFILE_FETCH_TIMEOUT_MS / 1000)}s`
        : error instanceof Error
          ? error.message
          : String(error),
    );
    return { row: null, failed: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Несколько коротких попыток: холодный PostgREST/JWT часто оживает на 2-й. */
async function fetchProfile(userId: string): Promise<{ row: AuthUserRow | null; failed: boolean }> {
  let last: { row: AuthUserRow | null; failed: boolean } = { row: null, failed: true };
  for (let attempt = 1; attempt <= PROFILE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    last = await fetchProfileOnce(userId);
    if (!last.failed) return last;
    if (attempt < PROFILE_FETCH_MAX_ATTEMPTS) {
      // eslint-disable-next-line no-console
      console.warn(`[auth] fetchProfile retry ${attempt}/${PROFILE_FETCH_MAX_ATTEMPTS}`);
      await sleep(PROFILE_FETCH_RETRY_GAP_MS * attempt);
    }
  }
  return last;
}

export function AuthProvider({ children }: AuthProviderProps) {
  /** Одно обновление: гейт в `_layout` никогда не увидит `initializing=false` при устаревшем session. */
  const [authCore, setAuthCore] = useState<{ session: Session | null; initializing: boolean }>({
    session: null,
    initializing: true,
  });
  const { session, initializing } = authCore;
  const [profile, setProfile] = useState<AuthUserRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  // Держим последний seen user id — перечитываем профиль только при смене.
  const lastUserIdRef = useRef<string | null>(null);
  /** Имя из формы входа — применится в syncProfile сразу после установки сессии (шаг 1),
   *  без зависимости от онбординга/шага 2. */
  const pendingDisplayNameRef = useRef<string | null>(null);
  /** Актуальная сессия для AppState без устаревшего замыкания. */
  const sessionRef = useRef<Session | null>(null);

  const syncProfile = useCallback(async (user: User | null, opts?: { silent?: boolean }) => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      lastUserIdRef.current = null;
      return;
    }
    lastUserIdRef.current = user.id;
    // Silent refresh (Realtime / foreground membership / locale PATCH) must not
    // flip profileLoading — Home's useDayContent aborts in-flight day fetch when
    // profileLoading toggles, which is the recurring midnight free-splash hang.
    const silent = opts?.silent === true;
    if (!silent) {
      setProfileLoading(true);
    }
    const { row: fetched, failed } = await fetchProfile(user.id);
    let row = fetched;
    // Применяем отложенное имя из формы входа (шаг 1) — независимо от того, будет ли
    // показан шаг 2. Имя обновляется сразу после ввода OTP, а не после онбординга.
    const pendingName = pendingDisplayNameRef.current;
    if (pendingName && row && row.display_name !== pendingName) {
      try {
        const supabase = requireSupabase();
        await supabase.from("users").update({ display_name: pendingName }).eq("id", user.id);
        row.display_name = pendingName;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] pending display_name apply failed", error instanceof Error ? error.message : String(error));
      }
    }
    if (pendingName) pendingDisplayNameRef.current = null;
    if (lastUserIdRef.current === user.id) {
      // Транзиентный сбой: не затираем уже известный профиль в null → иначе
      // Access считает тариф «Навигатор» и Home грузит global_daily_content.
      let keptStale = false;
      setProfile((prev) => {
        if (row) return row;
        if (failed && prev?.id === user.id) {
          keptStale = true;
          // eslint-disable-next-line no-console
          console.warn("[auth] fetchProfile failed; keeping previous profile row");
          return prev;
        }
        return null;
      });
      if (typeof row?.lat === "number" && typeof row?.lon === "number") {
        void saveCachedUserCoords(user.id, {
          lat: row.lat,
          lng: row.lon,
          timezone: row.tz?.trim() || "UTC",
        }).catch(() => undefined);
      }
      // Cold start: все attempt-ы упали и профиля ещё не было — не отпускаем
      // сплэш в free/global-content: ещё один полный круг fetch, затем снимаем loading.
      if (failed && !row && !keptStale) {
        if (silent) return;
        const uid = user.id;
        setTimeout(() => {
          if (lastUserIdRef.current !== uid) return;
          void fetchProfile(uid).then(({ row: retryRow }) => {
            if (lastUserIdRef.current !== uid) return;
            if (retryRow) setProfile(retryRow);
            setProfileLoading(false);
          });
        }, 1_500);
        return;
      }
      if (!silent) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const supabase = requireSupabase();
    let cancelled = false;
    let initialSessionReady = false;
    let debounceInitialNullTimer: ReturnType<typeof setTimeout> | null = null;
    let safetyTimerId: ReturnType<typeof setTimeout> | undefined;

    const safeStartAutoRefresh = () => {
      void supabase.auth.startAutoRefresh().catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] startAutoRefresh",
          rewriteAuthNetworkError(error, "refresh").message,
        );
      });
    };
    const safeStopAutoRefresh = () => {
      void supabase.auth.stopAutoRefresh().catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] stopAutoRefresh",
          rewriteAuthNetworkError(error, "refresh").message,
        );
      });
    };

    const completeBootstrap = (next: Session | null) => {
      if (cancelled || initialSessionReady) return;
      initialSessionReady = true;
      if (debounceInitialNullTimer) {
        clearTimeout(debounceInitialNullTimer);
        debounceInitialNullTimer = null;
      }
      if (safetyTimerId !== undefined) {
        clearTimeout(safetyTimerId);
        safetyTimerId = undefined;
      }
      rememberSupabaseSession(next);
      sessionRef.current = next;
      // Raise profileLoading before initializing=false so RootLayout / splash
      // never see a one-tick gap (session set, profile still null, loading false)
      // that collapses the startup splash onto a blank white gate on Android.
      if (next?.user) {
        setProfileLoading(true);
      }
      setAuthCore({ session: next, initializing: false });
      void syncProfile(next?.user ?? null).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] syncProfile onAuthStateChange",
          rewriteAuthNetworkError(error, "profile").message,
        );
      });
      if (next) {
        void provisionRestoreCredential().catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[auth] provisionRestoreCredential",
            error instanceof Error ? error.message : String(error),
          );
        });
        safeStartAutoRefresh();
      } else {
        safeStopAutoRefresh();
      }
    };

    /**
     * SDK может отдать `session === null` при транзиентном refresh (RN «Network request failed»),
     * хотя в SecureStore ещё лежит валидная сессия. `sessionRef` на cold start до первого commit всегда null,
     * поэтому safety-таймаут не должен полагаться на него — читаем диск и синхронизируем через `setSession`.
     */
    const finalizeBootstrapFromSdkSession = (sdkSession: Session | null) => {
      void (async () => {
        let resolved: Session | null = sdkSession;
        if (!resolved) {
          const diskBeforeRecover = await readPersistedAuthSessionFromStorage();
          if (diskBeforeRecover) {
            resolved = await recoverAuthSessionFromPersistedStorageWithRetries();
          }
        }
        if (!resolved) {
          const restored = await tryRestoreCredentialSignIn();
          if (cancelled || initialSessionReady) return;
          if (restored) {
            resolved = await recoverAuthSessionFromPersistedStorageWithRetries();
          }
        }
        if (cancelled || initialSessionReady) return;
        if (!resolved) {
          completeBootstrap(null);
          return;
        }
        completeBootstrap(resolved);
      })();
    };

    safetyTimerId = setTimeout(() => {
      if (cancelled || initialSessionReady) return;
      if (debounceInitialNullTimer) {
        clearTimeout(debounceInitialNullTimer);
        debounceInitialNullTimer = null;
      }
      // eslint-disable-next-line no-console
      console.warn("[auth] bootstrap safety timeout: closing splash without Supabase first event");
      finalizeBootstrapFromSdkSession(null);
    }, AUTH_BOOTSTRAP_SAFETY_MS);

    // Единственный источник для cold start — onAuthStateChange: SDK сам читает
    // хранилище и, при необходимости, рефрешит токен. Не вызываем getSession()
    // параллельно: это захватывает внутренний lock SDK и блокирует INITIAL_SESSION,
    // если сеть медленная (см. AUTH_FETCH_TIMEOUT_MS в supabase.ts).
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (!initialSessionReady) {
        if (next) {
          completeBootstrap(next);
          return;
        }
        if (event === "INITIAL_SESSION") {
          if (debounceInitialNullTimer) clearTimeout(debounceInitialNullTimer);
          debounceInitialNullTimer = setTimeout(() => {
            debounceInitialNullTimer = null;
            if (cancelled || initialSessionReady) return;
            finalizeBootstrapFromSdkSession(null);
          }, INITIAL_SESSION_NULL_DEBOUNCE_MS);
          return;
        }
        if (debounceInitialNullTimer) {
          clearTimeout(debounceInitialNullTimer);
          debounceInitialNullTimer = null;
        }
        finalizeBootstrapFromSdkSession(null);
        return;
      }

      sessionRef.current = next;
      rememberSupabaseSession(next);
      setAuthCore((prev) => ({ ...prev, session: next }));

      // JWT rotation must not re-fetch `users` — profile row is unchanged; avoids
      // profileLoading flicker and home bootstrap side effects on unrelated tabs.
      if (event === "TOKEN_REFRESHED") {
        if (next) safeStartAutoRefresh();
        else safeStopAutoRefresh();
        return;
      }

      const nextUserId = next?.user?.id ?? null;
      const sameUser = nextUserId !== null && nextUserId === lastUserIdRef.current;
      if (sameUser && event !== "USER_UPDATED") {
        sessionRef.current = next;
        rememberSupabaseSession(next);
        setAuthCore((prev) => ({ ...prev, session: next }));
        if (next) safeStartAutoRefresh();
        else safeStopAutoRefresh();
        return;
      }

      void syncProfile(next?.user ?? null).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] syncProfile onAuthStateChange",
          rewriteAuthNetworkError(error, "profile").message,
        );
      });

      if (next && event === "SIGNED_IN") {
        void provisionRestoreCredential().catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn(
            "[auth] provisionRestoreCredential",
            error instanceof Error ? error.message : String(error),
          );
        });
      }

      if (next) {
        safeStartAutoRefresh();
      } else {
        safeStopAutoRefresh();
      }
    });

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (cancelled || !initialSessionReady) return;
      if (state === "active") {
        if (sessionRef.current) {
          safeStartAutoRefresh();
        } else {
          safeStopAutoRefresh();
        }
      } else {
        safeStopAutoRefresh();
      }
    });

    return () => {
      cancelled = true;
      if (debounceInitialNullTimer) {
        clearTimeout(debounceInitialNullTimer);
        debounceInitialNullTimer = null;
      }
      if (safetyTimerId !== undefined) clearTimeout(safetyTimerId);
      sub.subscription.unsubscribe();
      appStateSub.remove();
      safeStopAutoRefresh();
    };
  }, [syncProfile]);

  const doRequestEmailCode = useCallback(async (email: string, displayName?: string) => {
    setSigningIn(true);
    try {
      await requestEmailOtpCode(email, displayName);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const doVerifyEmailCode = useCallback(async (email: string, code: string, displayName?: string) => {
    setSigningIn(true);
    // Имя запоминаем ДО verify — оно применится в syncProfile, который сработает по
    // onAuthStateChange сразу после установки сессии. Имя обновится на шаге 1,
    // даже если шаг 2 (онбординг) будет пропущен.
    pendingDisplayNameRef.current = displayName?.trim() || null;
    try {
      await verifyEmailOtpCode(email, code);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const doSignOut = useCallback(async () => {
    setSigningIn(true);
    try {
      // Android Restore Credentials must not block leaving the session:
      // Credential Manager / Play Services can hang on clearCredentialState.
      void revokeRestoreCredentialOnSignOut();
      const supabase = requireSupabase();
      try {
        await Promise.race([
          supabase.auth.signOut(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("signOut timeout")), 5_000);
          }),
        ]);
      } catch {
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      }
    } finally {
      resetLocationPermissionAutoPrompt();
      setSigningIn(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    // Always silent: callers (MembershipEventsBridge Realtime, GPS persist, Profile
    // save) already have a painted profile; blocking splash must not restart.
    await syncProfile(session?.user ?? null, { silent: true });
  }, [session, syncProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      authUser: session?.user ?? null,
      profile,
      profileLoading,
      initializing,
      signingIn,
      requestEmailCode: doRequestEmailCode,
      verifyEmailCode: doVerifyEmailCode,
      signOut: doSignOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      profileLoading,
      initializing,
      signingIn,
      doRequestEmailCode,
      doVerifyEmailCode,
      doSignOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
