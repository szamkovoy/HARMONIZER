"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { TIER_LABELS } from "../../users/_components/TierBadge";

type Stats = {
  generated_at: string;
  period_days: number;
  count: number;
  total_amount: number;
  currency: string;
  by_tier: Record<string, { count: number; sum: number }>;
  by_source: Record<string, { count: number; sum: number }>;
  daily_series: Array<{ date: string; count: number; sum: number }>;
};

const PERIODS = [7, 30, 90] as const;

export default function AdminPaymentStatsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    adminFetch<Stats>(`/api/admin/payments/stats?days=${days}`)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить статистику"));
  }, [days]);

  const maxSum = Math.max(...(stats?.daily_series.map((x) => x.sum) ?? [1]));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/payments" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={15} /> К списку платежей
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Статистика оплат</h1>
          <p className="text-sm text-zinc-500">Пока без платёжных систем: сумма и количество по дням, тарифам и источникам.</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDays(value)}
              className={`rounded-xl px-3 py-2 text-sm ${days === value ? "bg-emerald-500/90 font-semibold text-emerald-950" : "border border-white/10 text-zinc-300 hover:bg-white/5"}`}
            >
              {value} дн.
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {!stats && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}

      {stats ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card title={`Сумма за ${stats.period_days} дн.`} value={`${stats.total_amount} ${stats.currency}`} hint={`Срез: ${formatAdminDateTime(stats.generated_at)}`} />
            <Card title="Платежей" value={String(stats.count)} hint="Количество строк леджера" />
            <Card title="Источник" value={Object.keys(stats.by_source).join(", ") || "—"} hint="Подготовлено к будущей разбивке по системам" />
          </div>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">По тарифам</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(TIER_LABELS)
                .filter(([tier]) => tier !== "free")
                .map(([tier, label]) => (
                  <div key={tier} className="rounded-lg border border-white/5 bg-black/20 p-3">
                    <div className="text-xs text-zinc-500">{label}</div>
                    <div className="text-lg font-bold text-zinc-100">{stats.by_tier[tier]?.sum ?? 0} {stats.currency}</div>
                    <div className="text-[11px] text-zinc-500">{stats.by_tier[tier]?.count ?? 0} записей</div>
                  </div>
                ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Динамика оплат</h2>
            <div className="flex flex-col gap-2">
              {stats.daily_series.length === 0 ? <p className="text-sm text-zinc-500">За выбранный период оплат не было.</p> : null}
              {stats.daily_series.map((item) => (
                <div key={item.date} className="grid grid-cols-[96px_1fr_90px_44px] items-center gap-3">
                  <div className="text-xs text-zinc-400">{item.date.split("-").reverse().join(".")}</div>
                  <div className="h-2 rounded-full bg-white/5">
                    <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: `${Math.max(6, (item.sum / maxSum) * 100)}%` }} />
                  </div>
                  <div className="text-right text-xs text-zinc-300">{item.sum} {stats.currency}</div>
                  <div className="text-right text-xs text-zinc-500">{item.count}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="mt-1 text-xl font-bold text-zinc-100">{value}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>
    </div>
  );
}
