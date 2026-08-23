/**
 * Amazon SES send for OTP (edge) — lightweight raw HTTP + AWS SigV4.
 *
 * Replaces the heavy `@aws-sdk/client-sesv2` SDK, whose multi-MB module tree
 * exceeded the Supabase edge-runtime cold-start budget and hung the GoTrue
 * send-email hook (and thus signInWithOtp). Raw HTTP keeps the cold start
 * lightweight and adds a hard timeout so a stalled connection can never hang.
 *
 * Secrets: SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION,
 * optional SES_OTP_CONFIGURATION_SET (never SES_CONFIGURATION_SET / marketing).
 *
 * Endpoint: POST https://email.<region>.amazonaws.com/v2/email/outbound-emails
 * Content-Type: application/json, signed with AWS Signature Version 4
 * (service "ses"). The IAM access key + secret are used directly (no SMTP
 * password derivation) — same auth path the AWS SDK used.
 */
import type { OutboundEmail, SendResult } from "../types.ts";

/** SES requires 7-bit ASCII in From; non-ASCII → RFC 2047 (=?UTF-8?B?...?=). */
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

// --- Web Crypto helpers ---

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function utcNow(): { long: string; short: string } {
  // long: 20260823T174500Z  short: 20260823
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  const long = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(
    d.getUTCDate(),
  )}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const short = long.slice(0, 8);
  return { long, short };
}

/**
 * AWS Signature Version 4 — sign a request to SES v2.
 * Returns the Authorization header value.
 */
async function signSigV4(opts: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;
  dateShort: string;
  payloadHash: string;
}): Promise<string> {
  const signedHeaders = "content-type;host;x-amz-date";
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${opts.host}\n` +
    `x-amz-date:${opts.amzDate}\n`;

  const canonicalRequest = [
    opts.method,
    opts.path,
    "", // empty query string
    canonicalHeaders,
    signedHeaders,
    opts.payloadHash,
  ].join("\n");

  const scope = `${opts.dateShort}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    opts.amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const enc = new TextEncoder();
  let k = await hmacSha256(enc.encode("AWS4" + opts.secretAccessKey), opts.dateShort);
  k = await hmacSha256(k, opts.region);
  k = await hmacSha256(k, opts.service);
  k = await hmacSha256(k, "aws4_request");
  const signature = toHex(await hmacSha256(k, stringToSign));

  return (
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

export async function sendViaSes(mail: OutboundEmail): Promise<SendResult> {
  const accessKeyId = Deno.env.get("SES_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("SES_SECRET_ACCESS_KEY")?.trim();
  const region = (Deno.env.get("SES_REGION") || "eu-west-1").trim();
  if (!accessKeyId || !secretAccessKey) {
    return {
      ok: false,
      detail:
        "SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are required for AMAZON_* email profiles",
    };
  }

  const configSet = Deno.env.get("SES_OTP_CONFIGURATION_SET")?.trim();
  const extraHeaders = Object.entries(mail.headers ?? {}).map(([Name, Value]) => ({
    Name,
    Value,
  }));

  const body = JSON.stringify({
    FromEmailAddress: formatFromEmailAddress(mail.fromName, mail.fromEmail),
    Destination: { ToAddresses: [mail.to] },
    Content: {
      Simple: {
        Subject: { Data: mail.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: mail.html, Charset: "UTF-8" },
          Text: { Data: mail.text, Charset: "UTF-8" },
        },
        ...(extraHeaders.length ? { Headers: extraHeaders } : {}),
      },
    },
    ...(configSet ? { ConfigurationSetName: configSet } : {}),
  });

  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const { long: amzDate, short: dateShort } = utcNow();
  const payloadHash = await sha256Hex(body);
  const authorization = await signSigV4({
    method: "POST",
    host,
    path,
    region,
    service: "ses",
    accessKeyId,
    secretAccessKey,
    amzDate,
    dateShort,
    payloadHash,
  });

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: host,
        "X-Amz-Date": amzDate,
        Authorization: authorization,
        "X-Amz-Content-Sha256": payloadHash,
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        detail: `SES HTTP ${res.status}${text ? `: ${text.slice(0, 400)}` : ""}`,
      };
    }
    // SES v2 returns { MessageId } on success
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: String(data?.MessageId ?? "").trim() || undefined };
  } catch (e) {
    return {
      ok: false,
      detail: `SES fetch failed: ${e instanceof Error ? e.name : String(e)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
