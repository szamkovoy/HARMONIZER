/**
 * Email-OTP вход (единственный способ авторизации в приложении).
 *
 * Поток:
 *   1. `requestOtpSendPermit` → App Check + rate limits → single-use permit
 *   2. `set_signin_name_hint` + `signInWithOtp` → GoTrue → send-auth-email
 *      (consumes permit; for STORE_REVIEW_EMAIL skips mailbox)
 *   3. `verifyEmailOtpCode` → verify cap → POST /api/auth/otp-verify
 *      (store-review mint) or GoTrue `verifyOtp`
 */
import { requestOtpSendPermit, OtpGateError } from "@/modules/auth/otpGate";
import { markOtpCooldown } from "@/modules/auth/otpCooldown";
import { getResponseLocale } from "@/modules/i18n";
import { requireSupabase } from "@/services/supabase";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * GoTrue often answers `/otp` in under a second, after the hook has already
 * sent the letter. On Android the okhttp promise can stay pending anyway
 * (2026-11-09: HTTP 200, content-length 2, UI stuck on «Отправляется…»).
 * Past this budget we open the code screen — the letter may already be in
 * the inbox, and a fast API error still arrives before the budget.
 */
export const OTP_SEND_RESPONSE_BUDGET_MS = 10_000;
/** A hung name hint must not block the send (same contract as a hint error). */
export const SIGNIN_HINT_BUDGET_MS = 4_000;

export type RequestEmailOtpOptions = {
  responseBudgetMs?: number;
  hintBudgetMs?: number;
};

/** Resolves with the value, or `"timeout"` if `promise` is still pending. Late rejection is swallowed. */
export function raceBudget<T>(promise: Promise<T>, budgetMs: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });
  void promise.catch(() => undefined);
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** True when our own `/auth/v1/otp` abort fired, not a fast offline failure. */
export function isOtpClientAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  if (name === "AbortError") return true;
  const message = error instanceof Error ? error.message : "";
  return /abort/i.test(message);
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RX.test(raw.trim());
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export { OtpGateError } from "@/modules/auth/otpGate";
export { readOtpCooldownRemainingSec, markOtpCooldown } from "@/modules/auth/otpCooldown";

function apiOrigin(): string {
  const raw =
    process.env.EXPO_PUBLIC_COMMUNICATOR_API_URL?.trim() ||
    process.env.EXPO_PUBLIC_APP_URL?.trim() ||
    "";
  return raw.replace(/\/$/, "");
}

type OtpVerifyResponse = {
  mode?: "not_review" | "review";
  ok?: boolean;
  code?: string;
  retry_after_seconds?: number;
  access_token?: string;
  refresh_token?: string;
};

/**
 * Ask Vercel whether this is the store-review allowlist.
 * - `ok` — session already set via setSession
 * - `not_review` — fall through to GoTrue verifyOtp
 * - throws OtpGateError / Error on review invalid OTP / limits
 */
async function tryStoreReviewVerify(email: string, code: string): Promise<"ok" | "not_review"> {
  const origin = apiOrigin();
  if (!origin) return "not_review";

  let res: Response;
  try {
    res = await fetch(`${origin}/api/auth/otp-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, code }),
    });
  } catch {
    // Network blip — do not block normal verifyOtp for real users.
    return "not_review";
  }

  let data: OtpVerifyResponse = {};
  try {
    data = (await res.json()) as OtpVerifyResponse;
  } catch {
    data = {};
  }

  if (data.mode === "not_review" || (!data.mode && res.ok && !data.access_token)) {
    return "not_review";
  }

  if (data.mode === "review" && res.ok && data.ok && data.access_token && data.refresh_token) {
    const supabase = requireSupabase();
    const { error } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (error) throw error;
    return "ok";
  }

  if (data.mode === "review" && (res.status === 401 || data.code === "invalid_otp")) {
    const err = new Error("Token has expired or is invalid") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  if (data.code === "verify_limit" || res.status === 429) {
    throw new OtpGateError("verify_limit", data.retry_after_seconds);
  }

  if (data.mode === "review") {
    throw new OtpGateError("server_error");
  }

  return "not_review";
}

/** Запросить письмо с кодом. Бросает OtpGateError / Supabase-ошибку (UI мапит). */
export async function requestEmailOtpCode(
  email: string,
  displayName?: string,
  options?: RequestEmailOtpOptions,
): Promise<void> {
  const supabase = requireSupabase();
  const name = displayName?.trim();
  const normalized = normalizeEmail(email);
  const locale = getResponseLocale();
  const responseBudgetMs = options?.responseBudgetMs ?? OTP_SEND_RESPONSE_BUDGET_MS;
  const hintBudgetMs = options?.hintBudgetMs ?? SIGNIN_HINT_BUDGET_MS;

  await requestOtpSendPermit(normalized);

  // Side-channel для OTP-письма: signInWithOtp НЕ обновляет user_metadata
  // для существующего пользователя (только при создании).
  // Hint is a side channel for the letter. A rejection here used to cancel
  // signInWithOtp after the permit was already issued, so no mail was sent.
  // A hang is the same class of failure: wait a short budget, then send anyway.
  if (name) {
    const hint = supabase
      .rpc("set_signin_name_hint", {
        p_email: normalized,
        p_name: name,
        p_locale: locale,
      })
      .then(({ error }) => {
        if (error) console.warn("set_signin_name_hint failed", error.message);
      });
    try {
      const hinted = await raceBudget(hint, hintBudgetMs);
      if (hinted === "timeout") console.warn("set_signin_name_hint timed out");
    } catch (e) {
      console.warn("set_signin_name_hint failed", e);
    }
  }

  const pending = supabase.auth.signInWithOtp({
    email: normalized,
    options: {
      shouldCreateUser: true,
      data: {
        ...(name ? { full_name: name } : {}),
        locale,
      },
    },
  });
  let outcome: Awaited<typeof pending> | "timeout";
  try {
    outcome = await raceBudget(pending, responseBudgetMs);
  } catch (e) {
    // Fetch abort (services/supabase.ts) after the letter may already be out.
    if (!isOtpClientAbort(e)) throw e;
    console.warn("signInWithOtp aborted after response budget; opening code entry");
    outcome = "timeout";
  }
  if (outcome === "timeout") {
    console.warn("signInWithOtp: no response within budget; opening code entry");
  } else if (outcome.error) {
    throw outcome.error;
  }
  // SecureStore write is UX-only. Awaiting it kept the wizard on «Отправляется…»
  // after GoTrue had already returned 200 and the letter was delivered.
  void markOtpCooldown(60);
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

  const review = await tryStoreReviewVerify(normalized, code.trim());
  if (review === "ok") {
    const locale = getResponseLocale();
    await supabase.auth.updateUser({ data: { locale } }).then(({ error: metaError }) => {
      if (metaError) console.warn("updateUser locale after OTP failed", metaError.message);
    });
    return;
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
