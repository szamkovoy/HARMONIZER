import { readResendApiKey, resolveChannel } from "./channels.ts";
import { resolveOtpTransportProfile } from "./emailTransportProfile.ts";
import { sendViaResend } from "./providers/resend.ts";
import type { MailChannelId, MailProviderId, OutboundEmail, SendResult } from "./types.ts";

// SES provider is imported LAZILY (dynamic import) so the heavy
// `@aws-sdk/client-sesv2` module only loads when EMAIL_OTP=AMAZON_*.
// A static top-level import would force the AWS SDK to load on every
// cold start — even on the Resend path — and that multi-MB module tree
// exceeds the Supabase edge-runtime startup budget, hanging the
// GoTrue send-email hook (and thus signInWithOtp). See history.md.

/**
 * Active OTP transport from EMAIL_OTP (preferred) or legacy AUTH_EMAIL_PROVIDER.
 * Profiles: RESEND_ZAMKOVOI_* | AMAZON_ZAMKOVOI_* — see emailTransportProfile.ts
 */
export function resolveProvider(): MailProviderId {
  const profile = resolveOtpTransportProfile();
  return profile.provider === "amazon" ? "ses" : "resend";
}

export async function sendMail(
  channelId: MailChannelId,
  mail: Omit<OutboundEmail, "fromEmail"> & { fromEmail?: string },
): Promise<SendResult & { provider: MailProviderId; channel: MailChannelId }> {
  const channel = resolveChannel(channelId);
  const outbound: OutboundEmail = {
    ...mail,
    fromEmail: mail.fromEmail || channel.fromEmail,
  };
  const profile = resolveOtpTransportProfile();
  const provider: MailProviderId = profile.provider === "amazon" ? "ses" : "resend";

  if (provider === "ses") {
    // Lazy-load the SES provider (and its heavy @aws-sdk/client-sesv2)
    // only on the Amazon path; keeps the Resend cold start lightweight.
    const { sendViaSes } = await import("./providers/ses.ts");
    const result = await sendViaSes(outbound);
    return { ...result, provider, channel: channelId };
  }

  const apiKey = readResendApiKey(channel);
  if (!apiKey) {
    return {
      ok: false,
      detail: `Missing ${channel.resendApiKeyEnv} for channel ${channelId}`,
      provider,
      channel: channelId,
    };
  }
  const result = await sendViaResend(apiKey, outbound);
  return { ...result, provider, channel: channelId };
}
