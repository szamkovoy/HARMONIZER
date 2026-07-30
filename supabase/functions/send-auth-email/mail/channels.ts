/**
 * Mail channels keep transactional OTP and marketing on separate
 * domains / API keys so reputation never cross-contaminates.
 *
 * OTP From / Resend key follow EMAIL_OTP profile (see emailTransportProfile.ts).
 */
import { resolveOtpTransportProfile } from "./emailTransportProfile.ts";
import type { MailChannel, MailChannelId } from "./types.ts";

/** Resolve From + which Resend key env name to use for a logical channel. */
export function resolveChannel(id: MailChannelId): MailChannel {
  if (id === "auth_otp") {
    const profile = resolveOtpTransportProfile();
    const fromOverride = Deno.env.get("MAIL_FROM_EMAIL")?.trim();
    return {
      id: "auth_otp",
      purpose: "Transactional sign-in OTP (Supabase Send Email Hook)",
      fromEmail: fromOverride || profile.defaultFromEmail,
      resendApiKeyEnv: profile.resendApiKeyEnv ?? "RESEND_ZAMKOVOI_YOGA_API_KEY",
      defaultFromEmail: profile.defaultFromEmail,
    };
  }

  const fromOverride = Deno.env.get("MAIL_MARKETING_FROM_EMAIL")?.trim();
  return {
    id: "marketing",
    purpose: "Admin marketing (edge stub — real path is Vercel marketingMail)",
    fromEmail: fromOverride || "sergei@zamkovoi.ru",
    resendApiKeyEnv: "RESEND_ZAMKOVOI_RU_API_KEY",
    defaultFromEmail: "sergei@zamkovoi.ru",
  };
}

export function readResendApiKey(channel: MailChannel): string {
  return (Deno.env.get(channel.resendApiKeyEnv) ?? "").trim();
}
