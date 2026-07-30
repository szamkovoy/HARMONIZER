/**
 * Email-OTP вход (единственный способ авторизации в приложении).
 *
 * Поток:
 *   1. `requestOtpSendPermit` → App Check + rate limits → single-use permit
 *   2. `set_signin_name_hint` + `signInWithOtp` → GoTrue → send-auth-email
 *      (consumes permit, sends mail)
 *   3. `verifyEmailOtpCode` → verify cap + `verifyOtp`
 */
import { requestOtpSendPermit, OtpGateError } from "@/modules/auth/otpGate";
import { markOtpCooldown } from "@/modules/auth/otpCooldown";
import { getResponseLocale } from "@/modules/i18n";
import { requireSupabase } from "@/services/supabase";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(raw: string): boolean {
  return EMAIL_RX.test(raw.trim());
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export { OtpGateError } from "@/modules/auth/otpGate";
export { readOtpCooldownRemainingSec, markOtpCooldown } from "@/modules/auth/otpCooldown";

/** Запросить письмо с кодом. Бросает OtpGateError / Supabase-ошибку (UI мапит). */
export async function requestEmailOtpCode(email: string, displayName?: string): Promise<void> {
  const supabase = requireSupabase();
  const name = displayName?.trim();
  const normalized = normalizeEmail(email);
  const locale = getResponseLocale();

  await requestOtpSendPermit(normalized);

  // Side-channel для OTP-письма: signInWithOtp НЕ обновляет user_metadata
  // для существующего пользователя (только при создании).
  if (name) {
    await supabase
      .rpc("set_signin_name_hint", {
        p_email: normalized,
        p_name: name,
        p_locale: locale,
      })
      .then(({ error }) => {
        if (error) console.warn("set_signin_name_hint failed", error.message);
      });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: {
      shouldCreateUser: true,
      data: {
        ...(name ? { full_name: name } : {}),
        locale,
      },
    },
  });
  if (error) throw error;
  await markOtpCooldown(60);
}

/** Проверить код из письма. Успех = SDK установил сессию. */
export async function verifyEmailOtpCode(email: string, code: string): Promise<void> {
  const supabase = requireSupabase();
  const normalized = normalizeEmail(email);

  const { data: allowed, error: checkError } = await supabase.rpc(
    "otp_check_verify_allowed",
    { p_email: normalized },
  );
  if (checkError) {
    console.warn("otp_check_verify_allowed", checkError.message);
  } else if (allowed && typeof allowed === "object" && (allowed as { ok?: boolean }).ok === false) {
    const row = allowed as { code?: string; retry_after_seconds?: number };
    throw new OtpGateError(
      (row.code as "verify_limit") || "verify_limit",
      row.retry_after_seconds,
    );
  }

  const { error } = await supabase.auth.verifyOtp({
    email: normalized,
    token: code.trim(),
    type: "email",
  });
  if (error) {
    await supabase.rpc("otp_record_verify_failure", { p_email: normalized }).then(({ error: e }) => {
      if (e) console.warn("otp_record_verify_failure", e.message);
    });
    throw error;
  }

  const locale = getResponseLocale();
  await supabase.auth.updateUser({ data: { locale } }).then(({ error: metaError }) => {
    if (metaError) console.warn("updateUser locale after OTP failed", metaError.message);
  });
}
