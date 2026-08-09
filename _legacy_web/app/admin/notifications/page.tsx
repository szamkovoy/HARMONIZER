"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2, Plus } from "lucide-react";

import { AdminListCard, ADMIN_LIST_STACK } from "../_components/AdminListCard";
import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import { useAdminInfiniteScroll } from "../_lib/useAdminInfiniteScroll";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  sent_at: string | null;
  created_at: string;
};

const PAGE_SIZE = 50;

function NotificationsList() {
  const searchParams = useSearchParams();
  const userId = (searchParams.get("user_id") ?? "").trim();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);
  const nextPageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(
    async (page: number, mode: "replace" | "append") => {
      const seq = ++requestSeq.current;
      if (mode === "replace") setLoading(true);
      else {
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      }
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        if (userId) params.set("user_id", userId);
        const data = await adminFetch<{
          notifications: NotificationRow[];
          total: number;
        }>(`/api/admin/notifications?${params}`);
        if (seq !== requestSeq.current) return;
        setRows((prev) => {
          if (mode !== "append" || !prev) return data.notifications;
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...data.notifications.filter((r) => !seen.has(r.id))];
        });
        setTotal(data.total ?? 0);
        nextPageRef.current = page + 1;
        setError(null);
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить");
          if (mode === "replace") setRows([]);
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [userId],
  );

  useEffect(() => {
    setRows(null);
    nextPageRef.current = 1;
    void loadPage(1, "replace");
  }, [loadPage]);

  async function createDraft() {
    setCreating(true);
    try {
      const { notification } = await adminFetch<{ notification: { id: string } }>(
        "/api/admin/notifications",
        {
          method: "POST",
          body: JSON.stringify({
            draft: true,
            title: "Новое уведомление",
            body: "",
            segment: "all",
          }),
        },
      );
      window.location.href = `/admin/notifications/${notification.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm(
        "Удалить это уведомление? Оно исчезнет у всех получателей в «Мои уведомления».",
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      await adminFetch(`/api/admin/notifications/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  const canLoadMore =
    (rows?.length ?? 0) < total && !loading && !loadingMore && rows !== null;

  const sentinelRef = useAdminInfiniteScroll(canLoadMore, () => {
    void loadPage(nextPageRef.current, "append");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Уведомления</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">Всего: {total}</p>
          {userId ? (
            <p className="mt-1 text-sm text-zinc-500">
              Фильтр по пользователю{" "}
              <code className="text-xs">{userId.slice(0, 8)}…</code>
              {" · "}
              <Link href="/admin/notifications" className="text-emerald-700 hover:underline">
                сбросить
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              Push + копия в «Мои уведомления». Черновик → редактор → Отправить.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void createDraft()}
          disabled={creating}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Новое
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
          <Bell size={28} className="text-zinc-400" />
          <p className="text-sm text-zinc-500">Пока нет уведомлений — создайте первое.</p>
        </div>
      ) : (
        <>
          <div className={ADMIN_LIST_STACK}>
            {rows.map((item) => {
              const isDraft = !item.sent_at;
              return (
                <AdminListCard
                  key={item.id}
                  href={`/admin/notifications/${item.id}`}
                  title={item.title.trim() || "Без заголовка"}
                  subtitle={[
                    isDraft ? "Черновик" : "Отправлено",
                    item.segment_label,
                    formatAdminDateTime(item.sent_at || item.created_at),
                    !isDraft
                      ? `получателей ${item.recipient_count} · push ${item.push_sent_count}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onDelete={() => void handleDelete(item.id)}
                  deleting={deletingId === item.id}
                />
              );
            })}
          </div>
          <div ref={sentinelRef} className="h-8" />
          {loadingMore ? (
            <p className="flex items-center justify-center gap-2 py-3 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> Ещё…
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function AdminNotificationsPage() {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </p>
      }
    >
      <NotificationsList />
    </Suspense>
  );
}
