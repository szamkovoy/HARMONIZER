"use client";

/**
 * Email preview as normal page flow (no iframe / fixed-height box).
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
        <div className="bg-[#0f3d2e] px-7 py-5">
          <div className="text-xl font-bold tracking-wide text-white">Гармонизатор</div>
          <div className="mt-1 font-sans text-xs text-emerald-300">йога · психология · ИИ</div>
        </div>
        <div
          className="email-preview-body px-7 py-7 text-base leading-relaxed text-zinc-900 [&_a]:text-emerald-800 [&_img]:max-w-full [&_img]:h-auto"
          dangerouslySetInnerHTML={{ __html: body }}
        />
        <div className="border-t border-zinc-200 px-7 py-5 font-sans text-xs leading-relaxed text-zinc-500">
          <p className="m-0 mb-2.5">
            Вы получили это письмо, потому что подписаны на новости Гармонизатора.
          </p>
          <p className="m-0 mb-2.5">
            <span className="text-[#0f3d2e] underline">Отписаться от рассылки</span>
          </p>
          <p className="m-0 text-zinc-400">© Гармонизатор · zamkovoi.ru</p>
        </div>
      </div>
    </div>
  );
}
