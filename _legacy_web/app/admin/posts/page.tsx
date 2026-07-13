"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Plus } from "lucide-react";

import { pickAdminPostDisplay } from "./_lib/adminPostDisplayTitle";
import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

type PostListRow = {
  id: string;
  title: string;
  cover_url: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  comment_count: number;
  title_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
  translations_updated_at?: string | null;
};

function hasPostTranslations(post: PostListRow): boolean {
  if (post.translations_updated_at) return true;
  const titles = post.title_i18n ?? {};
  return Object.values(titles).some((value) => typeof value === "string" && value.trim().length > 0);
}

export default function AdminPostsPage() {
  const [posts, setPosts] = useState<PostListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPosts(null);
    adminFetch<{ posts: PostListRow[] }>("/api/admin/posts")
      .then(({ posts: rows }) => setPosts(rows))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить видео"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Видео</h1>
          <p className="text-sm text-zinc-500">
            Обложки, описания и ссылки на видео во вкладке «Видео» приложения.
          </p>
        </div>
        <Link
          href="/admin/posts/new"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950"
        >
          <Plus size={16} strokeWidth={2.2} /> Новая
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 text-xs text-zinc-300 underline hover:text-zinc-100"
          >
            Повторить
          </button>
        </div>
      ) : null}
      {posts === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {posts?.length === 0 ? <p className="text-sm text-zinc-500">Пока ни одного видео.</p> : null}

      <div className="flex flex-col gap-3">
        {posts?.map((post) => {
          const display = pickAdminPostDisplay(post);
          return (
            <Link
              key={post.id}
              href={`/admin/posts/${post.id}?tab=${display.locale}`}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3 transition-colors hover:border-emerald-400/30"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/40">
                {display.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={display.coverUrl} alt="" className="h-full w-full object-contain" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-zinc-100">{display.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      post.is_published ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-400"
                    }`}
                  >
                    {post.is_published ? "Опубликовано" : "Черновик"}
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-0.5 uppercase text-zinc-400">
                    {display.locale}
                  </span>
                  <span className="text-zinc-500">
                    {formatAdminDateTime(post.published_at ?? post.created_at)}
                  </span>
                  <span className="flex items-center gap-1 text-zinc-500">
                    <MessageSquare size={12} /> {post.comment_count}
                  </span>
                  {hasPostTranslations(post) ? (
                    <span
                      className="rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-300"
                      title={
                        post.translations_updated_at
                          ? `Переведено ${formatAdminDateTime(post.translations_updated_at)}`
                          : "Есть переводы на другие языки"
                      }
                    >
                      🌐
                    </span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
