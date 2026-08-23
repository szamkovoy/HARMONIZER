import { TEMPLATES, DEFAULT_LOCALE } from "./templates.ts";
import { sendMail } from "./mail/send.ts";

/** Имя отправителя (From) и подписи в теле письма: RU — «Сергей Замковой»,
 *  во всех остальных локализациях — «Sergei Zamkovoi». */
const SENDER_NAMES: Record<string, string> = {
  ru: "Сергей Замковой",
};
const DEFAULT_SENDER_NAME = "Sergei Zamkovoi";

function resolveLocale(localeRaw: string | undefined): string {
  const locale = String(localeRaw ?? "").toLowerCase().slice(0, 2);
  return TEMPLATES[locale] ? locale : DEFAULT_LOCALE;
}
function resolveTemplate(localeRaw: string | undefined) {
  return TEMPLATES[resolveLocale(localeRaw)];
}
function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

type SigninHint = { name: string; locale: string };

/** Свежие имя + locale со страницы входа (signin_name_hints). Service-role,
 *  обходит RLS. Пустые поля → fallback на user_metadata. */
async function fetchSigninHint(email: string): Promise<SigninHint> {
  const empty: SigninHint = { name: "", locale: "" };
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !email) return empty;
  try {
    const url = `${supabaseUrl}/rest/v1/signin_name_hints?email=eq.${encodeURIComponent(email.toLowerCase())}&select=name,locale&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return empty;
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return empty;
    return {
      name: row.name ? String(row.name).trim() : "",
      locale: row.locale ? String(row.locale).trim() : "",
    };
  } catch {
    return empty;
  }
}

type OtpGateResult = { ok: boolean; code: string; retry_after_seconds?: number };

/** Consume App Check permit + enforce send rate limits before mailing. */
async function consumeOtpSendPermit(
  email: string,
  requirePermit: boolean,
): Promise<OtpGateResult> {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, code: "server_misconfigured" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/otp_consume_send_permit`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        p_email: email.toLowerCase(),
        p_require_permit: requirePermit,
      }),
    });
    if (!res.ok) {
      console.error("otp_consume_send_permit http", res.status, await res.text());
      return { ok: false, code: "gate_error" };
    }
    const data = (await res.json()) as OtpGateResult;
    return {
      ok: Boolean(data?.ok),
      code: String(data?.code ?? "denied"),
      retry_after_seconds: data?.retry_after_seconds,
    };
  } catch (e) {
    console.error("otp_consume_send_permit", e);
    return { ok: false, code: "gate_error" };
  }
}
function renderEmail(
  tpl: {
    subject: string;
    greeting: string;
    greetingName?: string;
    intro: string;
    expiry: string;
    ignore: string;
    closing: string;
  },
  code: string,
  signName: string,
  userName: string,
  locale: string,
) {
  // Short transactional OTP only — no guide/marketing block (inbox clients
  // treat long “newsletter-like” bodies as list mail even without List-Unsubscribe).
  // Runtime placeholders: {code}, optional {name}.
  const fillCode = (s: string) => s.replaceAll("{code}", code);
  const name = userName.trim();
  const greetingRaw =
    name && tpl.greetingName
      ? tpl.greetingName.replaceAll("{name}", name)
      : tpl.greeting;
  const greeting = fillCode(greetingRaw);
  const subject = fillCode(tpl.subject);
  const text = [
    greeting,
    "",
    fillCode(tpl.intro),
    code,
    "",
    fillCode(tpl.expiry),
    fillCode(tpl.ignore),
    "",
    fillCode(tpl.closing),
    signName,
  ].join("\n");

  // HTML с инлайн-CSS (почтовые клиенты вырезают <script>/<link>, поэтому
  // никаких внешних Tailwind/шрифтов — только системный font-stack).
  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const PRIMARY = "#436558";
  const TEXT = "#161d1f";
  const htmlParts = [
    `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
    `<body style="margin:0;padding:0;background:#ffffff">`,
    `<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:${FONT};color:${TEXT};font-size:16px;line-height:24px">`,
    `<p style="margin:0 0 24px 0">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 12px 0">${escapeHtml(fillCode(tpl.intro))}</p>`,
    `<p style="margin:0 0 24px 0;font-size:30px;font-weight:600;letter-spacing:0.25em;color:${PRIMARY}">${escapeHtml(code)}</p>`,
    `<p style="margin:0 0 24px 0">${escapeHtml(fillCode(tpl.expiry))}<br>${escapeHtml(fillCode(tpl.ignore))}</p>`,
    `<p style="margin:0">${escapeHtml(fillCode(tpl.closing))}<br>${escapeHtml(signName)}</p>`,
    `</div>`,
    `</body></html>`,
  ];
  const html = htmlParts.join("\n");
  return { subject, text, html };
}
function hookError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Standard Webhooks verify (inline, no external import) ---
// Replaces `https://esm.sh/standardwebhooks@1.0.0`: that remote dynamic
// import could hang on a cold edge isolate (the one GoTrue hits), which
// hung signInWithOtp indefinitely. Inlining keeps the cold start local-only.
// Mirrors the official JS library exactly: base64-decoded secret key,
// HMAC-SHA256 over `${id}.${timestamp}.${body}`, comma-split signatures.
// Protocol: https://github.com/standard-webhooks/standard-webhooks
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
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

function timingEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verify a Standard Webhook request. Returns the parsed JSON payload or throws. */
async function verifyWebhook(
  rawBody: string,
  headers: Headers,
  secretRaw: string,
): Promise<unknown> {
  // SEND_EMAIL_HOOK_SECRET is stored as `v1,whsec_<base64>`; the webhook
  // key is the base64-decoded bytes of `<base64>` (after stripping both prefixes).
  const secretB64 = secretRaw.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const key = base64ToBytes(secretB64);

  const id = headers.get("webhook-id") || "";
  const tsStr = headers.get("webhook-timestamp") || "";
  const sigHeader = headers.get("webhook-signature") || "";
  if (!id || !tsStr || !sigHeader) throw new Error("missing webhook headers");

  const ts = parseInt(tsStr, 10);
  if (!Number.isFinite(ts)) throw new Error("invalid webhook-timestamp");
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - ts > WEBHOOK_TOLERANCE_SECONDS) throw new Error("timestamp too old");
  if (ts > nowSec + WEBHOOK_TOLERANCE_SECONDS) throw new Error("timestamp too new");

  const toSign = `${id}.${ts}.${rawBody}`;
  const expected = bytesToBase64(await hmacSha256(key, toSign));

  const encoder = new TextEncoder();
  for (const versionedSignature of sigHeader.split(" ")) {
    const [version, signature] = versionedSignature.split(",");
    if (version !== "v1") continue;
    if (timingEqual(encoder.encode(signature), encoder.encode(expected))) {
      return rawBody === "" ? undefined : JSON.parse(rawBody);
    }
  }
  throw new Error("invalid webhook signature");
}

Deno.serve(async (req) => {
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.trim();
  if (!hookSecret) {
    return hookError("send-auth-email: SEND_EMAIL_HOOK_SECRET is required");
  }

  const payloadText = await req.text();
  let payload: any;
  try {
    payload = await verifyWebhook(payloadText, req.headers, hookSecret);
  } catch (_e) {
    return hookError("Invalid webhook signature", 401);
  }

  const user = payload?.user;
  const emailData = payload?.email_data;
  const to = user?.email;
  const code = emailData?.token;
  if (!to || !code) {
    return hookError("Missing user.email or email_data.token", 400);
  }

  // Rate limits + App Check permit (issued by POST /api/auth/otp-gate).
  // OTP_REQUIRE_APP_CHECK=false → limits only (emergency / staged rollout).
  // Default false until store clients call otp-gate; then set secret to true.
  const requirePermit =
    (Deno.env.get("OTP_REQUIRE_APP_CHECK") ?? "false").trim().toLowerCase() ===
    "true";
  const gate = await consumeOtpSendPermit(String(to), requirePermit);
  if (!gate.ok) {
    console.warn("send-auth-email: gate denied", gate.code, String(to));
    // 429 so GoTrue surfaces a retryable rate-limit style error to the client.
    return hookError(`otp_gate:${gate.code}`, 429);
  }

  // App Store / Play review demo: gate + rate limits still apply; no mailbox.
  // Client verifies via POST /api/auth/otp-verify + STORE_REVIEW_OTP.
  const reviewEmail = (Deno.env.get("STORE_REVIEW_EMAIL") ?? "").trim().toLowerCase();
  if (reviewEmail && String(to).toLowerCase() === reviewEmail) {
    console.log("send-auth-email: skip send for store review account");
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Приоритет locale/имени: свежая подсказка со страницы входа (язык UI мастера
  // в момент OTP) → user_metadata (язык первой регистрации) → ru.
  const hint = await fetchSigninHint(String(to ?? ""));
  const locale = resolveLocale(hint.locale || user?.user_metadata?.locale);
  const tpl = resolveTemplate(locale);
  // Имя отправителя и подписи в теле: RU «Сергей Замковой», иначе «Sergei Zamkovoi»
  // (override: MAIL_FROM_NAME); non-ASCII → handled per provider.
  const signName = SENDER_NAMES[locale] ?? DEFAULT_SENDER_NAME;
  const fromName = Deno.env.get("MAIL_FROM_NAME")?.trim() || signName;
  const metaName = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "");
  const userName = hint.name || metaName;
  const rendered = renderEmail(tpl, String(code), signName, userName, locale);

  // Channel auth_otp → zamkovoi.yoga key only. Marketing (zamkovoi.ru) never
  // shares this path — see mail/channels.ts + docs/04_workspace/email_providers.md.
  const sent = await sendMail("auth_otp", {
    fromName,
    to: String(to),
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    // Transactional signal; never List-Unsubscribe on OTP.
    headers: { "Auto-Submitted": "auto-generated" },
  });

  if (!sent.ok) {
    console.error(
      "send-auth-email: send failed",
      sent.provider,
      sent.channel,
      sent.detail,
    );
    return hookError(`${sent.provider} send failed: ${sent.detail}`);
  }

  return new Response(JSON.stringify({}), {
    headers: { "Content-Type": "application/json" },
  });
});
