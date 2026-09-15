/**
 * Marketing email chrome: body + fixed unsubscribe footer (no brand header).
 * Preview in admin must use the same wrap so WYSIWYG ≈ inbox.
 * Keep this module free of Node-only deps (sharp) — admin client imports it.
 */

import {
  MARKETING_EMAIL_MAX_WIDTH_PX,
} from "./emailChrome";

export { MARKETING_EMAIL_MAX_WIDTH_PX } from "./emailChrome";

const BRAND_COLOR = "#0f3d2e";
/** Email-safe stack. `system-ui` is ignored by Yandex Mail app and falls back to a tiny default. */
export const MARKETING_EMAIL_BODY_FONT = "Arial,Helvetica,sans-serif";
const BODY_FONT = MARKETING_EMAIL_BODY_FONT;
const BODY_FONT_SIZE = "16px";
const BODY_LINE_HEIGHT = "24px";
const TEXT_SIZE_ADJUST =
  "-webkit-text-size-adjust:none;-ms-text-size-adjust:none;text-size-adjust:none;";
const WORD_BREAK = "word-break:break-word;overflow-wrap:anywhere;";

/** Paste this into a button/link href in the admin editor — send substitutes a personal URL. */
export const UNSUBSCRIBE_URL_PLACEHOLDER = "{{unsubscribe_url}}";

const UNSUBSCRIBE_LABEL_RE =
  /отпис|unsubscri|abmelden|abbestell|désabon|desabon|désinscri|desinscri|disiscriv|darse\s+de\s+baja|cancelar\s+suscrip|desuscri|descadastr|cancelar\s+inscri[cç]|uitschrijv|afmelden/i;

export type WrapEmailOptions = {
  bodyHtml: string;
  unsubscribeUrl: string;
  previewText?: string;
};

const HEADING_FONT_SIZE: Record<string, string> = {
  h1: "22px",
  h2: "22px",
  h3: "18px",
  h4: "16px",
  h5: "16px",
  h6: "16px",
};

/**
 * Email clients ignore Tailwind and apply default `<p>` margins (~1em).
 * Yandex Mail's mobile app also does **not** inherit `font-size` from a parent
 * `<td>`/`<div>` onto `<p>` — without an explicit px size the body looks tiny.
 */
export function normalizeEmailBodyHtml(
  html: string,
  fallback?: { fontSize?: string; fontFamily?: string },
): string {
  if (!html.trim()) return html;

  const fallbackSize = fallback?.fontSize ?? BODY_FONT_SIZE;
  const fallbackFamily = fallback?.fontFamily ?? BODY_FONT;

  let out = html;

  // Empty paragraphs → one blank line (email-safe spacer).
  out = out.replace(
    /<p(\s[^>]*)?>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*<\/p>/gi,
    `<p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:${fallbackSize} !important;font-family:${fallbackFamily};">&nbsp;</p>`,
  );

  // Force zero margin on block text tags (merge with existing style=).
  out = out.replace(
    /<(p|h1|h2|h3|h4|h5|h6|li|ul|ol)(\s[^>]*)?>/gi,
    (_full, tag: string, attrs = "") => {
      const tagName = String(tag).toLowerCase();
      const attrStr = typeof attrs === "string" ? attrs : "";
      if (/height\s*:\s*1\.55em/i.test(attrStr)) {
        return `<${tag}${attrStr}>`;
      }
      const styleMatch = attrStr.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const withoutStyle = attrStr.replace(/\sstyle\s*=\s*"[^"]*"/i, "");
      const prev = styleMatch?.[1] ?? "";
      let cleaned = prev
        .replace(/margin\s*:[^;]*;?/gi, "")
        .replace(/padding\s*:[^;]*;?/gi, "")
        .replace(/;;+/g, ";")
        .trim()
        .replace(/^;|;$/g, "");
      if (!/font-size\s*:/i.test(cleaned)) {
        const heading = /^h[1-6]$/.test(tagName);
        const size = heading
          ? (fallback?.fontSize ?? HEADING_FONT_SIZE[tagName] ?? BODY_FONT_SIZE)
          : fallbackSize;
        cleaned = `${cleaned ? `${cleaned};` : ""}font-size:${size} !important`;
      } else if (!/font-size\s*:[^;]*!important/i.test(cleaned)) {
        cleaned = cleaned.replace(
          /font-size\s*:\s*([^;]+)/i,
          "font-size:$1 !important",
        );
      }
      if (!/line-height\s*:/i.test(cleaned)) {
        cleaned = `${cleaned ? `${cleaned};` : ""}line-height:${BODY_LINE_HEIGHT}`;
      }
      if (
        !/font-family\s*:/i.test(cleaned) &&
        (tagName === "p" || tagName === "li" || /^h[1-6]$/.test(tagName))
      ) {
        cleaned = `${cleaned ? `${cleaned};` : ""}font-family:${fallbackFamily}`;
      }
      cleaned = cleaned.replace(/;;+/g, ";").replace(/^;|;$/g, "");
      const next = `margin:0;padding:0;${WORD_BREAK}${cleaned ? `${cleaned};` : ""}`;
      return `<${tag}${withoutStyle} style="${next}">`;
    },
  );

  return out;
}

function htmlFontSizeAttr(px: string): "3" | "4" | "5" {
  const n = Number.parseInt(px, 10);
  if (n >= 22) return "5";
  if (n >= 18) return "4";
  return "3";
}

/** Duplicate CSS px onto `<font>` inside the existing `<p>` — do not nest extra wrappers. */
export function wrapEmailTextWithFontTag(
  html: string,
  fallbackPx: string = BODY_FONT_SIZE,
): string {
  const fallback = fallbackPx.replace(/px$/i, "");
  return html.replace(
    /<(p|h1|h2|h3|h4|h5|h6|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string | undefined, inner: string) => {
      if (/<font\b/i.test(inner)) return full;
      const attrStr = attrs ?? "";
      const sizeMatch = attrStr.match(/font-size\s*:\s*(\d+)px/i);
      const px = sizeMatch?.[1] ?? fallback;
      return `<${tag}${attrStr}><font face="${BODY_FONT}" size="${htmlFontSizeAttr(`${px}px`)}" style="font-size:${px}px;line-height:${BODY_LINE_HEIGHT};font-family:${BODY_FONT};">${inner}</font></${tag}>`;
    },
  );
}

function escapeHref(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function hrefLooksLikeUnsubscribePlaceholder(href: string): boolean {
  const h = href.trim();
  if (!h) return false;
  if (/\{\{\s*unsubscribe(_url)?\s*\}\}/i.test(h)) return true;
  if (/\/unsubscribe(\/email)?(\?|$|\/)/i.test(h)) return true;
  if (/\/api\/unsubscribe(\?|$|\/)/i.test(h)) return true;
  return false;
}

function setAnchorHref(attrs: string, href: string): string {
  const escaped = escapeHref(href);
  if (/\bhref\s*=/i.test(attrs)) {
    return attrs.replace(
      /\bhref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
      `href="${escaped}"`,
    );
  }
  return ` href="${escaped}"${attrs}`;
}

/**
 * Personalize in-body unsubscribe controls:
 * `{{unsubscribe_url}}` / `{{unsubscribe}}`, and any `<a>` whose label is
 * «Отписаться» / Unsubscribe / … (so the admin button works without a special href).
 */
export function bindUnsubscribeLinks(html: string, unsubscribeUrl: string): string {
  if (!unsubscribeUrl) return html;
  let out = html
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubscribeUrl)
    .replace(/\{\{\s*unsubscribe\s*\}\}/gi, unsubscribeUrl);

  out = out.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi, (full, attrs: string, inner: string) => {
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = (hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? "").trim();
    const label = inner.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
    const byLabel = UNSUBSCRIBE_LABEL_RE.test(label);
    const byHref = hrefLooksLikeUnsubscribePlaceholder(href);
    if (!byLabel && !byHref) return full;
    if (href === unsubscribeUrl || href === escapeHref(unsubscribeUrl)) return full;
    return `<a${setAnchorHref(attrs, unsubscribeUrl)}>${inner}</a>`;
  });
  return out;
}

export function wrapMarketingEmailHtml(opts: WrapEmailOptions): string {
  const preview = (opts.previewText ?? "").replace(/</g, "&lt;").slice(0, 140);
  const body = wrapEmailTextWithFontTag(
    bindUnsubscribeLinks(
      normalizeEmailBodyHtml(opts.bodyHtml.trim() || "<p style=\"margin:0;padding:0;\"></p>"),
      opts.unsubscribeUrl,
    ),
  );
  const cellFont =
    `font-family:${BODY_FONT};font-size:${BODY_FONT_SIZE};line-height:${BODY_LINE_HEIGHT};${TEXT_SIZE_ADJUST}${WORD_BREAK}`;
  const preheader = preview
    ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;font-size:1px;line-height:1px;color:#f4f6f5;opacity:0;mso-hide:all;">${preview}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no" />
  <title>Гармонизатор</title>
  <style type="text/css">
    html,body{margin:0;padding:0;width:100%;${TEXT_SIZE_ADJUST}}
    body,table,td,p,a,li{${TEXT_SIZE_ADJUST}font-family:${BODY_FONT};${WORD_BREAK}}
    img{max-width:100%;height:auto;}
    a{word-break:break-all;}
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background:#f4f6f5;${cellFont}color:#1a1a1a;">
  ${preheader}
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;background:#f4f6f5;">
    <tr>
      <td align="center" style="padding:24px 12px;${cellFont}">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="width:100%;max-width:${MARKETING_EMAIL_MAX_WIDTH_PX}px;table-layout:fixed;background:#ffffff;border-radius:12px;">
          <tr>
            <td style="padding:28px;${cellFont}color:#1a1a1a;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #e8ebe9;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:#6b7280;text-align:center;${WORD_BREAK}">
              <p style="margin:0;padding:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:#6b7280;${WORD_BREAK}">
                Вы получили это письмо, потому что регистрировались в учебном центре Сергея Замкового.
                Если вы не хотите получать мои письма, вы можете
                <a href="${escapeHref(opts.unsubscribeUrl)}" style="color:${BRAND_COLOR};text-decoration:underline;font-size:14px;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;">отписаться</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Replace {{name}} / {{display_name}} / {{unsubscribe_url}} in subject + HTML. Empty name drops leading comma/space. */
export function applyEmailPlaceholders(
  text: string,
  vars: { name?: string | null; unsubscribeUrl?: string | null },
): string {
  const raw = (vars.name ?? "").trim();
  const name = raw || "";
  let out = text
    .replace(/\{\{\s*display_name\s*\}\}/gi, name)
    .replace(/\{\{\s*name\s*\}\}/gi, name);
  const unsub = (vars.unsubscribeUrl ?? "").trim();
  if (unsub) {
    out = bindUnsubscribeLinks(out, unsub);
  }
  // "Здравствуйте, !" → "Здравствуйте!"
  out = out.replace(/,\s*!/g, "!");
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\s{2,}/g, " ");
  return out;
}
