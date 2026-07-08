"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

type SupportMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  processed_at: string | null;
  display_name: string;
  email: string;
  membership_tier: string;
};

const TIER_LABELS: Record<string, string> = {
  free: "Бесплатный",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

export default function AdminFeedbackPage() {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ messages: SupportMessage[] }>("/api/admin/feedback")
      .then(({ messages }) => setMessages(messages))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить сообщения"));
  }, []);

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
    } finally {
      setBusyId(null);
    }
  }

  const unprocessed = messages?.filter((m) => !m.processed_at).length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-zinc-100">Поддержка</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Сообщения из формы «Написать в поддержку» в Профиле.
        {unprocessed > 0 ? ` Необработанных: ${unprocessed}.` : ""}
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {messages === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {messages?.length === 0 ? <p className="text-sm text-zinc-500">Сообщений пока нет.</p> : null}

      <div className="flex flex-col gap-2">
        {messages?.map((message) => (
          <div
            key={message.id}
            className={`flex items-start gap-3 rounded-xl border border-white/10 p-3 ${
              message.processed_at ? "bg-black/20 opacity-70" : "bg-[rgba(30,32,38,0.92)]"
            }`}
          >
            <button
              type="button"
              onClick={() => void toggleProcessed(message)}
              disabled={busyId === message.id}
              title={message.processed_at ? "Снять отметку" : "Отметить обработанным"}
              className="mt-0.5 shrink-0 text-zinc-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
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
                <span className="font-semibold text-zinc-300">{message.display_name}</span>
                <span>{message.email}</span>
                <span className="rounded-full bg-white/5 px-2 py-0.5">
                  {TIER_LABELS[message.membership_tier] ?? message.membership_tier}
                </span>
                <span>{formatAdminDateTime(message.created_at)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{message.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
