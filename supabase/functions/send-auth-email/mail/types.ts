/** Shared contract for OTP / future marketing mail sends. */

export type MailChannelId = "auth_otp" | "marketing";

export type MailProviderId = "resend" | "ses";

export type OutboundEmail = {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { ok: true } | { ok: false; detail: string };

export type MailChannel = {
  id: MailChannelId;
  /** Human label for logs / docs. */
  purpose: string;
  fromEmail: string;
  /** Provider-specific credentials resolved for this channel only. */
  resendApiKeyEnv: string;
  /** Default From when env override is empty. */
  defaultFromEmail: string;
};
