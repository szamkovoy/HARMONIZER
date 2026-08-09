"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, FileImage, Loader2, Trash2 } from "lucide-react";

import { TIER_LABELS_RU } from "@/modules/access/core/tiers";

import { adminFetch, adminFetchBlob } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import { useAdminInfiniteScroll } from "../_lib/useAdminInfiniteScroll";

type SupportAttachment = {
  id: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
};

type SupportMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  processed_at: string | null;
  display_name: string;
  email: string;
  membership_tier: string;
  attachments: SupportAttachment[];
};

const PAGE_SIZE = 50;

function attachmentFilename(att: SupportAttachment, index: number): string {
  const ext =
    att.mime_type === "image/png" ? "png" : att.mime_type === "image/webp" ? "webp" : "jpg";
  return `support-${index + 1}.${ext}`;
}

export default function AdminFeedbackPage() {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unprocessedCount, setUnprocessedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);

  const loadPage = useCallback(async (offset: number, mode: "replace" | "append") => {
    const seq = ++requestSeq.current;
    if (mode === "replace") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const data = await adminFetch<{
        messages: SupportMessage[];
        total: number;
        unprocessedCount: number;
      }>(`/api/admin/feedback?${params}`);
      if (seq !== requestSeq.current) return;
      setTotal(data.total);
      setUnprocessedCount(data.unprocessedCount);
      setMessages((prev) =>
        mode === "append" && prev ? [...prev, ...data.messages] : data.messages,
      );
      if (mode === "replace") setSelected(new Set());
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить сообщения");
        if (mode === "replace") setMessages([]);
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

  async function toggleProcessed(message: SupportMessage) {
    setBusyId(message.id);
    try {
      const { message: updated } = await adminFetch<{ message: { id: string; processed_at: string | null } }>(
        `/api/admin/feedback/${message.id}`,
        { method: "PATCH", body: JSON.stringify({ processed: !message.processed_at }) },
      );
      setMessages((prev) =>
        (prev ?? []).map((m) => (m.id === message.id ? { ...m, processed_at: updated.processed_at } : m)),
      );
      setUnprocessedCount((n) => {
        if (!message.processed_at && updated.processed_at) return Math.max(0, n - 1);
        if (message.processed_at && !updated.processed_at) return n + 1;
        return n;
      });
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!messages) return;
    setSelected((prev) => {
      if (prev.size === messages.length) return new Set();
      return new Set(messages.map((m) => m.id));
    });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Удалить выбранные сообщения (${selected.size}) вместе с вложениями? Это нельзя отменить.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await adminFetch("/api/admin/feedback", {
        method: "DELETE",
        body: JSON.stringify({ ids: [...selected] }),
      });
      await loadPage(0, "replace");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeleting(false);
    }
  }

  async function downloadAttachment(att: SupportAttachment, index: number) {
    setDownloadingId(att.id);
    setError(null);
    let objectUrl: string | null = null;
    try {
      const blob = await adminFetchBlob(`/api/admin/feedback/attachments/${att.id}`);
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = attachmentFilename(att, index);
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Не revoke сразу: Safari/Chrome иногда обрывают download до старта.
      const urlToRevoke = objectUrl;
      objectUrl = null;
      window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 60_000);
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setError(err instanceof Error ? err.message : "Не удалось скачать вложение");
    } finally {
      setDownloadingId(null);
    }
  }

  const allSelected = useMemo(
    () => Boolean(messages?.length && selected.size === messages.length),
    [messages, selected],
  );

  const canLoadMore =
    (messages?.length ?? 0) < total && !loading && !loadingMore && messages !== null;

  const sentinelRef = useAdminInfiniteScroll(canLoadMore, () => {
    if (messages) void loadPage(messages.length, "append");
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Поддержка</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">Всего: {total}</p>
          <p className="text-sm text-zinc-500">
            Сообщения из формы «Написать в поддержку» в Профиле.
            {unprocessedCount > 0 ? ` Необработанных: ${unprocessedCount}.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {messages && messages.length > 0 ? (
            <button
              type="button"
              onClick={toggleSelectAll}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-800"
            >
              {allSelected ? "Снять выбор" : "Выбрать загруженные"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={selected.size === 0 || deleting}
            onClick={() => void deleteSelected()}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition-opacity disabled:opacity-40"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Удалить{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {messages === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {messages?.length === 0 ? <p className="text-sm text-zinc-500">Сообщений пока нет.</p> : null}

      <div className="flex flex-col gap-3">
        {messages?.map((message) => (
          <div
            key={message.id}
            className={`flex items-start gap-3 rounded-2xl border border-zinc-200 p-3 transition-colors hover:border-emerald-400/30 ${
              message.processed_at ? "bg-zinc-50 opacity-70" : "bg-white"
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(message.id)}
              onChange={() => toggleSelected(message.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-emerald-400"
              aria-label="Выбрать сообщение"
            />
            <button
              type="button"
              onClick={() => void toggleProcessed(message)}
              disabled={busyId === message.id}
              title={message.processed_at ? "Снять отметку" : "Отметить обработанным"}
              className="mt-0.5 shrink-0 text-zinc-400 transition-colors hover:text-emerald-700 disabled:opacity-50"
            >
              {busyId === message.id ? (
                <Loader2 size={18} className="animate-spin" />
              ) : message.processed_at ? (
                <CheckCircle2 size={18} className="text-emerald-400" />
              ) : (
                <Circle size={18} />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                <span className="font-semibold text-zinc-700">{message.display_name}</span>
                <span>{message.email}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5">
                  {TIER_LABELS_RU[message.membership_tier as keyof typeof TIER_LABELS_RU] ?? message.membership_tier}
                </span>
                <span>{formatAdminDateTime(message.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{message.body}</p>
              {message.attachments?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.attachments.map((att, index) => (
                    <button
                      key={att.id}
                      type="button"
                      disabled={downloadingId === att.id}
                      onClick={() => void downloadAttachment(att, index)}
                      title={`Скачать скриншот ${index + 1}`}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-xs text-zinc-700 transition-colors hover:border-emerald-400/40 hover:text-emerald-800 disabled:opacity-40"
                    >
                      {downloadingId === att.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <FileImage size={14} />
                      )}
                      Файл {index + 1}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
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
