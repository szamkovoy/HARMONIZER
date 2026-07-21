"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

type Stats = {
  generated_at: string;
  period_days: number;
  grain: "day" | "week";
  lava: {
    count: number;
    primary_currency: string;
    primary_sum: number;
    by_currency: Record<string, { count: number; sum: number }>;
    by_tier: Record<string, { count: number; sum: number }>;
    daily_series: Array<{ date: string; count: number; sum: number }>;
  };
  grants_manual: { count: number; sum: number; currency: string };
};

const PERIODS = [7, 30, 90] as const;
const TIER_LABELS: Record<string, string> = {
  oracle: "Наставник",
  master: "Мастер",
  webinar: "Вебинар",
  book: "Книга",
};

export default function AdminPaymentStatsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    adminFetch<Stats>(`/api/admin/payments/stats?days=${days}&grain=${grain}`)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить статистику"));
  }, [days, grain]);

  const maxSum = Math.max(...(stats?.lava.daily_series.map((x) => x.sum) ?? [1]), 1);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/payments" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={15} /> К списку платежей
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Статистика оплат</h1>
          <p className="text-sm text-zinc-500">
            Основной источник — Lava (`payment_contracts`). Ручные гранты из леджера — отдельно.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <button
            type="button"
            onClick={() => setGrain("day")}
            className={`rounded-xl px-3 py-2 text-sm ${grain === "day" ? "bg-emerald-500/90 font-semibold text-emerald-950" : "border border-white/10 text-zinc-300 hover:bg-white/5"}`}
          >
            Дни
          </button>
          <button
            type="button"
            onClick={() => setGrain("week")}
            className={`rounded-xl px-3 py-2 text-sm ${grain === "week" ? "bg-emerald-500/90 font-semibold text-emerald-950" : "border border-white/10 text-zinc-300 hover:bg-white/5"}`}
          >
            Недели
          </button>
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
            <Card
              title={`Lava за ${stats.period_days} дн.`}
              value={`${stats.lava.primary_sum} ${stats.lava.primary_currency}`}
              hint={`Срез: ${formatAdminDateTime(stats.generated_at)}`}
            />
            <Card title="Контрактов Lava" value={String(stats.lava.count)} hint="active + cancelled (оплаченные)" />
            <Card
              title="Ручные гранты"
              value={`${stats.grants_manual.sum} ${stats.grants_manual.currency}`}
              hint={`${stats.grants_manual.count} записей леджера`}
            />
          </div>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">По валютам (Lava)</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.lava.by_currency).length === 0 ? (
                <p className="text-sm text-zinc-500">Нет оплат Lava за период.</p>
              ) : (
                Object.entries(stats.lava.by_currency).map(([currency, row]) => (
                  <div key={currency} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                    <div className="text-xs text-zinc-500">{currency}</div>
                    <div className="text-lg font-bold text-zinc-100">{row.sum}</div>
                    <div className="text-[11px] text-zinc-500">{row.count} шт</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">По тарифам / продуктам (Lava)</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.keys(TIER_LABELS).map((tier) => (
                <div key={tier} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-zinc-500">{TIER_LABELS[tier]}</div>
                  <div className="text-lg font-bold text-zinc-100">{stats.lava.by_tier[tier]?.sum ?? 0}</div>
                  <div className="text-[11px] text-zinc-500">{stats.lava.by_tier[tier]?.count ?? 0} записей</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Динамика Lava</h2>
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {stats.lava.daily_series.length === 0 ? <p className="text-sm text-zinc-500">За выбранный период оплат не было.</p> : null}
              {stats.lava.daily_series.map((item) => (
                <div key={item.date} className="grid grid-cols-[96px_1fr_90px_44px] items-center gap-3">
                  <div className="text-xs text-zinc-400">{item.date.split("-").reverse().join(".")}</div>
                  <div className="h-2 rounded-full bg-white/5">
                    <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: `${Math.max(6, (item.sum / maxSum) * 100)}%` }} />
                  </div>
                  <div className="text-right text-xs text-zinc-300">{item.sum}</div>
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
