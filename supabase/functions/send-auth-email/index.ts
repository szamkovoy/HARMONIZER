import { SESv2Client, SendEmailCommand } from "npm:@aws-sdk/client-sesv2@3.787.0";
import { TEMPLATES, DEFAULT_LOCALE } from "./templates.ts";

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
function renderEmail(
  tpl: {
    subject: string;
    greeting: string;
    intro: string;
    expiry: string;
    ignore: string;
    guideTitle: string;
    guide1: string;
    guide2: string;
    guide3: string;
    guide4: string;
    guide5: string;
    closing: string;
  },
  code: string,
  signName: string,
) {
  // Название приложения и кнопки «Что делать?» уже вшиты в текст каждого шаблона
  // (текст письма целиком на одном языке) — в рантайме подставляется только {code}.
  const fill = (s: string) => s.replaceAll("{code}", code);
  const subject = fill(tpl.subject);
  const steps = [tpl.guide1, tpl.guide2, tpl.guide3, tpl.guide4, tpl.guide5].map(
    (g, i) => `${i + 1}. ${fill(g)}`,
  );
  const text = [
    fill(tpl.greeting),
    "",
    fill(tpl.intro),
    code,
    "",
    fill(tpl.expiry),
    fill(tpl.ignore),
    "",
    fill(tpl.guideTitle),
    ...steps,
    "",
    fill(tpl.closing),
    signName,
  ].join("\n");
  const html = [
    "<p>" + escapeHtml(fill(tpl.greeting)) + "</p>",
    "<p>" + escapeHtml(fill(tpl.intro)) + "</p>",
    '<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">' + escapeHtml(code) + "</p>",
    "<p>" + escapeHtml(fill(tpl.expiry)) + "<br>" + escapeHtml(fill(tpl.ignore)) + "</p>",
    "<p>" + escapeHtml(fill(tpl.guideTitle)) + "</p>",
    ...steps.map((s) => "<p>" + escapeHtml(s) + "</p>"),
    "<p>" + escapeHtml(fill(tpl.closing)) + "<br>" + escapeHtml(signName) + "</p>",
  ].join("\n");
  return { subject, text, html };
}
function hookError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** SES требует 7-bit ASCII в FromEmailAddress; non-ASCII display name — RFC 2047. */
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

Deno.serve(async (req) => {
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.trim();
  const accessKeyId = Deno.env.get("SES_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("SES_SECRET_ACCESS_KEY")?.trim();
  const region = (Deno.env.get("SES_REGION") || "eu-west-1").trim();
  const fromEmail = (Deno.env.get("MAIL_FROM_EMAIL") || "sergei@zamkovoi.yoga").trim();

  if (!hookSecret || !accessKeyId || !secretAccessKey) {
    return hookError("send-auth-email: SEND_EMAIL_HOOK_SECRET, SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY are required");
  }

  const payloadText = await req.text();
  let payload: any;
  try {
    const { Webhook } = await import("https://esm.sh/standardwebhooks@1.0.0");
    const wh = new Webhook(hookSecret.replace("v1,whsec_", ""));
    payload = wh.verify(payloadText, {
      "webhook-id": req.headers.get("webhook-id") || "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
      "webhook-signature": req.headers.get("webhook-signature") || "",
    });
  } catch (e) {
    return hookError("Invalid webhook signature", 401);
  }

  const user = payload?.user;
  const emailData = payload?.email_data;
  const to = user?.email;
  const code = emailData?.token;
  if (!to || !code) {
    return hookError("Missing user.email or email_data.token", 400);
  }

  const locale = resolveLocale(user?.user_metadata?.locale);
  const tpl = resolveTemplate(user?.user_metadata?.locale);
  // Имя отправителя и подпись в теле: RU «Сергей Замковой», иначе «Sergei Zamkovoi»
  // (override: MAIL_FROM_NAME); non-ASCII → RFC 2047.
  const signName = SENDER_NAMES[locale] ?? DEFAULT_SENDER_NAME;
  const fromName = Deno.env.get("MAIL_FROM_NAME")?.trim() || signName;
  const rendered = renderEmail(tpl, String(code), signName);

  const client = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const cmd = new SendEmailCommand({
      // Display name через RFC 2047; при сбое SES смотрите detail в логах хука.
      FromEmailAddress: formatFromEmailAddress(fromName, fromEmail),
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: rendered.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: rendered.html, Charset: "UTF-8" },
            Text: { Data: rendered.text, Charset: "UTF-8" },
          },
        },
      },
    });
    await client.send(cmd);
  } catch (error: any) {
    const detail = [
      error?.name,
      error?.message,
      error?.Reason,
      error?.$metadata?.httpStatusCode,
    ]
      .filter((x) => x != null && String(x).length > 0)
      .join(" | ");
    console.error("send-auth-email: SES send failed", detail, error);
    return hookError("SES send failed: " + (detail || String(error)));
  }

  return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
});
