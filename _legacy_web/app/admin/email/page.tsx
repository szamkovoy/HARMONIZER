"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Loader2, Mail, Plus, Workflow } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

type CampaignRow = {
  id: string;
  status: string;
  name: string;
  subject: string;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count: number;
  unsubscribed_count: number;
  sent_at: string | null;
  created_at: string;
};

const STATUS_RU: Record<string, string> = {
  draft: "Черновик",
  sending: "Отправка…",
  sent: "Отправлено",
  failed: "Ошибка",
};

export default function AdminEmailListPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const { campaigns: rows } = await adminFetch<{ campaigns: CampaignRow[] }>(
        "/api/admin/email/campaigns",
      );
      setCampaigns(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createDraft() {
    setCreating(true);
    try {
      const { campaign } = await adminFetch<{ campaign: { id: string } }>(
        "/api/admin/email/campaigns",
        {
          method: "POST",
          body: JSON.stringify({
            name: "Новая рассылка",
            subject: "",
            html_body: "",
            segment_query: { all_installed: true },
          }),
        },
      );
      window.location.href = `/admin/email/${campaign.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-zinc-900">Рассылки</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/email/deliverability"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Activity size={16} />
            Доставляемость
          </Link>
          <Link
            href="/admin/email/automations"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Workflow size={16} />
            Цепочки
          </Link>
          <button
            type="button"
            onClick={() => void createDraft()}
            disabled={creating}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Новая рассылка
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {campaigns === null ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
          <Mail size={28} className="text-zinc-400" />
          <p className="text-sm text-zinc-500">Пока нет рассылок — создайте первую.</p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
          {campaigns.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/email/${c.id}`}
                className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900">
                    {c.name.trim() || c.subject.trim() || "Без названия"}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {STATUS_RU[c.status] ?? c.status}
                    {" · "}
                    {formatAdminDateTime(c.sent_at || c.created_at)}
                    {c.subject.trim() && c.name.trim() ? ` · ${c.subject}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] leading-relaxed text-zinc-500 sm:text-right">
                  {c.status === "sent" || c.status === "sending" ? (
                    <span>
                      отпр. {c.sent_count}
                      {" · "}дост. {c.delivered_count}
                      {" · "}откр. {c.opened_count}
                      {" · "}клики {c.clicked_count}
                      {" · "}отказ {c.bounced_count}
                      {c.complained_count > 0 ? ` · спам ${c.complained_count}` : ""}
                      {c.unsubscribed_count > 0
                        ? ` · отпис. ${c.unsubscribed_count}`
                        : ""}
                    </span>
                  ) : (
                    <span>черновик</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
