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
import {
  isAuthSessionResultTransientFailure,
  isTransientAuthConnectivityFailure,
  rewriteAuthNetworkError,
} from "./authNetworkErrors";
import { signInWithApple } from "./sign-in-apple";
import { signInWithGoogle, signOutGoogle } from "./sign-in-google";
import type { AuthContextValue, AuthUserRow } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);
export { AuthContext };

const INITIAL_SESSION_TIMEOUT_MS = 15000;
const INITIAL_SESSION_MAX_ATTEMPTS = 4;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Холодный старт: getSession → при истёкшем access token внутри идёт refresh по сети.
 * Временная сеть / таймаут не должны приводить к очистке SecureStore (это делал
 * прежний signOut в catch и выбивало пользователя несколько раз в день).
 */
async function resolveInitialSession(
  supabase: ReturnType<typeof requireSupabase>,
): Promise<Session | null> {
  for (let attempt = 0; attempt < INITIAL_SESSION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Supabase getSession timed out after ${INITIAL_SESSION_TIMEOUT_MS}ms`));
          }, INITIAL_SESSION_TIMEOUT_MS);
        }),
      ]);
      if (data.session) return data.session;
      if (!error) return null;
      if (isAuthSessionResultTransientFailure(error) && attempt < INITIAL_SESSION_MAX_ATTEMPTS - 1) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      return null;
    } catch (error) {
      if (isTransientAuthConnectivityFailure(error) && attempt < INITIAL_SESSION_MAX_ATTEMPTS - 1) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      return null;
    }
  }
  return null;
}

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

    // 1) Восстановить сессию из SecureStore (с ретраями при сетевых сбоях refresh).
    void (async () => {
      const initial = await resolveInitialSession(supabase);
      if (cancelled) return;
      setSession(initial);
      void syncProfile(initial?.user ?? null)
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
          if (initial) {
            safeStartAutoRefresh();
          } else {
            safeStopAutoRefresh();
          }
        });
    })();

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
        if (!sessionRef.current) {
          void supabase.auth
            .getSession()
            .then(({ data }) => {
              if (cancelled || !data.session) return;
              setSession(data.session);
            })
            .catch((error: unknown) => {
              // eslint-disable-next-line no-console
              console.warn(
                "[auth] resume getSession",
                rewriteAuthNetworkError(error, "session").message,
              );
            });
        }
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
