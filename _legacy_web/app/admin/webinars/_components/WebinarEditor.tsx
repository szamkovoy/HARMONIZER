"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImagePlus, Languages, Loader2, ThumbsUp, Trash2, Users } from "lucide-react";

import { TIER_LABELS_RU } from "@/modules/access/core/tiers";
import { isWebinarRecordingTabAvailable } from "@/modules/webinars/core/webinarTiming";
import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { getBrowserSupabase } from "../../_lib/supabaseBrowser";
import { compressPostCoverFile } from "../../posts/_lib/compressPostCover";

const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];
type ContentLocale = "ru" | TargetLocale;

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

export type AdminWebinar = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  join_url: string | null;
  recording_url: string | null;
  is_published: boolean;
  cover_url?: string | null;
  title_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
};

export type AdminWebinarRecording = {
  id: string;
  title: string;
  body: string;
  cover_url: string | null;
  is_published: boolean;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
};

export type AdminWebinarQuestion = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
  vote_count: number;
};

export type AdminWebinarComment = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
};

export type AdminWebinarRegistration = {
  user_id: string;
  created_at: string;
  display_name: string;
  email: string;
  membership_tier: string;
};

type LocaleTabData = {
  title: string;
  body: string;
  coverUrl: string | null;
  coverFile: File | null;
  coverPreview: string | null;
};

type UploadTicket = { path: string; token: string; publicUrl: string };

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyLocaleTab(): LocaleTabData {
  return { title: "", body: "", coverUrl: null, coverFile: null, coverPreview: null };
}

function initLocaleTabs(
  titleI18n?: Record<string, string>,
  bodyI18n?: Record<string, string>,
  coverI18n?: Record<string, string | null>,
): Record<TargetLocale, LocaleTabData> {
  const tabs = {} as Record<TargetLocale, LocaleTabData>;
  for (const locale of TARGET_LOCALES) {
    tabs[locale] = {
      title: titleI18n?.[locale] ?? "",
      body: bodyI18n?.[locale] ?? "",
      coverUrl: coverI18n?.[locale] ?? null,
      coverFile: null,
      coverPreview: null,
    };
  }
  return tabs;
}

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

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50";

export function WebinarEditor({
  webinar,
  questions,
  registrations,
  recording,
  recordingComments,
}: {
  webinar: AdminWebinar | null;
  questions: AdminWebinarQuestion[];
  registrations: AdminWebinarRegistration[];
  recording: AdminWebinarRecording | null;
  recordingComments: AdminWebinarComment[];
}) {
  const router = useRouter();
  const recordingAvailable = webinar ? isWebinarRecordingTabAvailable(webinar.starts_at) : false;
  const [tab, setTab] = useState<"announce" | "recording">(
    webinar && recordingAvailable ? "recording" : "announce",
  );

  const [title, setTitle] = useState(webinar?.title ?? "");
  const [description, setDescription] = useState(webinar?.description ?? "");
  const [startsAt, setStartsAt] = useState(webinar ? toLocalInputValue(webinar.starts_at) : "");
  const [joinUrl, setJoinUrl] = useState(webinar?.join_url ?? "");
  const [isPublished, setIsPublished] = useState(webinar?.is_published ?? true);
  const [coverUrl, setCoverUrl] = useState<string | null>(webinar?.cover_url ?? null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [localeTabs, setLocaleTabs] = useState(() =>
    initLocaleTabs(webinar?.title_i18n, webinar?.description_i18n, webinar?.cover_url_i18n),
  );
  const [activeLocale, setActiveLocale] = useState<ContentLocale>("ru");

  const [recTitle, setRecTitle] = useState(recording?.title ?? webinar?.title ?? "");
  const [recBody, setRecBody] = useState(recording?.body ?? "");
  const [recPublished, setRecPublished] = useState(recording?.is_published ?? false);
  const [recCoverUrl, setRecCoverUrl] = useState<string | null>(recording?.cover_url ?? null);
  const [recCoverFile, setRecCoverFile] = useState<File | null>(null);
  const [recCoverPreview, setRecCoverPreview] = useState<string | null>(null);
  const [recLocaleTabs, setRecLocaleTabs] = useState(() =>
    initLocaleTabs(recording?.title_i18n, recording?.body_i18n, recording?.cover_url_i18n),
  );
  const [recActiveLocale, setRecActiveLocale] = useState<ContentLocale>("ru");
  const [savedRecording, setSavedRecording] = useState(recording);

  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regsOpen, setRegsOpen] = useState(false);

  const localeList = useMemo(() => ["ru", ...TARGET_LOCALES] as ContentLocale[], []);

  async function runTranslate(kind: "announce" | "recording") {
    const isAnnounce = kind === "announce";
    const sourceTitle = isAnnounce ? title.trim() : recTitle.trim();
    const sourceBody = isAnnounce ? description : recBody;
    const tabs = isAnnounce ? localeTabs : recLocaleTabs;
    if (!sourceTitle) {
      setError("Сначала заполните название на русском");
      return;
    }
    const fillLocales = TARGET_LOCALES.filter((locale) => !tabs[locale].title.trim());
    if (fillLocales.length === 0) {
      setError("Все языки уже заполнены");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const res = await adminFetch<{ translations: Record<string, { title: string; body: string }> }>(
        "/api/admin/translate",
        {
          method: "POST",
          body: JSON.stringify({
            type: "post",
            source_locale: "ru",
            source_title: sourceTitle,
            source_body: sourceBody,
            fill_locales: fillLocales,
          }),
        },
      );
      const sourceCover = {
        coverUrl: isAnnounce ? coverUrl : recCoverUrl,
        coverFile: isAnnounce ? coverFile : recCoverFile,
        coverPreview: isAnnounce ? coverPreview : recCoverPreview,
      };
      const patchTabs = (prev: Record<TargetLocale, LocaleTabData>) => {
        const next = { ...prev };
        for (const locale of fillLocales) {
          const tr = res.translations[locale];
          if (!tr) continue;
          next[locale] = {
            ...next[locale],
            title: tr.title,
            body: tr.body,
            coverUrl: next[locale].coverUrl || sourceCover.coverUrl,
            coverFile: next[locale].coverFile || sourceCover.coverFile,
            coverPreview: next[locale].coverPreview || sourceCover.coverPreview,
          };
        }
        return next;
      };
      if (isAnnounce) setLocaleTabs(patchTabs);
      else setRecLocaleTabs(patchTabs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось перевести");
    } finally {
      setTranslating(false);
    }
  }

  async function buildI18nMaps(
    tabs: Record<TargetLocale, LocaleTabData>,
    resolveCover: (file: File) => Promise<string>,
  ) {
    const title_i18n: Record<string, string> = {};
    const body_i18n: Record<string, string> = {};
    const cover_url_i18n: Record<string, string | null> = {};
    for (const locale of TARGET_LOCALES) {
      const tabData = tabs[locale];
      if (tabData.title.trim()) title_i18n[locale] = tabData.title.trim();
      if (tabData.body.trim()) body_i18n[locale] = tabData.body;
      if (tabData.coverFile) cover_url_i18n[locale] = await resolveCover(tabData.coverFile);
      else if (tabData.coverUrl) cover_url_i18n[locale] = tabData.coverUrl;
    }
    return { title_i18n, body_i18n, cover_url_i18n };
  }

  async function saveAnnounce(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const resolveCover = createCoverUploadCache();
      const nextCover = coverFile ? await resolveCover(coverFile) : coverUrl;
      const maps = await buildI18nMaps(localeTabs, resolveCover);
      const payload = {
        title,
        description,
        starts_at: startsAt ? new Date(startsAt).toISOString() : "",
        join_url: joinUrl || null,
        is_published: isPublished,
        cover_url: nextCover,
        title_i18n: maps.title_i18n,
        description_i18n: maps.body_i18n,
        cover_url_i18n: maps.cover_url_i18n,
      };
      if (webinar) {
        await adminFetch(`/api/admin/webinars/${webinar.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.refresh();
      } else {
        const { webinar: created } = await adminFetch<{ webinar: AdminWebinar }>("/api/admin/webinars", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.replace(`/admin/webinars/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function saveRecording(e: FormEvent) {
    e.preventDefault();
    if (!webinar) return;
    setError(null);
    setBusy(true);
    try {
      const resolveCover = createCoverUploadCache();
      const nextCover = recCoverFile ? await resolveCover(recCoverFile) : recCoverUrl;
      const maps = await buildI18nMaps(recLocaleTabs, resolveCover);
      const { recording: saved } = await adminFetch<{ recording: AdminWebinarRecording }>(
        `/api/admin/webinars/${webinar.id}/recording`,
        {
          method: "PUT",
          body: JSON.stringify({
            title: recTitle,
            body: recBody,
            cover_url: nextCover,
            is_published: recPublished,
            title_i18n: maps.title_i18n,
            body_i18n: maps.body_i18n,
            cover_url_i18n: maps.cover_url_i18n,
          }),
        },
      );
      setSavedRecording(saved);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить запись");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!webinar || !window.confirm("Удалить вебинар вместе с вопросами, регистрациями и записью?")) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/webinars/${webinar.id}`, { method: "DELETE" });
      router.replace("/admin/webinars");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setBusy(false);
    }
  }

  function renderLocaleBar(
    active: ContentLocale,
    setActive: (locale: ContentLocale) => void,
    tabs: Record<TargetLocale, LocaleTabData>,
    onTranslate: () => void,
  ) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {localeList.map((locale) => {
          const filled = locale === "ru" ? true : Boolean(tabs[locale as TargetLocale]?.title.trim());
          return (
            <button
              key={locale}
              type="button"
              onClick={() => setActive(locale)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                active === locale
                  ? "bg-emerald-500 text-emerald-950"
                  : filled
                    ? "bg-white/10 text-zinc-200"
                    : "bg-white/5 text-zinc-500"
              }`}
            >
              {LOCALE_LABELS[locale]}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onTranslate}
          disabled={translating || busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50"
        >
          {translating ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
          Перевести
        </button>
      </div>
    );
  }

  function renderCoverPicker(
    preview: string | null,
    url: string | null,
    onPick: (file: File) => void,
    onClear: () => void,
  ) {
    const src = preview || url;
    return (
      <div className="mb-4">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="mb-1.5 h-40 w-full rounded-xl border border-white/10 bg-black/30 object-contain"
          />
        ) : (
          <label className="mb-1.5 flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-black/30 text-xs text-zinc-500 transition-colors hover:border-emerald-400/40">
            <ImagePlus size={22} strokeWidth={1.6} />
            Добавить обложку
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPick(file);
              }}
            />
          </label>
        )}
        {src ? (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-zinc-500 transition-colors hover:text-red-300"
          >
            Удалить обложку
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold text-zinc-100">{webinar ? "Вебинар" : "Новый вебинар"}</h1>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("announce")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            tab === "announce" ? "bg-emerald-500 text-emerald-950" : "bg-white/5 text-zinc-300"
          }`}
        >
          Анонс
        </button>
        {recordingAvailable ? (
          <button
            type="button"
            onClick={() => setTab("recording")}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              tab === "recording" ? "bg-emerald-500 text-emerald-950" : "bg-white/5 text-zinc-300"
            }`}
          >
            Запись
          </button>
        ) : (
          <span className="rounded-xl px-4 py-2 text-sm text-zinc-600" title="Появится через час после начала">
            Запись
          </span>
        )}
      </div>

      {tab === "announce" ? (
        <form onSubmit={saveAnnounce} className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
          {renderLocaleBar(activeLocale, setActiveLocale, localeTabs, () => void runTranslate("announce"))}

          {activeLocale === "ru" ? (
            <>
              {renderCoverPicker(
                coverPreview,
                coverUrl,
                (file) => {
                  setCoverFile(file);
                  setCoverPreview(URL.createObjectURL(file));
                },
                () => {
                  setCoverFile(null);
                  setCoverPreview(null);
                  setCoverUrl(null);
                },
              )}
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">Название</span>
                <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </label>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">Описание (ссылки станут кликабельными)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className={`${inputCls} resize-y`}
                />
              </label>
            </>
          ) : (
            <LocaleFields
              tab={localeTabs[activeLocale]}
              onChange={(patch) =>
                setLocaleTabs((prev) => ({ ...prev, [activeLocale]: { ...prev[activeLocale], ...patch } }))
              }
              onClear={() => setLocaleTabs((prev) => ({ ...prev, [activeLocale]: emptyLocaleTab() }))}
            />
          )}

          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">
                Дата и время (ваш часовой пояс; сохраняется как абсолютный момент)
              </span>
              <input
                required
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Ссылка на трансляцию</span>
              <input
                type="url"
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="https://…"
                className={inputCls}
              />
            </label>
          </div>

          <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="accent-emerald-500"
            />
            {webinar ? "Анонс опубликован" : "Опубликовать"}
          </label>

          {error && tab === "announce" ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-60"
            >
              {busy ? "Сохраняю…" : webinar ? "Сохранить анонс" : "Создать"}
            </button>
            {webinar ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-50"
              >
                <Trash2 size={16} /> Удалить
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <form onSubmit={saveRecording} className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
          {renderLocaleBar(recActiveLocale, setRecActiveLocale, recLocaleTabs, () => void runTranslate("recording"))}

          {recActiveLocale === "ru" ? (
            <>
              {renderCoverPicker(
                recCoverPreview,
                recCoverUrl,
                (file) => {
                  setRecCoverFile(file);
                  setRecCoverPreview(URL.createObjectURL(file));
                },
                () => {
                  setRecCoverFile(null);
                  setRecCoverPreview(null);
                  setRecCoverUrl(null);
                },
              )}
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">Название записи</span>
                <input required value={recTitle} onChange={(e) => setRecTitle(e.target.value)} className={inputCls} />
              </label>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">
                  Описание (ссылку на скачивание записи укажите в тексте)
                </span>
                <textarea
                  value={recBody}
                  onChange={(e) => setRecBody(e.target.value)}
                  rows={6}
                  className={`${inputCls} resize-y`}
                />
              </label>
            </>
          ) : (
            <LocaleFields
              tab={recLocaleTabs[recActiveLocale]}
              onChange={(patch) =>
                setRecLocaleTabs((prev) => ({
                  ...prev,
                  [recActiveLocale]: { ...prev[recActiveLocale], ...patch },
                }))
              }
              onClear={() => setRecLocaleTabs((prev) => ({ ...prev, [recActiveLocale]: emptyLocaleTab() }))}
            />
          )}

          <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={recPublished}
              onChange={(e) => setRecPublished(e.target.checked)}
              className="accent-emerald-500"
            />
            {savedRecording ? "Запись опубликована" : "Опубликовать"}
          </label>

          {error && tab === "recording" ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-60"
          >
            {busy ? "Сохраняю…" : savedRecording ? "Сохранить запись" : "Создать запись"}
          </button>
        </form>
      )}

      {webinar && tab === "announce" ? (
        <>
          <QuestionsModeration initial={questions} title="Вопросы к анонсу" />
          <RegistrationsList
            registrations={registrations}
            open={regsOpen}
            onToggle={() => setRegsOpen((v) => !v)}
          />
        </>
      ) : null}
      {webinar && tab === "recording" ? (
        <CommentsModeration
          initial={recordingComments}
          title={`Комментарии к записи (${recordingComments.length})`}
        />
      ) : null}
    </div>
  );
}

function LocaleFields({
  tab,
  onChange,
  onClear,
}: {
  tab: LocaleTabData;
  onChange: (patch: Partial<LocaleTabData>) => void;
  onClear: () => void;
}) {
  const src = tab.coverPreview || tab.coverUrl;
  return (
    <>
      <div className="mb-4">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="mb-1.5 h-40 w-full rounded-xl border border-white/10 bg-black/30 object-contain"
          />
        ) : (
          <label className="mb-1.5 flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-black/30 text-xs text-zinc-500 transition-colors hover:border-emerald-400/40">
            <ImagePlus size={22} strokeWidth={1.6} />
            Добавить обложку
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onChange({ coverFile: file, coverPreview: URL.createObjectURL(file) });
              }}
            />
          </label>
        )}
        {src ? (
          <button
            type="button"
            onClick={() => onChange({ coverUrl: null, coverFile: null, coverPreview: null })}
            className="text-xs text-zinc-500 transition-colors hover:text-red-300"
          >
            Удалить обложку
          </button>
        ) : null}
      </div>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-zinc-400">Название</span>
        <input
          value={tab.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-zinc-400">Описание</span>
        <textarea
          value={tab.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={5}
          className={`${inputCls} resize-y`}
        />
      </label>
      <button type="button" onClick={onClear} className="mb-3 text-xs text-red-300 hover:underline">
        Удалить перевод этой локали
      </button>
    </>
  );
}

function QuestionsModeration({ initial, title }: { initial: AdminWebinarQuestion[]; title: string }) {
  const [questions, setQuestions] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleHidden(question: AdminWebinarQuestion) {
    setBusyId(question.id);
    try {
      await adminFetch(`/api/admin/comments/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden: !question.is_hidden }),
      });
      setQuestions((prev) =>
        prev.map((q) => (q.id === question.id ? { ...q, is_hidden: !question.is_hidden } : q)),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(question: AdminWebinarQuestion) {
    if (!window.confirm("Удалить вопрос безвозвратно?")) return;
    setBusyId(question.id);
    try {
      await adminFetch(`/api/admin/comments/${question.id}`, { method: "DELETE" });
      setQuestions((prev) => prev.filter((q) => q.id !== question.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-base font-semibold text-zinc-100">
        {title} ({questions.length})
      </h2>
      {questions.length === 0 ? <p className="text-sm text-zinc-500">Вопросов пока нет.</p> : null}
      <div className="flex flex-col gap-2">
        {questions.map((question) => (
          <div
            key={question.id}
            className={`flex items-start gap-3 rounded-xl border border-white/10 p-3 ${
              question.is_hidden ? "bg-black/20 opacity-60" : "bg-[rgba(30,32,38,0.92)]"
            }`}
          >
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
              <ThumbsUp size={12} /> {question.vote_count}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-semibold text-zinc-300">{question.display_name}</span>
                <span>{formatAdminDateTime(question.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{question.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busyId === question.id ? <Loader2 size={16} className="animate-spin text-zinc-500" /> : null}
              <button
                type="button"
                onClick={() => toggleHidden(question)}
                disabled={busyId === question.id}
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
              >
                {question.is_hidden ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                type="button"
                onClick={() => remove(question)}
                disabled={busyId === question.id}
                className="rounded-lg p-2 text-zinc-400 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommentsModeration({ initial, title }: { initial: AdminWebinarComment[]; title: string }) {
  const [comments, setComments] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleHidden(comment: AdminWebinarComment) {
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

  async function remove(comment: AdminWebinarComment) {
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
      <h2 className="mb-3 text-base font-semibold text-zinc-100">{title}</h2>
      {comments.length === 0 ? <p className="text-sm text-zinc-500">Комментариев пока нет.</p> : null}
      <div className="flex flex-col gap-2">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className={`flex items-start gap-3 rounded-xl border border-white/10 p-3 ${
              comment.is_hidden ? "bg-black/20 opacity-60" : "bg-[rgba(30,32,38,0.92)]"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-semibold text-zinc-300">{comment.display_name}</span>
                <span>{formatAdminDateTime(comment.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{comment.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busyId === comment.id ? <Loader2 size={16} className="animate-spin text-zinc-500" /> : null}
              <button
                type="button"
                onClick={() => toggleHidden(comment)}
                disabled={busyId === comment.id}
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 disabled:opacity-50"
              >
                {comment.is_hidden ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                type="button"
                onClick={() => remove(comment)}
                disabled={busyId === comment.id}
                className="rounded-lg p-2 text-zinc-400 hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegistrationsList({
  registrations,
  open,
  onToggle,
}: {
  registrations: AdminWebinarRegistration[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={onToggle}
        className="mb-3 flex items-center gap-2 text-base font-semibold text-zinc-100 hover:text-emerald-300"
      >
        <Users size={18} /> Записавшиеся ({registrations.length})
        {registrations.length > 0 ? <span className="text-xs font-normal text-zinc-500">{open ? "скрыть" : "показать"}</span> : null}
      </button>
      {!open ? null : registrations.length === 0 ? (
        <p className="text-sm text-zinc-500">Пока никто не записался.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {registrations.map((reg) => (
            <Link
              key={reg.user_id}
              href={`/admin/users/${reg.user_id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] px-3 py-2 text-sm transition-colors hover:border-emerald-400/30"
            >
              <span className="font-medium text-zinc-200">{reg.display_name}</span>
              <span className="text-zinc-500">{reg.email}</span>
              <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
                {TIER_LABELS_RU[reg.membership_tier as keyof typeof TIER_LABELS_RU] ?? reg.membership_tier}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
