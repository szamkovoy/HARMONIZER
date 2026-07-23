/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AMAZON SES TAIL — kept for easy switchback when SES leaves sandbox.
 *
 * Active provider is selected by AUTH_EMAIL_PROVIDER (default: resend).
 * To send OTP via SES again:
 *   npx supabase secrets set AUTH_EMAIL_PROVIDER=ses
 *   (keep SES_ACCESS_KEY_ID / SES_SECRET_ACCESS_KEY / SES_REGION set)
 *
 * To remove SES entirely later: delete this file, the "ses" branch in
 * send.ts, SES_* secrets, and the DNS records listed in
 * docs/04_workspace/email_providers.md § «SES DNS tails».
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { SESv2Client, SendEmailCommand } from "npm:@aws-sdk/client-sesv2@3.787.0";
import type { OutboundEmail, SendResult } from "../types.ts";

/** SES requires 7-bit ASCII in FromEmailAddress; non-ASCII → RFC 2047. */
function formatFromEmailAddress(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  if (/^[\x20-\x7E]+$/.test(name) && !/[<>"]/.test(name)) {
    return `${name} <${fromEmail}>`;
  }
  const bytes = new TextEncoder().encode(name);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?= <${fromEmail}>`;
}

export async function sendViaSes(mail: OutboundEmail): Promise<SendResult> {
  const accessKeyId = Deno.env.get("SES_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("SES_SECRET_ACCESS_KEY")?.trim();
  const region = (Deno.env.get("SES_REGION") || "eu-west-1").trim();
  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      detail: "SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are required when AUTH_EMAIL_PROVIDER=ses",
    };
  }

  const client = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: formatFromEmailAddress(mail.fromName, mail.fromEmail),
        Destination: { ToAddresses: [mail.to] },
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: mail.html, Charset: "UTF-8" },
              Text: { Data: mail.text, Charset: "UTF-8" },
            },
          },
        },
      }),
    );
    return { ok: true };
  } catch (error: any) {
    const detail = [
      error?.name,
      error?.message,
      error?.Reason,
      error?.$metadata?.httpStatusCode,
    ]
      .filter((x) => x != null && String(x).length > 0)
      .join(" | ");
    return { ok: false, detail: detail || String(error) };
  }
}
