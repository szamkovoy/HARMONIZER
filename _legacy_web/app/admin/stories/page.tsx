"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ImagePlus,
  Infinity as InfinityIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import { storyProcessUploadBody, uploadStoryRawFile } from "../_lib/storyUpload";

type StoryRow = {
  id: string;
  kind: "image" | "video" | "video_cover";
  image_url: string | null;
  video_url: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  caption: { text?: string; translations?: Record<string, string> } | null;
  publish_at: string | null;
  expires_at: string | null;
  is_evergreen: boolean | null;
  is_published: boolean | null;
};

const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

const LOCALE_LABELS: Record<TargetLocale, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};

type StoryTranslations = Record<TargetLocale, string>;

function storyStatus(s: StoryRow): { label: string; cls: string } {
  if (!s.is_published) return { label: "Черновик", cls: "bg-zinc-100 text-zinc-400" };
  const now = Date.now();
  if (s.publish_at && new Date(s.publish_at).getTime() > now)
    return { label: `Запланирована · ${formatAdminDateTime(s.publish_at)}`, cls: "bg-sky-400/10 text-sky-300" };
  if (!s.is_evergreen && s.expires_at && new Date(s.expires_at).getTime() <= now)
    return { label: "Истекла", cls: "bg-zinc-100 text-zinc-500" };
  return { label: "Активна", cls: "bg-emerald-50 text-emerald-700" };
}

// ─── Translation accordion ────────────────────────────────────────────────────

type TranslationAccordionProps = {
  translations: Partial<StoryTranslations>;
  onChange: (t: Partial<StoryTranslations>) => void;
};

function TranslationAccordion({ translations, onChange }: TranslationAccordionProps) {
  const [expanded, setExpanded] = useState(false);
  const hasTranslations = TARGET_LOCALES.some((l) => translations[l]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <span className="flex-1 text-left">
          Переводы подписи
          {hasTranslations && (
            <span className="ml-1.5 rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
              {TARGET_LOCALES.filter((l) => translations[l]).length} / {TARGET_LOCALES.length}
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded ? (
        <div className="flex flex-col gap-2 border-t border-zinc-100 px-3 pb-3 pt-2">
          {TARGET_LOCALES.map((locale) => (
            <label key={locale} className="block">
              <span className="mb-1 block text-[11px] text-zinc-500">{LOCALE_LABELS[locale]}</span>
              <textarea
                value={translations[locale] ?? ""}
                onChange={(e) =>
                  onChange({ ...translations, [locale]: e.target.value })
                }
                rows={2}
                className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-emerald-500"
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateStoryForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [evergreen, setEvergreen] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [translations, setTranslations] = useState<Partial<StoryTranslations>>({});
  const [translationsShown, setTranslationsShown] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isVideo = file?.type.startsWith("video/") ?? false;

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  };

  async function runTranslate() {
    if (!caption.trim()) {
      setTranslateError("Сначала введите подпись на русском");
      return;
    }
    setTranslateError(null);
    setTranslating(true);
    setTranslationsShown(true);
    try {
      const res = await adminFetch<{ translations: StoryTranslations }>("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({ type: "story", ru_caption: caption }),
      });
      setTranslations(res.translations);
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Ошибка перевода");
    } finally {
      setTranslating(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Выберите фото или видео");
      return;
    }
    if (!publishNow && !publishAt) {
      setError("Укажите дату публикации");
      return;
    }
    setError(null);
    try {
      let finalTranslations = translations;

      if (caption.trim() && autoTranslate && !translationsShown) {
        setBusy("Переводю подпись…");
        try {
          const res = await adminFetch<{ translations: StoryTranslations }>("/api/admin/translate", {
            method: "POST",
            body: JSON.stringify({ type: "story", ru_caption: caption }),
          });
          finalTranslations = res.translations;
        } catch {
          // auto-translate failure is non-fatal — publish without translations
        }
      }

      const uploadRef = await uploadStoryRawFile(file, setBusy);

      setBusy("Обрабатываю сторис…");

      await adminFetch("/api/admin/stories/process", {
        method: "POST",
        body: JSON.stringify({
          ...storyProcessUploadBody(uploadRef),
          caption: caption.trim(),
          caption_translations: Object.keys(finalTranslations).length > 0 ? finalTranslations : undefined,
          publish_at: publishNow ? null : new Date(publishAt).toISOString(),
          is_evergreen: evergreen,
          is_published: true,
        }),
      });

      pickFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setCaption("");
      setPublishNow(true);
      setPublishAt("");
      setEvergreen(false);
      setAutoTranslate(true);
      setTranslations({});
      setTranslationsShown(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сторис");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-white text-zinc-500 transition-colors hover:border-emerald-400/40 sm:w-28"
        >
          {previewUrl ? (
            isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={previewUrl} className="h-full w-full object-cover" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Превью" className="h-full w-full object-cover" />
            )
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus size={22} strokeWidth={1.6} />
              Фото / видео
            </span>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Подпись (необязательно)</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
            />
          </label>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} className="accent-emerald-500" />
              Опубликовать сразу
            </label>
            {!publishNow ? (
              <input
                type="datetime-local"
                required
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 outline-none [color-scheme:dark] focus:border-emerald-500"
              />
            ) : null}
            <label className="flex items-center gap-2" title="Не скрывать через 24 часа">
              <input type="checkbox" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} className="accent-emerald-500" />
              Бессрочная
            </label>
            {!translationsShown ? (
              <label className="flex items-center gap-2" title="Автоматически перевести при публикации">
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => setAutoTranslate(e.target.checked)}
                  className="accent-emerald-500"
                />
                Автоперевод
              </label>
            ) : null}
            <button
              type="button"
              onClick={runTranslate}
              disabled={translating}
              className="flex items-center gap-1 text-sm text-emerald-400 underline-offset-2 hover:underline disabled:opacity-60"
            >
              {translating ? <Loader2 size={12} className="animate-spin" /> : null}
              Перевести
            </button>
          </div>

          {translateError ? <p className="text-xs text-red-400">{translateError}</p> : null}

          {translationsShown ? (
            <TranslationAccordion
              translations={translations}
              onChange={setTranslations}
            />
          ) : null}

          <p className="text-xs text-zinc-500">
            Фото автоматически кропаются под 9:16 и получают миниатюру. Видео перекодируются в mp4, получают poster и tiny-thumb. Лимиты: фото до 30 МБ, видео до 45 МБ сырого файла и до 45 секунд (iPhone 1080p ≈ 30 с, iPhone 4K ≈ 20 с).
          </p>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy !== null}
            className="mt-auto self-start rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {busy ?? "Опубликовать сторис"}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditStoryModal({ story, onClose, onSaved }: { story: StoryRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState(story.caption?.text ?? "");
  const [translations, setTranslations] = useState<Partial<StoryTranslations>>(
    (story.caption?.translations as Partial<StoryTranslations>) ?? {},
  );
  const [isPublished, setIsPublished] = useState(story.is_published ?? false);
  const [evergreen, setEvergreen] = useState(story.is_evergreen ?? false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isVideo = file?.type.startsWith("video/") ?? false;
  const currentPreview = previewUrl ?? story.thumbnail_url ?? (story.kind === "image" ? story.image_url : (story.cover_url ?? story.video_url));

  const pickFile = (f: File | null) => {
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  };

  async function runTranslate() {
    if (!caption.trim()) {
      setTranslateError("Сначала введите подпись на русском");
      return;
    }
    setTranslateError(null);
    setTranslating(true);
    try {
      const res = await adminFetch<{ translations: StoryTranslations }>("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({ type: "story", ru_caption: caption }),
      });
      setTranslations(res.translations);
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Ошибка перевода");
    } finally {
      setTranslating(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (file) {
        const uploadRef = await uploadStoryRawFile(file, setBusy);

        setBusy("Обрабатываю медиа…");
        await adminFetch("/api/admin/stories/process", {
          method: "POST",
          body: JSON.stringify({
            ...storyProcessUploadBody(uploadRef),
            update_id: story.id,
          }),
        });
      }

      setBusy("Сохраняю…");

      // Compute expires_at: if was evergreen and now not — expire 24h from publish_at
      let expiresAt: string | null | undefined = undefined;
      if (!evergreen && story.is_evergreen) {
        const publishAt = story.publish_at ? new Date(story.publish_at) : new Date();
        expiresAt = new Date(publishAt.getTime() + 24 * 3_600_000).toISOString();
      }

      const translationsPayload = Object.fromEntries(
        Object.entries(translations).filter(([, v]) => typeof v === "string" && v.trim()),
      ) as Partial<StoryTranslations>;

      await adminFetch(`/api/admin/stories/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          caption: caption.trim(),
          caption_translations: translationsPayload,
          is_published: isPublished,
          is_evergreen: evergreen,
          ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
        }),
      });

      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-[rgba(24,26,32,0.98)] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">Редактирование сторис</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* Media preview + replacement */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="relative flex h-36 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-white text-zinc-500 hover:border-emerald-400/40"
              title="Нажмите, чтобы заменить медиафайл"
            >
              {currentPreview ? (
                isVideo && previewUrl ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={currentPreview} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentPreview} alt="" className="h-full w-full object-cover" />
                )
              ) : null}
              <span className="absolute bottom-1 right-1 rounded-md bg-black/60 p-0.5">
                <Pencil size={11} className="text-zinc-700" />
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex-1 text-xs text-zinc-500">
              {file ? (
                <p className="text-emerald-400">Новый файл выбран: {file.name}</p>
              ) : (
                <p>Нажмите на превью, чтобы заменить фото или видео.</p>
              )}
            </div>
          </div>

          {/* Caption */}
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Подпись</span>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
            />
          </label>

          {/* Translate controls */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runTranslate}
              disabled={translating}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-50 disabled:opacity-60"
            >
              {translating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Перегенерировать переводы
            </button>
          </div>
          {translateError ? <p className="text-xs text-red-400">{translateError}</p> : null}

          {/* Translations accordion */}
          <TranslationAccordion
            translations={translations}
            onChange={setTranslations}
          />

          {/* Checkboxes */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="accent-emerald-500" />
              Опубликована
            </label>
            <label className="flex items-center gap-2" title="Не скрывать через 24 часа">
              <input type="checkbox" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} className="accent-emerald-500" />
              Бессрочная
            </label>
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy !== null}
              className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            >
              {busy ?? "Сохранить"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800"
            >
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Story card ───────────────────────────────────────────────────────────────

function StoryCard({ story, onChanged }: { story: StoryRow; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const status = useMemo(() => storyStatus(story), [story]);
  const preview = story.thumbnail_url ?? (story.kind === "image" ? story.image_url : (story.cover_url ?? story.video_url));
  const hasTranslations = TARGET_LOCALES.some((l) => story.caption?.translations?.[l]);

  async function togglePublished() {
    setBusy(true);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/stories/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_published: !story.is_published }),
      });
      await onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось обновить сторис");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Удалить сторис вместе с файлом?")) return;
    setBusy(true);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/stories/${story.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось удалить сторис");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-200">
          {preview ? (
            story.kind === "video" && !story.cover_url ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={preview} className="h-full w-full object-cover" muted playsInline preload="metadata" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-full w-full object-cover" />
            )
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${status.cls}`}>{status.label}</span>
            {story.is_evergreen ? (
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <InfinityIcon size={12} /> бессрочная
              </span>
            ) : null}
            <span className="flex items-center gap-1 text-[11px] text-zinc-500">
              <CalendarClock size={12} />
              {story.publish_at ? formatAdminDateTime(story.publish_at) : "—"}
            </span>
            {hasTranslations ? (
              <span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-300" title="Есть переводы">
                🌐
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-zinc-700">
            {story.caption?.text?.trim() || <span className="text-zinc-600">Без подписи</span>}
          </p>
          {actionError ? <p className="mt-1 text-xs text-red-400">{actionError}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={busy}
            title="Редактировать"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
          >
            <Pencil size={18} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={togglePublished}
            disabled={busy}
            title={story.is_published ? "Снять с публикации" : "Опубликовать"}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
          >
            {story.is_published ? <EyeOff size={18} strokeWidth={1.8} /> : <Eye size={18} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            title="Удалить"
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
          >
            <Trash2 size={18} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {editOpen ? (
        <EditStoryModal
          story={story}
          onClose={() => setEditOpen(false)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminStoriesPage() {
  const [stories, setStories] = useState<StoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { stories } = await adminFetch<{ stories: StoryRow[] }>("/api/admin/stories");
      setStories(stories);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить сторис");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-bold text-zinc-900">Сторис</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Фото и видео проходят server-side оптимизацию перед публикацией. Пользователи видят их кольцом в левом аватаре на главном экране приложения.
      </p>

      <CreateStoryForm onCreated={load} />

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      {stories === null && !error ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {stories?.length === 0 ? <p className="mt-6 text-sm text-zinc-500">Пока ни одной сторис.</p> : null}

      <div className="mt-6 flex flex-col gap-3">
        {stories?.map((s) => <StoryCard key={s.id} story={s} onChanged={load} />)}
      </div>
    </div>
  );
}
