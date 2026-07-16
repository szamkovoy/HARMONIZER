import type { Session, User } from "@supabase/supabase-js";
import type { Database } from "@/services/supabase-types";

export type AuthUserRow = Database["public"]["Tables"]["users"]["Row"];

/** Состояние авторизации, которое отдаёт `useAuth()`. */
export interface AuthState {
  /** Supabase session; null = не залогинен. */
  session: Session | null;
  /** Supabase auth user (минимум: id, email) — берём из session.user. */
  authUser: User | null;
  /** Профиль из public.users (расширенные поля: tz, lat, lon, onboarded_at…). */
  profile: AuthUserRow | null;
  /** Первичная загрузка (проверка сохранённой сессии из SecureStore). */
  initializing: boolean;
  /** Идёт загрузка профиля после смены session (возвращение пользователя). */
  profileLoading: boolean;
  /** Идёт операция входа/выхода. */
  signingIn: boolean;
}

export interface AuthActions {
  /** Отправить письмо с 6-значным кодом (email-OTP; создаёт аккаунт при первом входе). */
  requestEmailCode: (email: string, displayName?: string) => Promise<void>;
  /** Проверить код из письма; успех = активная Supabase-сессия.
   *  Если передано `displayName`, обновляет имя в профиле существующего пользователя
   *  (для нового пользователя имя уже проставляется триггером при создании). */
  verifyEmailCode: (email: string, code: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Перечитать public.users — например, после онбординга. */
  refreshProfile: () => Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;
