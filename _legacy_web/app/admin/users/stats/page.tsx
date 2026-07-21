"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { countryNameRu } from "../../_lib/countryNamesRu";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { TIER_LABELS } from "../_components/TierBadge";

type Stats = {
  generated_at: string;
  period_days: number;
  grain: "day" | "week";
  total_users: number;
  by_tier: Record<string, number>;
  by_access: Record<string, number>;
  by_country: Array<{ code: string; count: number }>;
  registrations_in_period: number;
  registration_series: Array<{ date: string; count: number }>;
  active_users: { last_24h: number | null; last_72h: number | null; last_168h: number | null };
};

const PERIODS = [7, 30, 90] as const;
const ACCESS_LABELS: Record<string, string> = {
  navigator: "Навигатор",
  trial: "Демо",
  oracle: "Наставник",
  master: "Мастер",
};

export default function AdminUserStatsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    adminFetch<Stats>(`/api/admin/users/stats?days=${days}&grain=${grain}`)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить статистику"));
  }, [days, grain]);

  const maxReg = Math.max(...(stats?.registration_series.map((x) => x.count) ?? [1]), 1);
  const maxCountry = Math.max(...(stats?.by_country.map((x) => x.count) ?? [1]), 1);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={15} /> К списку пользователей
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Статистика пользователей</h1>
          <p className="text-sm text-zinc-500">
            Регистрации, доступ (включая демо), активность и страны. Период и зерно — как на дашборде.
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
            <Card title="Всего пользователей" value={String(stats.total_users)} hint={`Срез: ${formatAdminDateTime(stats.generated_at)}`} />
            <Card title={`Регистрации за ${stats.period_days} дн.`} value={String(stats.registrations_in_period)} hint={grain === "week" ? "Группировка по неделям" : "Группировка по дням"} />
            <Card title="Активность" value={`${stats.active_users.last_24h ?? "—"} / ${stats.active_users.last_72h ?? "—"} / ${stats.active_users.last_168h ?? "—"}`} hint="24ч / 72ч / 168ч" />
          </div>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Доступ сейчас</h2>
            <div className="grid gap-2 sm:grid-cols-4">
              {Object.entries(ACCESS_LABELS).map(([key, label]) => (
                <div key={key} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="text-xl font-bold text-zinc-100">{stats.by_access[key] ?? 0}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Тарифы в БД (сырые)</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(TIER_LABELS).map(([tier, label]) => (
                <div key={tier} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="text-xl font-bold text-zinc-100">{stats.by_tier[tier] ?? 0}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Динамика регистраций</h2>
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {stats.registration_series.length === 0 ? <p className="text-sm text-zinc-500">За выбранный период регистраций не было.</p> : null}
              {stats.registration_series.map((item) => (
                <div key={item.date} className="grid grid-cols-[96px_1fr_32px] items-center gap-3">
                  <div className="text-xs text-zinc-400">{item.date.split("-").reverse().join(".")}</div>
                  <div className="h-2 rounded-full bg-white/5">
                    <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: `${Math.max(6, (item.count / maxReg) * 100)}%` }} />
                  </div>
                  <div className="text-right text-xs text-zinc-300">{item.count}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-100">Страны</h2>
            {stats.by_country.length === 0 ? (
              <p className="text-sm text-zinc-500">Пока нет country_code у пользователей — появится после обновления геолокации в приложении.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {stats.by_country.map((item) => (
                  <div key={item.code} className="grid grid-cols-[140px_1fr_32px] items-center gap-3">
                    <div className="text-xs text-zinc-400">{countryNameRu(item.code)}</div>
                    <div className="h-2 rounded-full bg-white/5">
                      <div className="h-2 rounded-full bg-emerald-400/80" style={{ width: `${Math.max(6, (item.count / maxCountry) * 100)}%` }} />
                    </div>
                    <div className="text-right text-xs text-zinc-300">{item.count}</div>
                  </div>
                ))}
              </div>
            )}
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
