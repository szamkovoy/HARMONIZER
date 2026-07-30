import { readResendApiKey, resolveChannel } from "./channels.ts";
import { resolveOtpTransportProfile } from "./emailTransportProfile.ts";
import { sendViaResend } from "./providers/resend.ts";
import { sendViaSes } from "./providers/ses.ts";
import type { MailChannelId, MailProviderId, OutboundEmail, SendResult } from "./types.ts";

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
