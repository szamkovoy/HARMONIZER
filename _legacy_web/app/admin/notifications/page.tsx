"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";

import { AdminListCard, ADMIN_LIST_STACK } from "../_components/AdminListCard";
import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

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
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
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
      setRows(data.notifications);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
      setRows([]);
    }
  }, [page, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [userId]);

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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Уведомления</h1>
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

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>
                Стр. {page} из {totalPages} · всего {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-1.5 disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Назад
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-1.5 disabled:opacity-40"
                >
                  Вперёд <ChevronRight size={14} />
                </button>
              </div>
            </div>
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
