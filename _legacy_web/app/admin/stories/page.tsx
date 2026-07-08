"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, Eye, EyeOff, ImagePlus, Infinity as InfinityIcon, Loader2, Trash2 } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { getBrowserSupabase } from "../_lib/supabaseBrowser";

type StoryRow = {
  id: string;
  kind: "image" | "video" | "video_cover";
  image_url: string | null;
  video_url: string | null;
  cover_url: string | null;
  caption: { text?: string } | null;
  publish_at: string | null;
  expires_at: string | null;
  is_evergreen: boolean | null;
  is_published: boolean | null;
};

type UploadTicket = { path: string; token: string; publicUrl: string };

const dtFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function storyStatus(s: StoryRow): { label: string; cls: string } {
  if (!s.is_published) return { label: "Черновик", cls: "bg-white/5 text-zinc-400" };
  const now = Date.now();
  if (s.publish_at && new Date(s.publish_at).getTime() > now)
    return { label: `Запланирована · ${dtFmt.format(new Date(s.publish_at))}`, cls: "bg-sky-400/10 text-sky-300" };
  if (!s.is_evergreen && s.expires_at && new Date(s.expires_at).getTime() <= now)
    return { label: "Истекла", cls: "bg-white/5 text-zinc-500" };
  return { label: "Активна", cls: "bg-emerald-400/10 text-emerald-300" };
}

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
      <h1 className="mb-1 text-xl font-bold text-zinc-100">Сторис</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Фото или видео на 24 часа. Пользователи видят их кольцом на главном экране приложения.
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

function CreateStoryForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [publishAt, setPublishAt] = useState("");
  const [evergreen, setEvergreen] = useState(false);
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Выберите фото или видео");
      return;
    }
    setError(null);
    try {
      setBusy("Загружаю файл…");
      const ticket = await adminFetch<UploadTicket>("/api/admin/uploads", {
        method: "POST",
        body: JSON.stringify({ contentType: file.type }),
      });
      const { error: uploadError } = await getBrowserSupabase()
        .storage.from("story-media")
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (uploadError) throw new Error(`Загрузка файла не удалась: ${uploadError.message}`);

      setBusy("Сохраняю сторис…");
      await adminFetch("/api/admin/stories", {
        method: "POST",
        body: JSON.stringify({
          kind: isVideo ? "video" : "image",
          [isVideo ? "video_url" : "image_url"]: ticket.publicUrl,
          caption,
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
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сторис");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-black/30 text-zinc-500 transition-colors hover:border-emerald-400/40 sm:w-28"
        >
          {previewUrl ? (
            isVideo ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- превью в форме админа
              <video src={previewUrl} className="h-full w-full object-cover" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- локальный blob-превью
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
              className="w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
            />
          </label>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-300">
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
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-sm text-zinc-100 outline-none [color-scheme:dark] focus:border-emerald-400/50"
              />
            ) : null}
            <label className="flex items-center gap-2" title="Не скрывать через 24 часа">
              <input type="checkbox" checked={evergreen} onChange={(e) => setEvergreen(e.target.checked)} className="accent-emerald-500" />
              Бессрочная
            </label>
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={busy !== null}
            className="mt-auto self-start rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
          >
            {busy ?? "Опубликовать сторис"}
          </button>
        </div>
      </div>
    </form>
  );
}

function StoryCard({ story, onChanged }: { story: StoryRow; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const status = useMemo(() => storyStatus(story), [story]);
  const preview = story.kind === "image" ? story.image_url : (story.cover_url ?? story.video_url);

  async function togglePublished() {
    setBusy(true);
    try {
      await adminFetch(`/api/admin/stories/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_published: !story.is_published }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Удалить сторис вместе с файлом?")) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/stories/${story.id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
      <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-black/40">
        {preview ? (
          story.kind === "video" && !story.cover_url ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- миниатюра в списке
            <video src={preview} className="h-full w-full object-cover" muted playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- прямые URL из Storage
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
            {story.publish_at ? dtFmt.format(new Date(story.publish_at)) : "—"}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-zinc-300">
          {story.caption?.text?.trim() || <span className="text-zinc-600">Без подписи</span>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={togglePublished}
          disabled={busy}
          title={story.is_published ? "Снять с публикации" : "Опубликовать"}
          className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
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
  );
}
