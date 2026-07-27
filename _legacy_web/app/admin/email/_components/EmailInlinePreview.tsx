"use client";

/**
 * Email preview as normal page flow (no brand header chrome).
 * Segment & send blocks sit directly under this content.
 */
export function EmailInlinePreview({
  subject,
  localeLabel,
  bodyHtml,
}: {
  subject: string;
  localeLabel: string;
  bodyHtml: string;
}) {
  const body =
    bodyHtml.trim() ||
    "<p style=\"color:#9ca3af;font-style:italic;margin:0\">Пустое письмо — нажмите «Редактировать»</p>";

  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-600">
        Тема ({localeLabel}):{" "}
        <span className="font-medium text-zinc-900">{subject.trim() || "—"}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div
          className="email-preview-body px-7 py-7 text-base leading-relaxed text-zinc-900 [&_a]:text-emerald-800 [&_img]:max-w-full [&_img]:h-auto"
          style={{
            fontFamily:
              "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
          }}
          dangerouslySetInnerHTML={{ __html: body }}
        />
        <div
          className="border-t border-zinc-200 px-7 py-5 text-xs leading-relaxed text-zinc-500"
          style={{
            fontFamily:
              "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
            textAlign: "center",
          }}
        >
          <p className="m-0">
            Вы получили это письмо, потому что регистрировались в учебном центре Сергея
            Замкового. Если вы не хотите получать мои письма, вы можете{" "}
            <span className="text-[#0f3d2e] underline">отписаться</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
