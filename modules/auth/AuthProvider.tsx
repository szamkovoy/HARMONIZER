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

import { requireSupabase } from "@/services/supabase";
import { recoverAuthSessionFromPersistedStorageWithRetries } from "./bootstrapRecoverSession";
import { rewriteAuthNetworkError } from "./authNetworkErrors";
import { signInWithApple } from "./sign-in-apple";
import { signInWithGoogle, signOutGoogle } from "./sign-in-google";
import type { AuthContextValue, AuthUserRow } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);
export { AuthContext };

const PROFILE_FETCH_TIMEOUT_MS = 10_000;
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

async function fetchProfile(userId: string): Promise<AuthUserRow | null> {
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
      return null;
    }
    return data;
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
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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
  /** Актуальная сессия для AppState без устаревшего замыкания. */
  const sessionRef = useRef<Session | null>(null);

  const syncProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      lastUserIdRef.current = null;
      return;
    }
    lastUserIdRef.current = user.id;
    setProfileLoading(true);
    const row = await fetchProfile(user.id);
    if (lastUserIdRef.current === user.id) {
      setProfile(row);
      setProfileLoading(false);
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
      sessionRef.current = next;
      setAuthCore({ session: next, initializing: false });
      void syncProfile(next?.user ?? null).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] syncProfile onAuthStateChange",
          rewriteAuthNetworkError(error, "profile").message,
        );
      });
      if (next) {
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
          resolved = await recoverAuthSessionFromPersistedStorageWithRetries();
        }
        if (cancelled || initialSessionReady) return;
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
      setAuthCore((prev) => ({ ...prev, session: next }));
      void syncProfile(next?.user ?? null).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] syncProfile onAuthStateChange",
          rewriteAuthNetworkError(error, "profile").message,
        );
      });

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

  const doSignInApple = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithApple();
    } finally {
      setSigningIn(false);
    }
  }, []);

  const doSignInGoogle = useCallback(async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } finally {
      setSigningIn(false);
    }
  }, []);

  const doSignOut = useCallback(async () => {
    setSigningIn(true);
    try {
      const supabase = requireSupabase();
      await supabase.auth.signOut();
      await signOutGoogle();
    } finally {
      setSigningIn(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await syncProfile(session?.user ?? null);
  }, [session, syncProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      authUser: session?.user ?? null,
      profile,
      profileLoading,
      initializing,
      signingIn,
      signInWithApple: doSignInApple,
      signInWithGoogle: doSignInGoogle,
      signOut: doSignOut,
      refreshProfile,
    }),
    [
      session,
      profile,
      profileLoading,
      initializing,
      signingIn,
      doSignInApple,
      doSignInGoogle,
      doSignOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
