import { SESv2Client, SendEmailCommand } from "npm:@aws-sdk/client-sesv2@3.787.0";
import { TEMPLATES, DEFAULT_LOCALE } from "./templates.ts";

/** Локализованное имя приложения — для имени отправителя (From). Должно совпадать
 *  с нативным именем под иконкой/в системных диалогах (см. plugins/appLocalesData.js). */
const APP_NAMES: Record<string, string> = {
  ru: "Гармонизатор",
  en: "Harmonizer",
  de: "Harmonisierer",
  fr: "Harmoniseur",
  it: "Armonizzatore",
  es: "Armonizador",
  pt: "Harmonizador",
  nl: "Harmoniseerder",
};

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
function renderEmail(tpl: { subject: string; greeting: string; intro: string; expiry: string; ignore: string; footer: string }, code: string) {
  const subject = tpl.subject.replace("{code}", code);
  const text = [tpl.greeting, "", tpl.intro + " " + code, "", tpl.expiry, tpl.ignore, "", tpl.footer].join("\n");
  const html = [
    "<p>" + escapeHtml(tpl.greeting) + "</p>",
    "<p>" + escapeHtml(tpl.intro) + "</p>",
    '<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">' + escapeHtml(code) + "</p>",
    "<p>" + escapeHtml(tpl.expiry) + "<br>" + escapeHtml(tpl.ignore) + "</p>",
    '<p style="color:#888;font-size:12px">' + escapeHtml(tpl.footer) + "</p>",
  ].join("\n");
  return { subject, text, html };
}
function hookError(message: string, status = 500) {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  const accessKeyId = Deno.env.get("SES_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("SES_SECRET_ACCESS_KEY");
  const region = Deno.env.get("SES_REGION") || "eu-west-1";
  const fromEmail = Deno.env.get("MAIL_FROM_EMAIL") || "sergei@zamkovoi.yoga";

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
  const rendered = renderEmail(tpl, String(code));
  // Имя отправителя — на языке письма (если не задан явный override через MAIL_FROM_NAME).
  const fromName = Deno.env.get("MAIL_FROM_NAME") || APP_NAMES[locale] || "Harmonizer";

  const client = new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const cmd = new SendEmailCommand({
      FromEmailAddress: `${fromName} <${fromEmail}>`,
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
  } catch (error) {
    console.error("send-auth-email: SES send failed", error);
    return hookError("SES send failed: " + (error?.message || String(error)));
  }

  return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
});
