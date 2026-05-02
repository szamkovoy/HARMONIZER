/**
 * Контекст авторизации.
 *
 * Обязанности:
 *   • Подписаться на изменения session в Supabase (`onAuthStateChange`) и
 *     отдавать свежее состояние потребителям через React Context.
 *   • При старте приложения — прочитать сохранённую сессию из SecureStore
 *     (`getSession()`). Пока идёт проверка, `initializing = true` — гейт в
 *     `app/_layout.tsx` показывает сплэш.
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
import { rewriteAuthNetworkError } from "./authNetworkErrors";
import { signInWithApple } from "./sign-in-apple";
import { signInWithGoogle, signOutGoogle } from "./sign-in-google";
import type { AuthContextValue, AuthUserRow } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);
export { AuthContext };

const INITIAL_SESSION_TIMEOUT_MS = 7000;

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
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[auth] fetchProfile error", error.message);
      return null;
    }
    return data;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[auth] fetchProfile network error", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthUserRow | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  // Чтобы избежать гонки между onAuthStateChange и initial getSession,
  // держим последний seen user id — и перечитываем профиль только при смене.
  const lastUserIdRef = useRef<string | null>(null);

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
    const supabase = requireSupabase();
    let cancelled = false;
    let initialSessionReady = false;

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

    const getSessionWithTimeout = Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Supabase getSession timed out after ${INITIAL_SESSION_TIMEOUT_MS}ms`)),
          INITIAL_SESSION_TIMEOUT_MS,
        );
      }),
    ]);

    // 1) Прочитать сохранённую сессию (SecureStore).
    getSessionWithTimeout
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        void syncProfile(data.session?.user ?? null)
          .catch((error: unknown) => {
            // eslint-disable-next-line no-console
            console.warn(
              "[auth] syncProfile after getSession",
              rewriteAuthNetworkError(error, "profile").message,
            );
          })
          .finally(() => {
            if (cancelled) return;
            initialSessionReady = true;
            setInitializing(false);
            safeStartAutoRefresh();
          });
      })
      .catch((error) => {
        if (cancelled) return;
        // На холодном старте сеть может быть ещё недоступна; показываем auth UI,
        // а не красный экран LogBox с безымянным `Network request failed`.
        // eslint-disable-next-line no-console
        console.warn("[auth] getSession failed", rewriteAuthNetworkError(error, "session").message);
        setSession(null);
        setProfile(null);
        initialSessionReady = true;
        setInitializing(false);
        safeStopAutoRefresh();
        void supabase.auth.signOut({ scope: "local" }).catch(() => {});
      });

    // 2) Подписаться на изменения (логин, логаут, рефреш токена).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void syncProfile(next?.user ?? null).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth] syncProfile onAuthStateChange",
          rewriteAuthNetworkError(error, "profile").message,
        );
      });
    });

    // 3) Авто-рефреш запускаем только после первичной проверки сессии.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (cancelled || !initialSessionReady) return;
      if (state === "active") {
        safeStartAutoRefresh();
      } else {
        safeStopAutoRefresh();
      }
    });

    return () => {
      cancelled = true;
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
