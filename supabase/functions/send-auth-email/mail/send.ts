import { readResendApiKey, resolveChannel } from "./channels.ts";
import { sendViaResend } from "./providers/resend.ts";
import { sendViaSes } from "./providers/ses.ts";
import type { MailChannelId, MailProviderId, OutboundEmail, SendResult } from "./types.ts";

/**
 * Active transport for all channels.
 * - resend (default) — production while SES is in sandbox
 * - ses — AMAZON SES TAIL; flip AUTH_EMAIL_PROVIDER=ses to switch back
 */
export function resolveProvider(): MailProviderId {
  const raw = (Deno.env.get("AUTH_EMAIL_PROVIDER") ?? "resend").trim().toLowerCase();
  if (raw === "ses" || raw === "amazon" || raw === "amazon_ses") return "ses";
  return "resend";
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
  const provider = resolveProvider();

  if (provider === "ses") {
    // AMAZON SES TAIL path — same From address as Resend OTP channel.
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
