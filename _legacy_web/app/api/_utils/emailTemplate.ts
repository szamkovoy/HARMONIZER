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
const BODY_FONT =
  "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

export type WrapEmailOptions = {
  bodyHtml: string;
  unsubscribeUrl: string;
  previewText?: string;
};

/**
 * Email clients ignore Tailwind and apply default `<p>` margins (~1em).
 * Normalize so:
 * - soft break (`<br>`) does not add block spacing;
 * - a blank paragraph (Enter on empty line) is exactly one empty line;
 * - consecutive non-empty paragraphs have no extra gap beyond line-height.
 */
export function normalizeEmailBodyHtml(html: string): string {
  if (!html.trim()) return html;

  let out = html;

  // Empty paragraphs → one blank line (email-safe spacer).
  out = out.replace(
    /<p(\s[^>]*)?>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*<\/p>/gi,
    '<p style="margin:0;padding:0;line-height:1.55;height:1.55em;font-size:inherit;">&nbsp;</p>',
  );

  // Force zero margin on block text tags (merge with existing style=).
  out = out.replace(
    /<(p|h1|h2|h3|h4|h5|h6|li|ul|ol)(\s[^>]*)?>/gi,
    (_full, tag: string, attrs = "") => {
      const attrStr = typeof attrs === "string" ? attrs : "";
      if (/height\s*:\s*1\.55em/i.test(attrStr)) {
        return `<${tag}${attrStr}>`;
      }
      const styleMatch = attrStr.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const withoutStyle = attrStr.replace(/\sstyle\s*=\s*"[^"]*"/i, "");
      const prev = styleMatch?.[1] ?? "";
      const cleaned = prev
        .replace(/margin\s*:[^;]*;?/gi, "")
        .replace(/padding\s*:[^;]*;?/gi, "")
        .replace(/;;+/g, ";")
        .trim()
        .replace(/^;|;$/g, "");
      const next = `margin:0;padding:0;${cleaned ? `${cleaned};` : ""}`;
      return `<${tag}${withoutStyle} style="${next}">`;
    },
  );

  return out;
}

export function wrapMarketingEmailHtml(opts: WrapEmailOptions): string {
  const preview = (opts.previewText ?? "").replace(/</g, "&lt;").slice(0, 140);
  const body = normalizeEmailBodyHtml(opts.bodyHtml.trim() || "<p style=\"margin:0;padding:0;\"></p>");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Гармонизатор</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:${BODY_FONT};color:#1a1a1a;">
  ${preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:${MARKETING_EMAIL_MAX_WIDTH_PX}px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px;font-size:16px;line-height:1.55;font-family:${BODY_FONT};">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #e8ebe9;font-family:${BODY_FONT};font-size:12.5px;line-height:1.5;color:#6b7280;text-align:center;">
              <p style="margin:0;padding:0;font-size:12.5px;line-height:1.5;">
                Вы получили это письмо, потому что регистрировались в учебном центре Сергея Замкового.
                Если вы не хотите получать мои письма, вы можете
                <a href="${opts.unsubscribeUrl}" style="color:${BRAND_COLOR};text-decoration:underline;">отписаться</a>.
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

/** Replace {{name}} / {{display_name}} in subject + HTML. Empty name drops leading comma/space. */
export function applyEmailPlaceholders(
  text: string,
  vars: { name?: string | null },
): string {
  const raw = (vars.name ?? "").trim();
  const name = raw || "";
  let out = text
    .replace(/\{\{\s*display_name\s*\}\}/gi, name)
    .replace(/\{\{\s*name\s*\}\}/gi, name);
  // "Здравствуйте, !" → "Здравствуйте!"
  out = out.replace(/,\s*!/g, "!");
  out = out.replace(/,\s*,/g, ",");
  out = out.replace(/\s{2,}/g, " ");
  return out;
}
