/**
 * Email-OTP вход (единственный способ авторизации в приложении).
 *
 * Поток:
 *   1. `requestEmailOtpCode(email, displayName)` → Supabase `signInWithOtp`
 *      с `shouldCreateUser: true`. Для нового пользователя GoTrue создаёт
 *      auth-запись, триггер `handle_new_auth_user` — строку `public.users`
 *      (display_name берётся из `raw_user_meta_data.full_name`).
 *   2. Письмо с 6-значным кодом отправляет edge-функция `send-auth-email`
 *      (Send Email Hook, SMTP Яндекса) на языке пользователя.
 *   3. `verifyEmailOtpCode(email, code)` → `verifyOtp({ type: "email" })` —
 *      SDK получает сессию, дальше работает стандартный AuthProvider-поток.
 *
 * Deep links не нужны: код вводится вручную, `detectSessionInUrl: false`
 * в services/supabase.ts остаётся в силе.
 */
import { getResponseLocale } from "@/modules/i18n";
import { requireSupabase } from "@/services/supabase";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_RX.test(raw.trim());
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Запросить письмо с кодом. Бросает Supabase-ошибку как есть (UI мапит в локализованный текст). */
export async function requestEmailOtpCode(email: string, displayName?: string): Promise<void> {
  const supabase = requireSupabase();
  const name = displayName?.trim();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      shouldCreateUser: true,
      data: {
        ...(name ? { full_name: name } : {}),
        locale: getResponseLocale(),
      },
    },
  });
  if (error) throw error;
}

/** Проверить код из письма. Успех = SDK установил сессию (onAuthStateChange подхватит). */
export async function verifyEmailOtpCode(email: string, code: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.verifyOtp({
    email: normalizeEmail(email),
    token: code.trim(),
    type: "email",
  });
  if (error) throw error;
}
