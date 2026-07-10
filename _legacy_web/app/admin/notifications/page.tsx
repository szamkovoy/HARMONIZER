"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { PRODUCT_TIERS, TIER_LABELS_RU } from "@/modules/access/core/tiers";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  created_at: string;
};

type WebinarOption = { id: string; title: string; starts_at: string };

const TIER_OPTIONS = PRODUCT_TIERS.map((tier) => ({
  value: `tier:${tier}`,
  label: `Тариф «${TIER_LABELS_RU[tier]}»`,
}));

export default function AdminNotificationsPage() {
  const [history, setHistory] = useState<NotificationRow[] | null>(null);
  const [webinars, setWebinars] = useState<WebinarOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [segment, setSegment] = useState("all");
  const [sending, setSending] = useState(false);
  const [sentInfo, setSentInfo] = useState<string | null>(null);

  const loadHistory = () =>
    adminFetch<{ notifications: NotificationRow[] }>("/api/admin/notifications")
      .then(({ notifications }) => setHistory(notifications))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить историю"));

  useEffect(() => {
    void loadHistory();
    adminFetch<{ webinars: WebinarOption[] }>("/api/admin/webinars")
      .then(({ webinars }) => setWebinars(webinars))
      .catch(() => setWebinars([]));
  }, []);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Отправить уведомление выбранному сегменту?")) return;
    setSending(true);
    setError(null);
    setSentInfo(null);
    try {
      const { notification } = await adminFetch<{ notification: NotificationRow }>("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({ title, body, link_url: linkUrl || null, segment }),
      });
      setSentInfo(
        `Отправлено: получателей ${notification.recipient_count}, push ушло ${notification.push_sent_count}, ошибок ${notification.push_error_count}.`,
      );
      setTitle("");
      setBody("");
      setLinkUrl("");
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-zinc-100">Уведомления</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Push + гарантированная копия в «Мои уведомления» в Профиле (видна даже без push-разрешений).
      </p>

      <form onSubmit={handleSend} className="mb-6 rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Заголовок</span>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Текст</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${inputCls} resize-y`} />
        </label>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Ссылка (необязательно)</span>
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Сегмент</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
              <option value="all">Все пользователи</option>
              {TIER_OPTIONS.map((tier) => (
                <option key={tier.value} value={tier.value}>
                  {tier.label}
                </option>
              ))}
              {webinars.map((webinar) => (
                <option key={webinar.id} value={`webinar:${webinar.id}`}>
                  Вебинар «{webinar.title}» ({formatAdminDateTime(webinar.starts_at)})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        {sentInfo ? (
          <p className="mb-3 flex items-center gap-1.5 text-sm text-emerald-300">
            <CheckCircle2 size={15} /> {sentInfo}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending}
          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={2} />}
          {sending ? "Отправляю…" : "Отправить"}
        </button>
      </form>

      <h2 className="mb-3 text-base font-semibold text-zinc-100">История</h2>
      {history === null ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : history.length === 0 ? (
        <p className="text-sm text-zinc-500">Рассылок ещё не было.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
              <p className="font-semibold text-zinc-100">{item.title}</p>
              {item.body ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-400">{item.body}</p> : null}
              {item.link_url ? (
                <a href={item.link_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                  {item.link_url}
                </a>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="rounded-full bg-white/5 px-2 py-0.5">{item.segment_label}</span>
                <span>{formatAdminDateTime(item.created_at)}</span>
                <span>
                  получателей {item.recipient_count} · push {item.push_sent_count}
                  {item.push_error_count > 0 ? ` · ошибок ${item.push_error_count}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
