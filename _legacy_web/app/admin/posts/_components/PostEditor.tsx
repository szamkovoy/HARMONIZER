"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { getBrowserSupabase } from "../../_lib/supabaseBrowser";

export type AdminPost = {
  id: string;
  title: string;
  body: string;
  cover_url: string | null;
  is_published: boolean;
  published_at: string | null;
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
  const ticket = await adminFetch<UploadTicket>("/api/admin/uploads", {
    method: "POST",
    body: JSON.stringify({ bucket: "post-covers", contentType: file.type }),
  });
  const { error } = await getBrowserSupabase()
    .storage.from("post-covers")
    .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (error) throw new Error(`Загрузка обложки не удалась: ${error.message}`);
  return ticket.publicUrl;
}

/** Редактор публикации: post=null — создание, иначе — редактирование + модерация комментариев. */
export function PostEditor({ post, comments }: { post: AdminPost | null; comments: AdminComment[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [coverUrl, setCoverUrl] = useState(post?.cover_url ?? null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [isPublished, setIsPublished] = useState(post?.is_published ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickCover = (f: File | null) => {
    setCoverFile(f);
    setCoverPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let nextCover = coverUrl;
      if (coverFile) {
        setBusy("Загружаю обложку…");
        nextCover = await uploadCover(coverFile);
      }
      setBusy("Сохраняю…");
      const payload = { title, body, cover_url: nextCover, is_published: isPublished };
      if (post) {
        await adminFetch(`/api/admin/posts/${post.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.refresh();
      } else {
        const { post: created } = await adminFetch<{ post: AdminPost }>("/api/admin/posts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.replace(`/admin/posts/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!post || !window.confirm("Удалить публикацию вместе с комментариями и обложкой?")) return;
    setBusy("Удаляю…");
    try {
      await adminFetch(`/api/admin/posts/${post.id}`, { method: "DELETE" });
      router.replace("/admin/posts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setBusy(null);
    }
  }

  const coverShown = coverPreview ?? coverUrl;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold text-zinc-100">{post ? "Публикация" : "Новая публикация"}</h1>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mb-4 flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-black/30 text-zinc-500 transition-colors hover:border-emerald-400/40"
        >
          {coverShown ? (
            // eslint-disable-next-line @next/next/no-img-element -- превью/Storage URL
            <img src={coverShown} alt="Обложка" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus size={22} strokeWidth={1.6} />
              Обложка (необязательно)
            </span>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
        />

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Заголовок</span>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
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
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
          />
        </label>

        <div className="mb-4 flex items-center gap-4 text-sm text-zinc-300">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="accent-emerald-500"
            />
            Опубликована
          </label>
        </div>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
          >
            {busy ?? (post ? "Сохранить" : "Создать")}
          </button>
          {post ? (
            <button
              type="button"
              onClick={handleDelete}
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
      <h2 className="mb-3 text-base font-semibold text-zinc-100">Комментарии ({comments.length})</h2>
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
                {comment.is_hidden ? (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-400">Скрыт</span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{comment.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busyId === comment.id ? <Loader2 size={16} className="animate-spin text-zinc-500" /> : null}
              <button
                type="button"
                onClick={() => toggleHidden(comment)}
                disabled={busyId === comment.id}
                title={comment.is_hidden ? "Показать" : "Скрыть"}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
              >
                {comment.is_hidden ? <Eye size={16} strokeWidth={1.8} /> : <EyeOff size={16} strokeWidth={1.8} />}
              </button>
              <button
                type="button"
                onClick={() => remove(comment)}
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
