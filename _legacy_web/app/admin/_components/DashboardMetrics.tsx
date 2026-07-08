"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { TIER_LABELS } from "../users/_components/TierBadge";

type LlmMetrics = {
  dialog_turns?: number;
  avg_latency_ms?: number | null;
  p95_latency_ms?: number | null;
  llm_errors?: number;
  llm_timeouts?: number;
  api_errors?: number;
  prompt_events?: number;
  prompt_tokens?: number;
};

type DashboardData = {
  generated_at: string;
  users: {
    total: number;
    onboarded: number;
    by_tier: Record<string, number>;
    registered_7d: number;
    registered_30d: number;
  };
  activity: { dau: number; wau: number; mau: number; app_opens_7d: number };
  payments: { count_30d: number; sum_30d: number; count_total: number; sum_total: number };
  llm_7d: LlmMetrics;
  llm_30d: LlmMetrics;
};

const numFmt = new Intl.NumberFormat("ru-RU");

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : numFmt.format(value);
}

function errorRate(llm: LlmMetrics): string {
  const turns = llm.dialog_turns ?? 0;
  const errors = (llm.llm_errors ?? 0) + (llm.llm_timeouts ?? 0);
  if (!turns) return "—";
  return `${((errors / turns) * 100).toFixed(1)}%`;
}

export function DashboardMetrics() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ metrics: DashboardData }>("/api/admin/metrics")
      .then(({ metrics }) => setData(metrics))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить метрики"));
  }, []);

  if (error) return <p className="mb-6 text-sm text-red-400">{error}</p>;
  if (!data) {
    return (
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Считаю метрики…
      </p>
    );
  }

  const tiers = Object.entries(TIER_LABELS)
    .map(([tier, label]) => ({ label, count: data.users.by_tier[tier] ?? 0 }))
    .filter((t) => t.count > 0);

  return (
    <div className="mb-8 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Пользователи" value={fmt(data.users.total)}>
          {tiers.map((t) => `${t.label}: ${t.count}`).join(" · ") || "нет данных"}
          <br />
          Онбординг пройден: {fmt(data.users.onboarded)}
        </MetricCard>
        <MetricCard title="Регистрации" value={`+${fmt(data.users.registered_7d)}`}>
          за 7 дней · за 30 дней: +{fmt(data.users.registered_30d)}
        </MetricCard>
        <MetricCard title="Активность" value={`${fmt(data.activity.dau)} / ${fmt(data.activity.wau)} / ${fmt(data.activity.mau)}`}>
          DAU / WAU / MAU · открытий за 7 дней: {fmt(data.activity.app_opens_7d)}
        </MetricCard>
        <MetricCard title="Платежи, 30 дней" value={`${fmt(data.payments.sum_30d)} ₽`}>
          {fmt(data.payments.count_30d)} шт · всего: {fmt(data.payments.sum_total)} ₽ ({fmt(data.payments.count_total)} шт)
        </MetricCard>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LlmCard title="LLM за 7 дней" llm={data.llm_7d} />
        <LlmCard title="LLM за 30 дней" llm={data.llm_30d} />
      </div>
    </div>
  );
}

function MetricCard({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-bold text-zinc-100">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{children}</p>
    </div>
  );
}

function LlmCard({ title, llm }: { title: string; llm: LlmMetrics }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <p className="mb-2 text-xs text-zinc-500">{title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <LlmStat label="Диалоговых ходов" value={fmt(llm.dialog_turns)} />
        <LlmStat label="Латентность avg" value={llm.avg_latency_ms != null ? `${fmt(llm.avg_latency_ms)} мс` : "—"} />
        <LlmStat label="Латентность p95" value={llm.p95_latency_ms != null ? `${fmt(llm.p95_latency_ms)} мс` : "—"} />
        <LlmStat label="Ошибки LLM" value={`${fmt(llm.llm_errors)} (+${fmt(llm.llm_timeouts)} таймаутов)`} />
        <LlmStat label="Error rate" value={errorRate(llm)} />
        <LlmStat label="Промпт-токены" value={fmt(llm.prompt_tokens)} />
      </dl>
    </div>
  );
}

function LlmStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}
