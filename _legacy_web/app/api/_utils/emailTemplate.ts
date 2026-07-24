/**
 * Fixed brand chrome for marketing emails + editable body.
 */

const BRAND_COLOR = "#0f3d2e";
const ACCENT = "#34d399";

export type WrapEmailOptions = {
  bodyHtml: string;
  unsubscribeUrl: string;
  previewText?: string;
};

export function wrapMarketingEmailHtml(opts: WrapEmailOptions): string {
  const preview = (opts.previewText ?? "").replace(/</g, "&lt;").slice(0, 140);
  const body = opts.bodyHtml.trim() || "<p></p>";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Гармонизатор</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  ${preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:${BRAND_COLOR};padding:20px 28px;">
              <div style="font-size:20px;font-weight:700;letter-spacing:0.04em;color:#ffffff;">Гармонизатор</div>
              <div style="margin-top:4px;font-size:12px;color:${ACCENT};font-family:system-ui,sans-serif;">йога · психология · ИИ</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-size:16px;line-height:1.55;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #e8ebe9;font-family:system-ui,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;">
              <p style="margin:0 0 10px;">Вы получили это письмо, потому что подписаны на новости Гармонизатора.</p>
              <p style="margin:0 0 10px;">
                <a href="${opts.unsubscribeUrl}" style="color:${BRAND_COLOR};text-decoration:underline;">Отписаться от рассылки</a>
              </p>
              <p style="margin:0;color:#9ca3af;">© Гармонизатор · zamkovoi.ru</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
