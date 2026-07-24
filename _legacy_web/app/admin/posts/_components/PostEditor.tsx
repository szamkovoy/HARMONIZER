"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { ALL_CONTENT_LOCALES, type AppContentLocale } from "../../../../modules/i18n/localeCodes";
import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { getBrowserSupabase } from "../../_lib/supabaseBrowser";
import { compressPostCoverFile } from "../_lib/compressPostCover";
import { pickAdminPostDisplay } from "../_lib/adminPostDisplayTitle";

const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];
type ContentLocale = AppContentLocale;

const LOCALE_LABELS: Record<ContentLocale, string> = {
  ru: "RU",
  en: "EN",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
};

const LOCALE_FULL_NAMES: Record<ContentLocale, string> = {
  ru: "Русский",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};

function parseInitialTab(value: string | null | undefined): ContentLocale | null {
  if (!value) return null;
  return (ALL_CONTENT_LOCALES as readonly string[]).includes(value) ? (value as ContentLocale) : null;
}

export type AdminPost = {
  id: string;
  title: string;
  body: string;
  cover_url: string | null;
  is_published: boolean;
  published_at: string | null;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
  translations_updated_at?: string | null;
};

export type AdminComment = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
};

type UploadTicket = { path: string; token: string; publicUrl: string };

async function uploadCover(file: File): Promise<string> {
  const compressed = await compressPostCoverFile(file);
  const ticket = await adminFetch<UploadTicket>("/api/admin/uploads", {
    method: "POST",
    body: JSON.stringify({ bucket: "post-covers", contentType: compressed.type || "image/jpeg" }),
  });
  const { error } = await getBrowserSupabase()
    .storage.from("post-covers")
    .uploadToSignedUrl(ticket.path, ticket.token, compressed, {
      contentType: compressed.type || "image/jpeg",
    });
  if (error) throw new Error(`Загрузка обложки не удалась: ${error.message}`);
  return ticket.publicUrl;
}

/** Upload the same File once when «Перевести» copied it across tabs. */
function createCoverUploadCache() {
  const cache = new Map<File, Promise<string>>();
  return (file: File) => {
    let pending = cache.get(file);
    if (!pending) {
      pending = uploadCover(file);
      cache.set(file, pending);
    }
    return pending;
  };
}

type LocaleTabData = {
  title: string;
  body: string;
  coverUrl: string | null;
  coverFile: File | null;
  coverPreview: string | null;
};

type CoverSource = {
  coverUrl: string | null;
  coverFile: File | null;
  coverPreview: string | null;
};

function tabHasCover(tab: CoverSource): boolean {
  return Boolean(tab.coverUrl || tab.coverFile || tab.coverPreview);
}

function pickTranslateSource(
  title: string,
  body: string,
  localeTabs: Record<TargetLocale, LocaleTabData>,
): { locale: ContentLocale; title: string; body: string } | null {
  if (title.trim()) return { locale: "ru", title: title.trim(), body };
  for (const locale of TARGET_LOCALES) {
    const tab = localeTabs[locale];
    if (tab.title.trim()) {
      return { locale, title: tab.title.trim(), body: tab.body };
    }
  }
  return null;
}

function pickSourceCover(
  sourceLocale: ContentLocale,
  ru: CoverSource,
  localeTabs: Record<TargetLocale, LocaleTabData>,
): CoverSource | null {
  if (sourceLocale === "ru") {
    return tabHasCover(ru) ? ru : null;
  }
  const tab = localeTabs[sourceLocale as TargetLocale];
  return tabHasCover(tab) ? tab : null;
}

function localesMissingContent(
  title: string,
  localeTabs: Record<TargetLocale, LocaleTabData>,
  sourceLocale: ContentLocale,
): ContentLocale[] {
  const missing: ContentLocale[] = [];
  if (sourceLocale !== "ru" && !title.trim()) missing.push("ru");
  for (const locale of TARGET_LOCALES) {
    if (locale === sourceLocale) continue;
    if (!localeTabs[locale].title.trim()) missing.push(locale);
  }
  return missing;
}

function emptyLocaleTab(): LocaleTabData {
  return { title: "", body: "", coverUrl: null, coverFile: null, coverPreview: null };
}

/** Редактор видео: post=null — создание, иначе — редактирование + модерация комментариев. */
export function PostEditor({
  post,
  comments,
  initialTab,
}: {
  post: AdminPost | null;
  comments: AdminComment[];
  initialTab?: string | null;
}) {
  const router = useRouter();
  const isEditing = post !== null;

  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [coverUrl, setCoverUrl] = useState(post?.cover_url ?? null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(post?.is_published ?? true);

  const [activeTab, setActiveTab] = useState<ContentLocale>(() => {
    const fromQuery = parseInitialTab(initialTab);
    if (fromQuery) return fromQuery;
    if (post) return pickAdminPostDisplay(post).locale;
    return "ru";
  });
  const [localeTabs, setLocaleTabs] = useState<Record<TargetLocale, LocaleTabData>>(() => {
    const init = {} as Record<TargetLocale, LocaleTabData>;
    for (const locale of TARGET_LOCALES) {
      init[locale] = {
        title: post?.title_i18n?.[locale] ?? "",
        body: post?.body_i18n?.[locale] ?? "",
        coverUrl: post?.cover_url_i18n?.[locale] ?? null,
        coverFile: null,
        coverPreview: null,
      };
    }
    return init;
  });

  const localeFileInputs = useRef<Partial<Record<TargetLocale, HTMLInputElement | null>>>({});

  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateLocaleTab(locale: TargetLocale, patch: Partial<LocaleTabData>) {
    setLocaleTabs((prev) => ({ ...prev, [locale]: { ...prev[locale], ...patch } }));
  }

  async function runTranslate() {
    const source = pickTranslateSource(title, body, localeTabs);
    if (!source) {
      setTranslateError("Сначала введите заголовок хотя бы на одном языке");
      return;
    }
    const fillLocales = localesMissingContent(title, localeTabs, source.locale);
    if (fillLocales.length === 0) {
      setTranslateError("Все языки уже заполнены — пустых вкладок нет");
      return;
    }
    setTranslateError(null);
    setTranslating(true);
    try {
      const res = await adminFetch<{
        translations: Record<string, { title: string; body: string }>;
      }>("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({
          type: "post",
          source_locale: source.locale,
          source_title: source.title,
          source_body: source.body,
          fill_locales: fillLocales,
        }),
      });

      const sourceCover = pickSourceCover(
        source.locale,
        { coverUrl, coverFile, coverPreview },
        localeTabs,
      );

      function coverCopyFromSource(): Partial<LocaleTabData> {
        if (!sourceCover) return {};
        // Fresh blob URL per locale so clearing one tab does not revoke others.
        const preview =
          sourceCover.coverFile != null
            ? URL.createObjectURL(sourceCover.coverFile)
            : sourceCover.coverPreview;
        return {
          coverUrl: sourceCover.coverUrl,
          coverFile: sourceCover.coverFile,
          coverPreview: preview,
        };
      }

      const ruT = res.translations.ru;
      if (fillLocales.includes("ru") && ruT?.title.trim() && !title.trim()) {
        setTitle(ruT.title);
        setBody(ruT.body ?? "");
        if (sourceCover && !tabHasCover({ coverUrl, coverFile, coverPreview })) {
          const copy = coverCopyFromSource();
          setCoverUrl(copy.coverUrl ?? null);
          setCoverFile(copy.coverFile ?? null);
          setCoverPreview(copy.coverPreview ?? null);
        }
      }

      setLocaleTabs((prev) => {
        const next = { ...prev };
        for (const locale of TARGET_LOCALES) {
          if (!fillLocales.includes(locale)) continue;
          const t = res.translations[locale];
          if (!t?.title.trim()) continue;
          if (next[locale].title.trim()) continue; // never overwrite authored text
          next[locale] = {
            ...next[locale],
            title: t.title,
            body: t.body,
            ...(sourceCover && !tabHasCover(next[locale]) ? coverCopyFromSource() : {}),
          };
        }
        return next;
      });
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Ошибка перевода");
    } finally {
      setTranslating(false);
    }
  }

  function clearActiveLocaleTranslation() {
    if (
      !window.confirm(
        `Удалить перевод для ${LOCALE_FULL_NAMES[activeTab]}? Заголовок, текст и обложка этой вкладки будут очищены.`,
      )
    ) {
      return;
    }
    if (activeTab === "ru") {
      setTitle("");
      setBody("");
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCoverUrl(null);
      setCoverFile(null);
      return;
    }
    const prevPreview = localeTabs[activeTab].coverPreview;
    if (prevPreview) URL.revokeObjectURL(prevPreview);
    updateLocaleTab(activeTab, emptyLocaleTab());
  }

  function clearActiveCover() {
    if (activeTab === "ru") {
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCoverUrl(null);
      setCoverFile(null);
      return;
    }
    const prevPreview = localeTabs[activeTab].coverPreview;
    if (prevPreview) URL.revokeObjectURL(prevPreview);
    updateLocaleTab(activeTab, { coverUrl: null, coverFile: null, coverPreview: null });
  }

  const pickCover = (f: File | null) => {
    setCoverFile(f);
    setCoverUrl(null);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  };

  const activeHasTranslation =
    activeTab === "ru"
      ? Boolean(title.trim() || body.trim() || coverUrl || coverFile)
      : Boolean(
          localeTabs[activeTab].title.trim() ||
            localeTabs[activeTab].body.trim() ||
            tabHasCover(localeTabs[activeTab]),
        );
  const activeHasCover =
    activeTab === "ru" ? Boolean(coverUrl || coverFile || coverPreview) : tabHasCover(localeTabs[activeTab]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const hasTitle =
      title.trim() || TARGET_LOCALES.some((locale) => localeTabs[locale].title.trim());
    if (!hasTitle) {
      setError("Заголовок видео обязателен хотя бы на одном языке");
      return;
    }
    try {
      const uploadCached = createCoverUploadCache();
      let nextCover = coverUrl;
      if (coverFile) {
        setBusy("Загружаю обложку…");
        nextCover = await uploadCached(coverFile);
      }

      const titleI18n: Record<string, string> = {};
      const bodyI18n: Record<string, string> = {};
      const coverUrlI18n: Record<string, string | null> = {};

      for (const locale of TARGET_LOCALES) {
        const tab = localeTabs[locale];
        let localeCoverUrl = tab.coverUrl;
        if (tab.coverFile) {
          setBusy(`Загружаю обложку ${LOCALE_LABELS[locale]}…`);
          localeCoverUrl = await uploadCached(tab.coverFile);
        }
        if (tab.title.trim()) titleI18n[locale] = tab.title.trim();
        if (tab.body.trim()) bodyI18n[locale] = tab.body;
        if (localeCoverUrl) coverUrlI18n[locale] = localeCoverUrl;
      }

      setBusy("Сохраняю…");
      const payload = {
        title,
        body,
        cover_url: nextCover,
        is_published: isPublished,
        title_i18n: titleI18n,
        body_i18n: bodyI18n,
        cover_url_i18n: coverUrlI18n,
      };

      if (post) {
        await adminFetch(`/api/admin/posts/${post.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.refresh();
      } else {
        await adminFetch<{ post: AdminPost }>("/api/admin/posts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.replace("/admin/posts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!post || !window.confirm("Удалить видео вместе с комментариями и обложкой?")) return;
    setBusy("Удаляю…");
    try {
      await adminFetch(`/api/admin/posts/${post.id}`, { method: "DELETE" });
      router.replace("/admin/posts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setBusy(null);
    }
  }

  const ruCoverShown = coverPreview ?? coverUrl;
  const ruHasContent = Boolean(title.trim() || body.trim());

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold text-zinc-900">{post ? "Видео" : "Новое видео"}</h1>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="mb-4">
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab("ru")}
              className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "ru" ? "bg-emerald-500 text-white" : "text-zinc-400 hover:text-zinc-800"
              }`}
            >
              RU
              {ruHasContent ? (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </button>
            {TARGET_LOCALES.map((locale) => {
              const hasContent = localeTabs[locale].title.trim() || localeTabs[locale].body.trim();
              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => setActiveTab(locale)}
                  className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === locale ? "bg-white/10 text-zinc-900" : "text-zinc-500 hover:text-zinc-700"
                  }`}
                  title={LOCALE_FULL_NAMES[locale]}
                >
                  {LOCALE_LABELS[locale]}
                  {hasContent ? (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  ) : null}
                </button>
              );
            })}

            <div className="ml-auto flex items-center">
              <button
                type="button"
                onClick={() => void runTranslate()}
                disabled={translating}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60"
                title="Перевести пустые языки и скопировать обложку источника (RU → EN → …)"
              >
                {translating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Перевести
              </button>
            </div>
          </div>
          {translateError ? <p className="mt-1 text-xs text-red-400">{translateError}</p> : null}
        </div>

        {activeTab === "ru" ? (
          <>
            <div className="mb-4">
              {ruCoverShown ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ruCoverShown}
                  alt="Обложка"
                  className="mb-1.5 h-40 w-full rounded-xl border border-zinc-200 bg-white object-contain"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="mb-1.5 flex h-40 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 bg-white text-xs text-zinc-500 transition-colors hover:border-emerald-400/40"
                >
                  <ImagePlus size={22} strokeWidth={1.6} />
                  Добавить обложку
                </button>
              )}
              {activeHasCover ? (
                <button
                  type="button"
                  onClick={clearActiveCover}
                  className="text-xs text-zinc-500 transition-colors hover:text-red-300"
                >
                  Удалить обложку
                </button>
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
            />

            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-zinc-400">Заголовок (Русский)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs text-zinc-400">
                Текст (переносы строк сохраняются, ссылки станут кликабельными в приложении)
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
              />
            </label>
          </>
        ) : null}

        {TARGET_LOCALES.map((locale) =>
          activeTab === locale ? (
            <LocaleTabFields
              key={locale}
              locale={locale}
              data={localeTabs[locale]}
              onChange={(patch) => updateLocaleTab(locale, patch)}
              onClearCover={clearActiveCover}
              fileInputRef={(el) => {
                localeFileInputs.current[locale] = el;
              }}
            />
          ) : null,
        )}

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="accent-emerald-500"
            />
            {isEditing ? "Опубликовано" : "Опубликовать"}
          </label>
          {activeHasTranslation ? (
            <button
              type="button"
              onClick={clearActiveLocaleTranslation}
              className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-red-300 hover:underline"
              title={`Очистить только вкладку ${LOCALE_LABELS[activeTab]}`}
            >
              Удалить перевод ({LOCALE_LABELS[activeTab]})
            </button>
          ) : null}
        </div>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {busy ?? (isEditing ? "Сохранить" : "Опубликовать")}
          </button>
          {post ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
            >
              <Trash2 size={16} strokeWidth={1.8} /> Удалить
            </button>
          ) : null}
        </div>
      </form>

      {post ? <CommentsModeration initial={comments} /> : null}
    </div>
  );
}

function LocaleTabFields({
  locale,
  data,
  onChange,
  onClearCover,
  fileInputRef,
}: {
  locale: TargetLocale;
  data: LocaleTabData;
  onChange: (patch: Partial<LocaleTabData>) => void;
  onClearCover: () => void;
  fileInputRef: (el: HTMLInputElement | null) => void;
}) {
  const localFileInput = useRef<HTMLInputElement>(null);
  const coverShown = data.coverPreview ?? data.coverUrl;
  const hasCover = Boolean(coverShown);

  function pickFile(f: File | null) {
    const preview = f ? URL.createObjectURL(f) : null;
    if (data.coverPreview) URL.revokeObjectURL(data.coverPreview);
    onChange({ coverFile: f, coverPreview: preview, coverUrl: f ? null : data.coverUrl });
  }

  return (
    <>
      <div className="mb-4">
        {coverShown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverShown}
            alt="Обложка"
            className="mb-1.5 h-40 w-full rounded-xl border border-zinc-200 bg-white object-contain"
          />
        ) : (
          <button
            type="button"
            onClick={() => localFileInput.current?.click()}
            className="mb-1.5 flex h-40 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 bg-white text-xs text-zinc-500 transition-colors hover:border-emerald-400/40"
          >
            <ImagePlus size={22} strokeWidth={1.6} />
            Добавить обложку
          </button>
        )}
        {hasCover ? (
          <button
            type="button"
            onClick={onClearCover}
            className="text-xs text-zinc-500 transition-colors hover:text-red-300"
          >
            Удалить обложку
          </button>
        ) : null}
      </div>
      <input
        ref={(el) => {
          (localFileInput as React.MutableRefObject<HTMLInputElement | null>).current = el;
          fileInputRef(el);
        }}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
      />

      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-zinc-400">Заголовок ({LOCALE_FULL_NAMES[locale]})</span>
        <input
          value={data.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
        />
      </label>

      <label className="mb-4 block">
        <span className="mb-1 block text-xs text-zinc-400">Текст ({LOCALE_FULL_NAMES[locale]})</span>
        <textarea
          value={data.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={10}
          className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
        />
      </label>
    </>
  );
}

function CommentsModeration({ initial }: { initial: AdminComment[] }) {
  const [comments, setComments] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => setComments(initial), [initial]);

  async function toggleHidden(comment: AdminComment) {
    setBusyId(comment.id);
    try {
      await adminFetch(`/api/admin/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden: !comment.is_hidden }),
      });
      setComments((prev) =>
        prev.map((c) => (c.id === comment.id ? { ...c, is_hidden: !comment.is_hidden } : c)),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(comment: AdminComment) {
    if (!window.confirm("Удалить комментарий безвозвратно?")) return;
    setBusyId(comment.id);
    try {
      await adminFetch(`/api/admin/comments/${comment.id}`, { method: "DELETE" });
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-base font-semibold text-zinc-900">Комментарии ({comments.length})</h2>
      {comments.length === 0 ? <p className="text-sm text-zinc-500">Комментариев пока нет.</p> : null}
      <div className="flex flex-col gap-2">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className={`flex items-start gap-3 rounded-xl border border-zinc-200 p-3 ${
              comment.is_hidden ? "bg-zinc-50 opacity-60" : "bg-white"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <Link
                  href={`/admin/users/${comment.user_id}`}
                  className="font-semibold text-emerald-700 hover:underline"
                >
                  {comment.display_name}
                </Link>
                <span>{formatAdminDateTime(comment.created_at)}</span>
                {comment.is_hidden ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-400">Скрыт</span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{comment.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busyId === comment.id ? <Loader2 size={16} className="animate-spin text-zinc-500" /> : null}
              <button
                type="button"
                onClick={() => void toggleHidden(comment)}
                disabled={busyId === comment.id}
                title={comment.is_hidden ? "Показать" : "Скрыть"}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
              >
                {comment.is_hidden ? <Eye size={16} strokeWidth={1.8} /> : <EyeOff size={16} strokeWidth={1.8} />}
              </button>
              <button
                type="button"
                onClick={() => void remove(comment)}
                disabled={busyId === comment.id}
                title="Удалить"
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
