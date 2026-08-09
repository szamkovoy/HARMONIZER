"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Activity, Loader2, Mail, Plus, Workflow } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";
import {
  emailListSubjectSubtitle,
  emailListTitle,
} from "../../api/_utils/emailNaming";
import { ADMIN_LIST_STACK } from "../_components/AdminListCard";
import { EmailListRow } from "./_components/EmailListRow";
import { useAdminInfiniteScroll } from "../_lib/useAdminInfiniteScroll";

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
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
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
          campaigns: CampaignRow[];
          total: number;
        }>(`/api/admin/email/campaigns?${params}`);
        if (seq !== requestSeq.current) return;
        setCampaigns((prev) => {
          if (mode !== "append" || !prev) return data.campaigns;
          const seen = new Set(prev.map((c) => c.id));
          return [...prev, ...data.campaigns.filter((c) => !seen.has(c.id))];
        });
        setTotal(data.total ?? 0);
        nextPageRef.current = page + 1;
        setError(null);
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить");
          if (mode === "replace") setCampaigns([]);
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
    setCampaigns(null);
    nextPageRef.current = 1;
    void loadPage(1, "replace");
  }, [loadPage]);

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
            segment_query: { all_contacts: true },
          }),
        },
      );
      window.location.href = `/admin/email/${campaign.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Удалить эту рассылку?")) return;
    setDeletingId(id);
    setError(null);
    try {
      await adminFetch(`/api/admin/email/campaigns/${id}`, { method: "DELETE" });
      setCampaigns((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      setTotal((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  const canLoadMore =
    (campaigns?.length ?? 0) < total && !loading && !loadingMore && campaigns !== null;

  const sentinelRef = useAdminInfiniteScroll(canLoadMore, () => {
    void loadPage(nextPageRef.current, "append");
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Рассылки</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">Всего: {total}</p>
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
          <ul className={ADMIN_LIST_STACK}>
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
                  onDelete={() => void handleDelete(c.id)}
                  deleting={deletingId === c.id}
                />
              );
            })}
          </ul>
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
