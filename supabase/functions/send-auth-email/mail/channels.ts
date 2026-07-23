/**
 * Mail channels keep transactional OTP and future marketing on separate
 * domains / API keys so reputation never cross-contaminates.
 *
 * - auth_otp  → zamkovoi.yoga  (RESEND_ZAMKOVOI_YOGA_API_KEY)
 * - marketing → zamkovoi.ru    (RESEND_ZAMKOVOI_RU_API_KEY) — not used by this hook yet
 */
import type { MailChannel, MailChannelId } from "./types.ts";

const CHANNELS: Record<MailChannelId, MailChannel> = {
  auth_otp: {
    id: "auth_otp",
    purpose: "Transactional sign-in OTP (Supabase Send Email Hook)",
    fromEmail: "", // filled by resolveChannel
    resendApiKeyEnv: "RESEND_ZAMKOVOI_YOGA_API_KEY",
    defaultFromEmail: "sergei@zamkovoi.yoga",
  },
  marketing: {
    id: "marketing",
    purpose: "Future admin marketing / broadcast (zamkovoi.ru) — separate key",
    fromEmail: "",
    resendApiKeyEnv: "RESEND_ZAMKOVOI_RU_API_KEY",
    defaultFromEmail: "sergei@zamkovoi.ru",
  },
};

/** Resolve From + which Resend key env name to use for a logical channel. */
export function resolveChannel(id: MailChannelId): MailChannel {
  const base = CHANNELS[id];
  const fromOverride =
    id === "auth_otp"
      ? Deno.env.get("MAIL_FROM_EMAIL")?.trim()
      : Deno.env.get("MAIL_MARKETING_FROM_EMAIL")?.trim();
  return {
    ...base,
    fromEmail: fromOverride || base.defaultFromEmail,
  };
}

export function readResendApiKey(channel: MailChannel): string {
  return (Deno.env.get(channel.resendApiKeyEnv) ?? "").trim();
}
