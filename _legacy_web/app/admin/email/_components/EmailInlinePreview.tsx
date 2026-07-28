"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  MARKETING_EMAIL_MAX_WIDTH_PX,
  wrapMarketingEmailHtml,
} from "../../../api/_utils/emailTemplate";

/**
 * Preview uses the same HTML document as Resend send (wrap + normalize),
 * in an iframe so Tailwind preflight cannot change `<p>` margins / width.
 *
 * Height must shrink when switching to a shorter letter: measuring
 * document.scrollHeight while the iframe is still tall keeps the old size
 * (body expands to fill the frame). Collapse → measure content → set height.
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(200);

  const srcDoc = useMemo(() => {
    const body =
      bodyHtml.trim() ||
      '<p style="margin:0;padding:0;color:#9ca3af;font-style:italic;">Пустое письмо — нажмите «Редактировать»</p>';
    const html = wrapMarketingEmailHtml({
      bodyHtml: body,
      unsubscribeUrl: "#unsubscribe",
      previewText: subject.trim() || undefined,
    });
    // Keep document height = content (not 100% of a tall iframe).
    return html.replace(
      "</head>",
      "<style>html,body{height:auto!important;min-height:0!important;}</style></head>",
    );
  }, [bodyHtml, subject]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let cancelled = false;

    function measure() {
      if (cancelled) return;
      const el = iframeRef.current;
      if (!el) return;
      const doc = el.contentDocument;
      if (!doc?.body) return;

      // Collapse first — otherwise scrollHeight mirrors the previous tall frame.
      el.style.height = "1px";
      const rootTable = doc.body.querySelector("table");
      const contentH = rootTable
        ? Math.ceil(rootTable.getBoundingClientRect().height)
        : Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      const next = Math.max(contentH + 8, 120);
      el.style.height = `${next}px`;
      setFrameHeight(next);
    }

    function onLoad() {
      measure();
      const el = iframeRef.current;
      const doc = el?.contentDocument;
      if (!doc) return;
      doc.querySelectorAll("img").forEach((img) => {
        if (!img.complete) img.addEventListener("load", measure, { once: true });
      });
      // Second pass after layout/fonts.
      requestAnimationFrame(() => requestAnimationFrame(measure));
    }

    setFrameHeight(120);
    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") onLoad();
    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
    };
  }, [srcDoc]);

  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-600">
        Тема ({localeLabel}):{" "}
        <span className="font-medium text-zinc-900">{subject.trim() || "—"}</span>
      </div>

      <div
        className="overflow-hidden rounded-xl border border-zinc-200 bg-[#f4f6f5]"
        style={{ maxWidth: MARKETING_EMAIL_MAX_WIDTH_PX + 48 }}
      >
        <iframe
          ref={iframeRef}
          title="Превью письма"
          srcDoc={srcDoc}
          className="block w-full border-0 bg-[#f4f6f5]"
          style={{ height: frameHeight, maxWidth: "100%" }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
