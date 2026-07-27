"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

type NotificationDetail = {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  sent_at: string | null;
  created_at: string;
};

export default function AdminNotificationDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<NotificationDetail | null>(null);
  const [deliveryCount, setDeliveryCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await adminFetch<{
          notification: NotificationDetail;
          delivery_count: number;
        }>(`/api/admin/notifications/${params.id}`);
        setItem(data.notification);
        setDeliveryCount(data.delivery_count);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить");
      }
    })();
  }, [params.id]);

  if (error && !item) {
    return (
      <div className="space-y-3">
        <Link href="/admin/notifications" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Уведомления
        </Link>
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href="/admin/notifications"
          className="mt-1 text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">{item.title}</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {item.segment_label}
            {" · "}
            {formatAdminDateTime(item.sent_at || item.created_at)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Получателей", item.recipient_count],
          ["В инбоксе", deliveryCount],
          ["Push ok", item.push_sent_count],
          ["Push ошибок", item.push_error_count],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-center"
          >
            <div className="text-lg font-semibold text-zinc-900">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              {label}
            </div>
          </div>
        ))}
      </div>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-800">Текст</h2>
        {item.body ? (
          <p className="whitespace-pre-wrap text-sm text-zinc-700">{item.body}</p>
        ) : (
          <p className="text-sm text-zinc-400">Без текста</p>
        )}
        {item.link_url ? (
          <a
            href={item.link_url}
            target="_blank"
            rel="noreferrer"
            className="block text-sm text-emerald-700 underline"
          >
            {item.link_url}
          </a>
        ) : null}
      </section>
    </div>
  );
}
