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
import { signInWithApple } from "./sign-in-apple";
import { signInWithGoogle, signOutGoogle } from "./sign-in-google";
import type { AuthContextValue, AuthUserRow } from "./types";

const AuthContext = createContext<AuthContextValue | null>(null);
export { AuthContext };

interface AuthProviderProps {
  children: ReactNode;
}

async function fetchProfile(userId: string): Promise<AuthUserRow | null> {
  const supabase = requireSupabase();
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

    // 1) Прочитать сохранённую сессию (SecureStore).
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        void syncProfile(data.session?.user ?? null).finally(() =>
          setInitializing(false),
        );
      })
      .catch((error) => {
        // На холодном старте сеть может быть ещё недоступна; показываем auth UI,
        // а не красный экран LogBox с безымянным `Network request failed`.
        // eslint-disable-next-line no-console
        console.warn("[auth] getSession network error", error instanceof Error ? error.message : String(error));
        setSession(null);
        setProfile(null);
        setInitializing(false);
      });

    // 2) Подписаться на изменения (логин, логаут, рефреш токена).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void syncProfile(next?.user ?? null);
    });

    // 3) Авто-рефреш при возврате приложения из фона (рекомендация Supabase).
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    });

    return () => {
      sub.subscription.unsubscribe();
      appStateSub.remove();
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
