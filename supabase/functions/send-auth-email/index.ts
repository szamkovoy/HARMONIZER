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
function renderEmail(
  tpl: {
    subject: string;
    greeting: string;
    greetingName?: string;
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
  userName: string,
  locale: string,
) {
  // Название приложения и кнопки «Что делать?» уже вшиты в текст каждого шаблона
  // (текст письма целиком на одном языке) — в рантайме подставляются только {code}
  // и {name} (если пользователь указал имя на шаге 1).
  const fillCode = (s: string) => s.replaceAll("{code}", code);
  const name = userName.trim();
  const greetingRaw =
    name && tpl.greetingName
      ? tpl.greetingName.replaceAll("{name}", name)
      : tpl.greeting;
  const greeting = fillCode(greetingRaw);
  const subject = fillCode(tpl.subject);
  const steps = [tpl.guide1, tpl.guide2, tpl.guide3, tpl.guide4, tpl.guide5].map(
    (g, i) => `${i + 1}. ${fillCode(g)}`,
  );
  const text = [
    greeting,
    "",
    fillCode(tpl.intro),
    code,
    "",
    fillCode(tpl.expiry),
    fillCode(tpl.ignore),
    "",
    fillCode(tpl.guideTitle),
    ...steps,
    "",
    fillCode(tpl.closing),
    signName,
  ].join("\n");

  // HTML с инлайн-CSS (почтовые клиенты вырезают <script>/<link>, поэтому
  // никаких внешних Tailwind/шрифтов — только системный font-stack).
  const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const PRIMARY = "#436558";
  const BORDER = "#7da192";
  const TEXT = "#161d1f";
  const itemHtml = steps
    .map((s, i) => {
      const mb = i < steps.length - 1 ? "8px" : "0";
      return `<p style="margin:0 0 ${mb} 0;padding:0">${escapeHtml(s)}</p>`;
    })
    .join("");
  const htmlParts = [
    `<!DOCTYPE html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`,
    `<body style="margin:0;padding:0;background:#ffffff">`,
    `<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:${FONT};color:${TEXT};font-size:16px;line-height:24px">`,
    `<p style="margin:0 0 24px 0">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 12px 0">${escapeHtml(fillCode(tpl.intro))}</p>`,
    `<p style="margin:0 0 24px 0;font-size:30px;font-weight:600;letter-spacing:0.25em;color:${PRIMARY}">${escapeHtml(code)}</p>`,
    `<p style="margin:0 0 24px 0">${escapeHtml(fillCode(tpl.expiry))}<br>${escapeHtml(fillCode(tpl.ignore))}</p>`,
    `<div style="border-left:3px solid ${BORDER};padding:4px 0 4px 20px;margin:0 0 24px 0">`,
    `<p style="margin:0 0 10px 0">${escapeHtml(fillCode(tpl.guideTitle))}</p>`,
    itemHtml,
    `</div>`,
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

  // Приоритет locale/имени: свежая подсказка со страницы входа (язык UI мастера
  // в момент OTP) → user_metadata (язык первой регистрации) → ru.
  // Без hint существующий пользователь получал письмо на языке signup-а,
  // хотя мастер уже был на другом (типично SecureStore ru vs metadata pt).
  const hint = await fetchSigninHint(String(to ?? ""));
  const locale = resolveLocale(hint.locale || user?.user_metadata?.locale);
  const tpl = resolveTemplate(locale);
  // Имя отправителя и подпись в теле: RU «Сергей Замковой», иначе «Sergei Zamkovoi»
  // (override: MAIL_FROM_NAME); non-ASCII → RFC 2047.
  const signName = SENDER_NAMES[locale] ?? DEFAULT_SENDER_NAME;
  const fromName = Deno.env.get("MAIL_FROM_NAME")?.trim() || signName;
  const metaName = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? "");
  const userName = hint.name || metaName;
  const rendered = renderEmail(tpl, String(code), signName, userName, locale);

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
