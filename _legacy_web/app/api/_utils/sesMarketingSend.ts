/**
 * Amazon SES send for marketing (Vercel). MessageId stored as resend_id on send rows.
 */
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type SesMarketingSendInput = {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
};

export type SesMarketingSendResult =
  | { ok: true; messageId: string }
  | { ok: false; detail: string };

function formatFromEmailAddress(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  if (!name) return fromEmail;
  if (/^[\x20-\x7E]+$/.test(name) && !/[<>"]/.test(name)) {
    return `${name} <${fromEmail}>`;
  }
  const b64 = Buffer.from(name, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?= <${fromEmail}>`;
}

export async function sendMarketingEmailViaSes(
  input: SesMarketingSendInput,
): Promise<SesMarketingSendResult> {
  const accessKeyId = process.env.SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.SES_SECRET_ACCESS_KEY?.trim();
  const region = (process.env.SES_REGION || "eu-west-1").trim();
  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      detail: "SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are required for AMAZON_* EMAIL_MARKETING",
    };
  }

  const client = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  const configSet = process.env.SES_CONFIGURATION_SET?.trim();

  try {
    const out = await client.send(
      new SendEmailCommand({
        FromEmailAddress: formatFromEmailAddress(input.fromName, input.fromEmail),
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: input.html, Charset: "UTF-8" },
              Text: { Data: input.text, Charset: "UTF-8" },
            },
            Headers: [
              { Name: "List-Unsubscribe", Value: `<${input.unsubscribeUrl}>` },
              { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
            ],
          },
        },
        ...(configSet ? { ConfigurationSetName: configSet } : {}),
      }),
    );
    const messageId = out.MessageId?.trim() ?? "";
    if (!messageId) {
      return { ok: false, detail: "SES response missing MessageId" };
    }
    return { ok: true, messageId };
  } catch (error: unknown) {
    const e = error as {
      name?: string;
      message?: string;
      Reason?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const detail = [
      e?.name,
      e?.message,
      e?.Reason,
      e?.$metadata?.httpStatusCode,
    ]
      .filter((x) => x != null && String(x).length > 0)
      .join(" | ");
    return { ok: false, detail: detail || String(error) };
  }
}
