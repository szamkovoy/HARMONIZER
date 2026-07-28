"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  Plus,
  Workflow,
} from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import {
  emailListSubjectSubtitle,
  emailListTitle,
} from "../../api/_utils/emailNaming";
import { EmailListRow } from "./_components/EmailListRow";

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
  error_count?: number;
  sent_at: string | null;
  created_at: string;
};

const STATUS_RU: Record<string, string> = {
  draft: "Черновик",
  sending: "Отправка…",
  sent: "Отправлено",
  failed: "Ошибка",
};

const PAGE_SIZE = 50;

function EmailCampaignsList() {
  const searchParams = useSearchParams();
  const userId = (searchParams.get("user_id") ?? "").trim();
  const [page, setPage] = useState(1);
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      if (userId) params.set("user_id", userId);
      const data = await adminFetch<{
        campaigns: CampaignRow[];
        total: number;
      }>(`/api/admin/email/campaigns?${params}`);
      setCampaigns(data.campaigns);
      setTotal(data.total ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Рассылки</h1>
          {userId ? (
            <p className="mt-1 text-sm text-zinc-500">
              Фильтр по пользователю{" "}
              <code className="text-xs">{userId.slice(0, 8)}…</code>
              {" · "}
              <Link href="/admin/email" className="text-emerald-700 hover:underline">
                сбросить
              </Link>
            </p>
          ) : null}
        </div>
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
        <>
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
            {campaigns.map((c) => {
              const showStats = c.status === "sent" || c.status === "sending";
              return (
                <EmailListRow
                  key={c.id}
                  href={`/admin/email/${c.id}`}
                  title={emailListTitle(c.name, c.subject)}
                  subtitle={[
                    STATUS_RU[c.status] ?? c.status,
                    formatAdminDateTime(c.sent_at || c.created_at),
                    emailListSubjectSubtitle(c.name, c.subject),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  showStats={showStats}
                  idleLabel="черновик"
                  stats={
                    showStats
                      ? {
                          sent_count: c.sent_count,
                          delivered_count: c.delivered_count,
                          opened_count: c.opened_count,
                          clicked_count: c.clicked_count,
                          bounced_count: c.bounced_count,
                          complained_count: c.complained_count,
                          unsubscribed_count: c.unsubscribed_count,
                          error_count: c.error_count,
                        }
                      : undefined
                  }
                />
              );
            })}
          </ul>

          {totalPages > 1 || page > 1 ? (
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

export default function AdminEmailListPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </div>
      }
    >
      <EmailCampaignsList />
    </Suspense>
  );
}
