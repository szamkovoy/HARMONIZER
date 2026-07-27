"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Pencil, Send } from "lucide-react";

import {
  ALL_CONTENT_LOCALES,
  LOCALE_LABELS,
  type ContentLocale,
} from "../_lib/emailLocales";
import {
  blocksForLocale,
  blocksToHtml,
  ensureBlocksFromHtml,
  localeHasEmailCopy,
  type BlocksByLocale,
  type EmailBlock,
} from "../_lib/blocks";
import { EmailBlockEditor } from "./EmailBlockEditor";
import { EmailInlinePreview } from "./EmailInlinePreview";

const inputCls =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

export type EmailMessageContent = {
  subject: string;
  subjectI18n: Record<string, string>;
  htmlBody: string;
  htmlI18n: Record<string, string>;
  blocksI18n: BlocksByLocale;
};

type Props = {
  readOnly?: boolean;
  content: EmailMessageContent;
  onSaveLocaleContent: (
    locale: ContentLocale,
    nextSubject: string,
    nextBlocks: EmailBlock[],
  ) => Promise<void>;
  onTranslateEmpty: () => Promise<void>;
  translating?: boolean;
  /** Test send */
  testTo: string;
  onTestToChange: (value: string) => void;
  onSendTest: () => Promise<void>;
  sending?: boolean;
  /** Hide entire send section (e.g. campaign already sent). */
  showSendBlock?: boolean;
  /** Extra controls next to Test (e.g. «Отправить сегменту»). */
  sendExtra?: ReactNode;
  /** Optional form submit for bulk send. */
  onBulkSend?: (e: FormEvent) => void;
  /** Campaign segment (or step delay) between preview and send. */
  afterPreview?: ReactNode;
};

/**
 * Shared message UI: locale tabs, preview, block editor, test send.
 * Used by campaign detail and automation step detail.
 */
export function EmailMessageWorkspace({
  readOnly = false,
  content,
  onSaveLocaleContent,
  onTranslateEmpty,
  translating = false,
  testTo,
  onTestToChange,
  onSendTest,
  sending = false,
  showSendBlock = true,
  sendExtra,
  onBulkSend,
  afterPreview,
}: Props) {
  const [activeTab, setActiveTab] = useState<ContentLocale>("ru");
  const [editorOpen, setEditorOpen] = useState(false);

  const { subject, subjectI18n, htmlBody, htmlI18n, blocksI18n } = content;

  function hasCopy(locale: ContentLocale): boolean {
    return localeHasEmailCopy(
      locale,
      subject,
      subjectI18n,
      htmlBody,
      htmlI18n,
      blocksI18n,
    );
  }

  const previewSubject = useMemo(() => {
    return activeTab === "ru" ? subject : (subjectI18n[activeTab] ?? "");
  }, [activeTab, subject, subjectI18n]);

  const previewBodyHtml = useMemo(() => {
    const blocks = blocksForLocale(blocksI18n, activeTab);
    let body = blocksToHtml(blocks);
    if (!body) {
      body = activeTab === "ru" ? htmlBody : (htmlI18n[activeTab] ?? "");
    }
    return body;
  }, [activeTab, blocksI18n, htmlBody, htmlI18n]);

  const editorBlocks = useMemo(() => {
    const existing = blocksForLocale(blocksI18n, activeTab);
    if (existing.length) return existing;
    const html = activeTab === "ru" ? htmlBody : (htmlI18n[activeTab] ?? "");
    return ensureBlocksFromHtml(html);
  }, [activeTab, blocksI18n, htmlBody, htmlI18n]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {ALL_CONTENT_LOCALES.map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => setActiveTab(locale)}
            className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold ${
              activeTab === locale
                ? "bg-emerald-600 text-white"
                : "text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {LOCALE_LABELS[locale]}
            {hasCopy(locale) ? (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300" />
            ) : null}
          </button>
        ))}
        {!readOnly ? (
          <button
            type="button"
            onClick={() => void onTranslateEmpty()}
            disabled={translating}
            className="ml-2 rounded-lg px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            {translating ? "Перевод…" : "Перевести пустые"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          disabled={readOnly}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil size={14} /> Редактировать
        </button>
      </div>

      <EmailInlinePreview
        subject={previewSubject}
        localeLabel={LOCALE_LABELS[activeTab]}
        bodyHtml={previewBodyHtml}
      />

      {afterPreview}

      {showSendBlock ? (
        <form
          onSubmit={(e) => {
            if (onBulkSend) {
              void onBulkSend(e);
            } else {
              e.preventDefault();
            }
          }}
          className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold text-zinc-800">Отправка</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[200px] flex-1 text-xs text-zinc-500">
              Тест на email
              <input
                className={`${inputCls} mt-1`}
                value={testTo}
                onChange={(e) => onTestToChange(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button
              type="button"
              onClick={() => void onSendTest()}
              disabled={sending || !testTo.trim()}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              Тест
            </button>
            {sendExtra}
            {onBulkSend ? (
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
                Отправить сегменту
              </button>
            ) : null}
          </div>
        </form>
      ) : null}

      {editorOpen ? (
        <EmailBlockEditor
          localeLabel={LOCALE_LABELS[activeTab]}
          subject={activeTab === "ru" ? subject : (subjectI18n[activeTab] ?? "")}
          blocks={editorBlocks}
          onClose={() => setEditorOpen(false)}
          onSave={async ({ subject: s, blocks }) => {
            await onSaveLocaleContent(activeTab, s, blocks);
          }}
        />
      ) : null}
    </>
  );
}

/** Shared translate-empty helper used by campaign + step pages. */
export async function translateEmptyEmailLocales(args: {
  content: EmailMessageContent;
  adminFetch: <T>(url: string, init?: RequestInit) => Promise<T>;
}): Promise<EmailMessageContent> {
  const { content, adminFetch } = args;
  const { subject, subjectI18n, htmlBody, htmlI18n, blocksI18n } = content;

  const hasCopy = (locale: ContentLocale) =>
    localeHasEmailCopy(locale, subject, subjectI18n, htmlBody, htmlI18n, blocksI18n);

  const sourceLocale: ContentLocale = hasCopy("ru")
    ? "ru"
    : (ALL_CONTENT_LOCALES.find((l) => l !== "ru" && hasCopy(l)) ?? "ru");
  const sourceSubject =
    sourceLocale === "ru" ? subject.trim() : (subjectI18n[sourceLocale] ?? "").trim();
  const sourceBlocks = blocksForLocale(blocksI18n, sourceLocale);
  const sourceBody =
    blocksToHtml(sourceBlocks) ||
    (sourceLocale === "ru" ? htmlBody : (htmlI18n[sourceLocale] ?? ""));
  if (!sourceSubject) {
    throw new Error("Заполните тему хотя бы на одном языке");
  }
  const fillLocales = ALL_CONTENT_LOCALES.filter(
    (locale) => locale !== sourceLocale && !hasCopy(locale),
  );
  if (fillLocales.length === 0) {
    throw new Error("ALL_FILLED");
  }

  const { translations } = await adminFetch<{
    translations: Record<string, { title: string; body: string }>;
  }>("/api/admin/translate", {
    method: "POST",
    body: JSON.stringify({
      type: "post",
      source_locale: sourceLocale,
      source_title: sourceSubject,
      source_body: sourceBody,
      fill_locales: fillLocales,
    }),
  });

  let nextSubject = subject;
  const nextSubjectI18n = { ...subjectI18n };
  let nextHtml = htmlBody;
  const nextHtmlI18n = { ...htmlI18n };
  let nextBlocks = { ...blocksI18n };

  if (translations.ru && !hasCopy("ru")) {
    nextSubject = translations.ru.title;
    nextHtml = translations.ru.body;
    nextBlocks = { ...nextBlocks, ru: ensureBlocksFromHtml(translations.ru.body) };
  }
  for (const locale of ALL_CONTENT_LOCALES) {
    if (locale === "ru") continue;
    const t = translations[locale];
    if (!t || hasCopy(locale)) continue;
    nextSubjectI18n[locale] = t.title;
    nextHtmlI18n[locale] = t.body;
    nextBlocks[locale] = ensureBlocksFromHtml(t.body);
  }

  return {
    subject: nextSubject,
    subjectI18n: nextSubjectI18n,
    htmlBody: nextHtml,
    htmlI18n: nextHtmlI18n,
    blocksI18n: nextBlocks,
  };
}
