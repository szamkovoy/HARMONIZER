"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HelpCircle, Loader2, MessageCircle, Plus, Trash2, Users } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import { useAdminInfiniteScroll } from "../_lib/useAdminInfiniteScroll";

type WebinarListRow = {
  id: string;
  title: string;
  starts_at: string;
  recording_url: string | null;
  is_published: boolean;
  registration_count: number;
  question_count: number;
  recording_post_id: string | null;
  recording_title: string | null;
  recording_is_published: boolean;
  recording_comment_count: number;
};

const PAGE_SIZE = 50;

export default function AdminWebinarsPage() {
  const [webinars, setWebinars] = useState<WebinarListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);

  const loadPage = useCallback(async (offset: number, mode: "replace" | "append") => {
    const seq = ++requestSeq.current;
    if (mode === "replace") setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await adminFetch<{
        webinars: WebinarListRow[];
        total: number;
      }>(`/api/admin/webinars?${params}`);
      if (seq !== requestSeq.current) return;
      setTotal(res.total);
      setWebinars((prev) =>
        mode === "append" && prev ? [...prev, ...res.webinars] : res.webinars,
      );
      setError(null);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить вебинары");
        if (mode === "replace") setWebinars([]);
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPage(0, "replace");
  }, [loadPage]);

  async function handleDelete(id: string) {
    if (!window.confirm("Удалить этот вебинар?")) return;
    setDeletingId(id);
    setError(null);
    try {
      await adminFetch(`/api/admin/webinars/${id}`, { method: "DELETE" });
      setWebinars((prev) => (prev ? prev.filter((w) => w.id !== id) : prev));
      setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  const canLoadMore =
    (webinars?.length ?? 0) < total && !loading && !loadingMore && webinars !== null;

  const sentinelRef = useAdminInfiniteScroll(canLoadMore, () => {
    if (webinars) void loadPage(webinars.length, "append");
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Вебинары</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">Всего: {total}</p>
          <p className="text-sm text-zinc-500">Анонс и запись, вопросы, участники.</p>
        </div>
        <Link
          href="/admin/webinars/new"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} strokeWidth={2.2} /> Новый
        </Link>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {webinars === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {webinars?.length === 0 ? <p className="text-sm text-zinc-500">Пока ни одного вебинара.</p> : null}

      <div className="flex flex-col gap-3">
        {webinars?.map((webinar) => {
          const recordingCreated = Boolean(webinar.recording_post_id);
          const recordingPublished = Boolean(webinar.recording_is_published);
          const listTitle =
            recordingCreated && webinar.recording_title?.trim()
              ? webinar.recording_title.trim()
              : webinar.title;
          return (
            <div
              key={webinar.id}
              className="flex items-stretch gap-1 rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-emerald-400/30"
            >
              <Link href={`/admin/webinars/${webinar.id}`} className="min-w-0 flex-1 hover:opacity-90">
                <p className="font-semibold text-zinc-900">{listTitle}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  {recordingPublished ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      Запись опубликована
                    </span>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        webinar.is_published
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-400"
                      }`}
                    >
                      {webinar.is_published ? "Анонс опубликован" : "Анонс: черновик"}
                    </span>
                  )}
                  <span className="text-zinc-400">{formatAdminDateTime(webinar.starts_at)}</span>
                  <span className="flex items-center gap-1 text-zinc-500">
                    <Users size={12} /> {webinar.registration_count}
                  </span>
                  {recordingPublished ? (
                    <span className="flex items-center gap-1 text-zinc-500">
                      <MessageCircle size={12} /> {webinar.recording_comment_count}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-zinc-500">
                      <HelpCircle size={12} /> {webinar.question_count}
                    </span>
                  )}
                </div>
              </Link>
              <button
                type="button"
                title="Удалить"
                disabled={deletingId === webinar.id}
                onClick={() => void handleDelete(webinar.id)}
                className="shrink-0 self-center p-2 text-zinc-400 hover:text-rose-500 disabled:opacity-50"
              >
                {deletingId === webinar.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div ref={sentinelRef} className="h-8" />
      {loadingMore ? (
        <p className="flex items-center justify-center gap-2 py-3 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Ещё…
        </p>
      ) : null}
    </div>
  );
}
