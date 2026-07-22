"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { countryNameRu } from "../_lib/countryNamesRu";
import { formatAdminDateTime } from "../_lib/adminDates";

type RangeKey = 7 | 30 | 90 | "all";
type Grain = "day" | "week";
type DisplayCurrency = "RUB" | "EUR" | "USD";

type SeriesPoint = { bucket: string; count: number };
type RevenuePoint = { bucket: string; currency: string; sum: number; count: number };
type TokenPoint = { bucket: string; tokens: number };

type DashboardPayload = {
  generated_at: string;
  range_days: number;
  range_all_time?: boolean;
  grain: string;
  alerts: Array<{ id: string; severity: "warn" | "critical"; title: string; detail: string }>;
  kpi: {
    users_total: number;
    reg_period: number;
    reg_prev_period: number;
    active_24h: number;
    active_7d: number;
    active_period: number;
    access_now: { navigator: number; trial: number; oracle: number; master: number };
    cohort: { reg_total: number; bought_oracle: number; bought_master: number };
    renew_m2: {
      oracle_pct: number | null;
      master_pct: number | null;
      oracle_eligible: number;
      master_eligible: number;
    };
    revenue_lava: Array<{ currency: string; sum: number; count: number }>;
    revenue_lava_net?: { currency: string; sum: number; count: number };
    revenue_yookassa_net?: { currency: string; sum: number; count: number };
    revenue_gateways_net?: { currency: string; sum: number; count: number };
    grants_manual: { sum: number; count: number };
  };
  display_currency?: DisplayCurrency;
  funnels: { oracle: number[]; master: number[] };
  series: {
    registrations: SeriesPoint[];
    active_users: SeriesPoint[];
    revenue: RevenuePoint[];
    revenue_yookassa?: RevenuePoint[];
    tokens?: TokenPoint[];
  };
  revenue_by_tier: Array<{ tier: string; sum: number; count: number }>;
  revenue_by_tier_yookassa?: Array<{ tier: string; sum: number; count: number }>;
  load: {
    llm_24h: LlmSlice;
    llm_period: LlmSlice;
    top_users_tokens_24h: Array<{ user_id: string; display_name: string | null; tokens: number }>;
  };
  geo: { by_country: Array<{ code: string; count: number }> };
  meta: { partial: string[] };
};

type LlmSlice = {
  dialog_turns?: number;
  llm_errors?: number;
  llm_timeouts?: number;
  prompt_tokens?: number;
  avg_latency_ms?: number | null;
};

const numFmt = new Intl.NumberFormat("ru-RU");

const TIER_REV_LABELS: Record<string, string> = {
  oracle: "Наставник",
  master: "Мастер",
  webinar: "Вебинар",
  book: "Книга",
};

const SCROLL_LIST_CLASS =
  "admin-scroll flex max-h-[11.5rem] flex-col gap-2 overflow-y-auto pr-1";

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return numFmt.format(Number(n));
}

function moneyFmt(n: number | null | undefined, currency: DisplayCurrency): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "₽";
  return `${numFmt.format(Number(n))} ${symbol}`;
}

function formatBucket(bucket: string, grain: Grain): string {
  const raw = String(bucket).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const [y, m, d] = raw.split("-");
  if (grain === "week") return `нед. ${d}.${m}`;
  return `${d}.${m}.${y?.slice(2) ?? ""}`;
}

function SoonBadge() {
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
      скоро
    </span>
  );
}

export function DashboardPulse() {
  const [range, setRange] = useState<RangeKey>(7);
  const [grain, setGrain] = useState<Grain>("day");
  const [currency, setCurrency] = useState<DisplayCurrency>("RUB");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveGrain: Grain = range === "all" ? "week" : grain;
  const displayCurrency = data?.display_currency ?? currency;

  useEffect(() => {
    if (range === "all" && grain !== "week") setGrain("week");
  }, [range, grain]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const rangeParam = range === "all" ? "all" : String(range);
    adminFetch<DashboardPayload>(
      `/api/admin/dashboard?range=${rangeParam}&grain=${effectiveGrain}&currency=${currency}`,
    )
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить дашборд");
      });
    return () => {
      cancelled = true;
    };
  }, [range, effectiveGrain, currency]);

  const periodLabel = data?.range_all_time ? "всё время" : `${data?.range_days ?? "—"} дн.`;

  const maxReg = useMemo(
    () => Math.max(1, ...(data?.series.registrations.map((x) => x.count) ?? [1])),
    [data],
  );
  const maxActive = useMemo(
    () => Math.max(1, ...(data?.series.active_users.map((x) => x.count) ?? [1])),
    [data],
  );
  const revenueByBucket = useMemo(() => {
    return [...(data?.series.revenue ?? [])]
      .sort((a, b) => String(b.bucket).localeCompare(String(a.bucket)))
      .map((row) => ({ bucket: row.bucket, sum: Number(row.sum) || 0 }));
  }, [data]);
  const yukassaByBucket = useMemo(() => {
    return [...(data?.series.revenue_yookassa ?? [])]
      .sort((a, b) => String(b.bucket).localeCompare(String(a.bucket)))
      .map((row) => ({ bucket: row.bucket, sum: Number(row.sum) || 0 }));
  }, [data]);
  const maxRevenue = Math.max(1, ...revenueByBucket.map((x) => x.sum));
  const maxYukassaRevenue = Math.max(1, ...yukassaByBucket.map((x) => x.sum));
  const lavaTotal = data?.kpi.revenue_lava_net?.sum ?? 0;
  const yukassaTotal = data?.kpi.revenue_yookassa_net?.sum ?? 0;
  const gatewaysTotal =
    data?.kpi.revenue_gateways_net?.sum ?? lavaTotal + yukassaTotal;
  const gatewaysCount =
    data?.kpi.revenue_gateways_net?.count ??
    (data?.kpi.revenue_lava_net?.count ?? 0) + (data?.kpi.revenue_yookassa_net?.count ?? 0);

  const tokenSeries = useMemo(() => {
    return [...(data?.series.tokens ?? [])].sort((a, b) =>
      String(b.bucket).localeCompare(String(a.bucket)),
    );
  }, [data]);
  const maxTokens = Math.max(1, ...tokenSeries.map((x) => Number(x.tokens) || 0));
  const topTokenUsers = useMemo(() => {
    return [...(data?.load.top_users_tokens_24h ?? [])]
      .sort((a, b) => Number(b.tokens) - Number(a.tokens))
      .slice(0, 3);
  }, [data]);

  const access = data?.kpi.access_now;
  const geoEmpty = (data?.geo.by_country.length ?? 0) === 0;
  const tokensSparse = (data?.meta.partial ?? []).includes("top_tokens_sparse");
  const alerts = (data?.alerts ?? []).filter((a) => a.id !== "support_open");

  if (error) return <p className="mb-6 text-sm text-red-400">{error}</p>;
  if (!data) {
    return (
      <p className="mb-6 flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загружаю…
      </p>
    );
  }

  const cohort = data.kpi.cohort;

  return (
    <div className="mb-2 flex flex-col gap-4">
      {alerts.length > 0 ? (
        <section className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`rounded-xl border px-3 py-2 text-sm ${
                alert.severity === "critical"
                  ? "border-red-400/40 bg-red-500/10 text-red-100"
                  : "border-amber-400/30 bg-amber-500/10 text-amber-100"
              }`}
            >
              <div className="font-semibold">{alert.title}</div>
              <div className="text-xs opacity-80">{alert.detail}</div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">Срез: {formatAdminDateTime(data.generated_at)}</p>
        <div className="flex flex-wrap gap-2">
          {([7, 30, 90, "all"] as const).map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setRange(value)}
              className={`rounded-xl px-3 py-1.5 text-sm ${
                range === value
                  ? "bg-emerald-500/90 font-semibold text-emerald-950"
                  : "border border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {value === "all" ? "Всё время" : `${value} дн.`}
            </button>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-white/10 sm:inline-block" />
          {([
            ["day", "Дни"],
            ["week", "Недели"],
          ] as const).map(([value, label]) => {
            const disabled = range === "all" && value === "day";
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => setGrain(value)}
                className={`rounded-xl px-3 py-1.5 text-sm ${
                  disabled
                    ? "cursor-not-allowed border border-white/5 text-zinc-600"
                    : effectiveGrain === value
                      ? "bg-emerald-500/90 font-semibold text-emerald-950"
                      : "border border-white/10 text-zinc-300 hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            );
          })}
          <span className="mx-1 hidden h-6 w-px bg-white/10 sm:inline-block" />
          {([
            ["RUB", "₽"],
            ["EUR", "€"],
            ["USD", "$"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setCurrency(value)}
              className={`rounded-xl px-3 py-1.5 text-sm ${
                currency === value
                  ? "bg-emerald-500/90 font-semibold text-emerald-950"
                  : "border border-white/10 text-zinc-300 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          title="Пользователи"
          value={`${fmt(data.kpi.users_total)} / ${fmt(data.kpi.active_24h)} / ${fmt(data.kpi.active_7d)}`}
          hint="всего / заходили за 24ч / за 7 дн."
        />
        <Kpi
          title="Распределение по тарифам"
          value={`${fmt(access?.trial)} / ${fmt(access?.navigator)} / ${fmt(access?.oracle)} / ${fmt(access?.master)}`}
          hint="Демо / Навигатор / Наставник / Мастер · сейчас"
        />
        <Kpi
          title={`Конверсия за ${periodLabel}`}
          value={`${fmt(cohort?.reg_total)} / ${fmt(cohort?.bought_oracle)} / ${fmt(cohort?.bought_master)}`}
          hint="регистрации / купили Наставник / купили Мастер"
        />
        <Kpi
          title="Выручка"
          value={moneyFmt(gatewaysTotal, displayCurrency)}
          hint={`${fmt(gatewaysCount)} платеж(ей) · Lava.top + ЮКасса · за ${periodLabel}`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title={`Регистрации за ${periodLabel}`}>
          <p className="mb-2 text-sm text-zinc-200">
            Всего: <span className="font-semibold">{fmt(data.kpi.reg_period)}</span>
          </p>
          <BarList
            items={data.series.registrations.map((row) => ({
              key: row.bucket,
              label: formatBucket(row.bucket, effectiveGrain),
              value: row.count,
              widthPct: (row.count / maxReg) * 100,
            }))}
            empty="За период регистраций не было."
          />
        </ChartCard>
        <ChartCard title={`Активность пользователей за ${periodLabel}`}>
          <p className="mb-2 text-sm text-zinc-200">
            Всего уникальных: <span className="font-semibold">{fmt(data.kpi.active_period)}</span>
          </p>
          <BarList
            items={data.series.active_users.map((row) => ({
              key: row.bucket,
              label: formatBucket(row.bucket, effectiveGrain),
              value: row.count,
              widthPct: (row.count / maxActive) * 100,
            }))}
            empty="За период активности в логе не было."
          />
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title={`Выручка Lava.top за ${periodLabel}`}
          hint="После комиссии Lava 8% и конвертации (Т-Банк или ЦБ)"
        >
          <p className="mb-2 text-sm text-zinc-200">
            Всего:{" "}
            <span className="font-semibold">{moneyFmt(lavaTotal, displayCurrency)}</span>
            <span className="ml-2 text-xs text-zinc-500">
              · {fmt(data.kpi.revenue_lava_net?.count ?? 0)} платеж(ей)
            </span>
          </p>
          {revenueByBucket.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Оплат Lava.top за период нет (или ещё без net-settlement).
            </p>
          ) : (
            <BarList
              items={revenueByBucket.map((row) => ({
                key: row.bucket,
                label: formatBucket(row.bucket, effectiveGrain),
                value: row.sum,
                widthPct: (row.sum / maxRevenue) * 100,
                valueLabel: moneyFmt(row.sum, displayCurrency),
              }))}
              empty="Оплат Lava.top за период нет."
            />
          )}
          {(data.revenue_by_tier?.length ?? 0) > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
              {data.revenue_by_tier.map((row) => (
                <span key={row.tier} className="rounded-full border border-white/10 px-2 py-0.5">
                  {TIER_REV_LABELS[row.tier] ?? row.tier}: {moneyFmt(row.sum, displayCurrency)} (
                  {fmt(row.count)})
                </span>
              ))}
            </div>
          ) : null}
        </ChartCard>

        <ChartCard
          title={`Выручка ЮКасса за ${periodLabel}`}
          hint="После комиссии ЮКасса 2.5% и конвертации (Т-Банк или ЦБ)"
        >
          <p className="mb-2 text-sm text-zinc-200">
            Всего:{" "}
            <span className="font-semibold">{moneyFmt(yukassaTotal, displayCurrency)}</span>
            <span className="ml-2 text-xs text-zinc-500">
              · {fmt(data.kpi.revenue_yookassa_net?.count ?? 0)} платеж(ей)
            </span>
          </p>
          {yukassaByBucket.length === 0 ? (
            <p className="text-sm text-zinc-500">Оплат ЮКасса за период нет.</p>
          ) : (
            <BarList
              items={yukassaByBucket.map((row) => ({
                key: row.bucket,
                label: formatBucket(row.bucket, effectiveGrain),
                value: row.sum,
                widthPct: (row.sum / maxYukassaRevenue) * 100,
                valueLabel: moneyFmt(row.sum, displayCurrency),
              }))}
              empty="Оплат ЮКасса за период нет."
            />
          )}
          {(data.revenue_by_tier_yookassa?.length ?? 0) > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
              {data.revenue_by_tier_yookassa!.map((row) => (
                <span key={row.tier} className="rounded-full border border-white/10 px-2 py-0.5">
                  {TIER_REV_LABELS[row.tier] ?? row.tier}: {moneyFmt(row.sum, displayCurrency)} (
                  {fmt(row.count)})
                </span>
              ))}
            </div>
          ) : null}
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Нагрузка LLM"
          badge={tokensSparse ? <SoonBadge /> : null}
          hint="Ошибки и таймауты — недоступность LLM API за сутки. Остальное приложение — в Sentry."
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Stat label="Ошибки LLM за 24ч" value={fmt(data.load.llm_24h.llm_errors)} />
            <Stat label="Таймауты за 24ч" value={fmt(data.load.llm_24h.llm_timeouts)} />
            <Stat
              label="Среднее время ответа"
              value={
                data.load.llm_period.avg_latency_ms != null
                  ? `${fmt(data.load.llm_period.avg_latency_ms)} мс`
                  : "—"
              }
            />
            <Stat label={`Токены за ${periodLabel}`} value={fmt(data.load.llm_period.prompt_tokens)} />
          </dl>
          {tokenSeries.length > 0 ? (
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="mb-2 text-xs text-zinc-500">
                Токены по {effectiveGrain === "week" ? "неделям" : "дням"}
              </p>
              <TokenBars
                items={tokenSeries.map((row) => ({
                  key: String(row.bucket),
                  label: formatBucket(String(row.bucket), effectiveGrain),
                  tokens: Number(row.tokens) || 0,
                }))}
                maxTokens={maxTokens}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">Серия токенов появится после диалогов.</p>
          )}
          <div className="mt-3 border-t border-white/5 pt-3">
            <p className="mb-2 text-xs text-zinc-500">Топ-3 по токенам за 24ч</p>
            {topTokenUsers.length === 0 ? (
              <p className="text-xs text-zinc-500">Пока нет данных.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-xs text-zinc-300">
                {topTokenUsers.map((u, index) => (
                  <li key={u.user_id} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                          index === 0
                            ? "bg-amber-400/20 text-amber-200"
                            : index === 1
                              ? "bg-zinc-300/15 text-zinc-200"
                              : "bg-orange-500/15 text-orange-200"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <Link
                        href={`/admin/users/${u.user_id}`}
                        className="truncate text-emerald-300 hover:underline"
                      >
                        {u.display_name?.trim() || u.user_id.slice(0, 8)}
                      </Link>
                    </div>
                    <span className="shrink-0 text-zinc-400">~{fmt(u.tokens)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ChartCard>

        <ChartCard title={`Страны за ${periodLabel}`} hint="Среди новых регистраций за период">
          {geoEmpty ? (
            <p className="text-sm text-zinc-500">За выбранный период стран пока нет.</p>
          ) : (
            <BarList
              items={data.geo.by_country.map((row) => {
                const max = Math.max(1, ...data.geo.by_country.map((x) => x.count));
                return {
                  key: row.code,
                  label: countryNameRu(row.code),
                  value: row.count,
                  widthPct: (row.count / max) * 100,
                };
              })}
              empty="Нет данных по странам."
            />
          )}
          <div className="mt-3 text-[11px] text-zinc-500">
            Подробнее:{" "}
            <Link href="/admin/users/stats" className="text-emerald-300 hover:underline">
              статистика пользователей
            </Link>
            {" · "}
            <Link href="/admin/payments/stats" className="text-emerald-300 hover:underline">
              статистика выручки
            </Link>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <FunnelCard title="Воронка Наставник" months={data.funnels?.oracle ?? []} />
        <FunnelCard title="Воронка Мастер" months={data.funnels?.master ?? []} />
      </div>
    </div>
  );
}

function Kpi({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <p className="text-xs text-zinc-500">{title}</p>
      <p className="mt-1 text-xl font-bold text-zinc-100">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{hint}</p>
    </div>
  );
}

function ChartCard({
  title,
  children,
  badge,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  badge?: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
        {badge}
      </div>
      {hint ? <p className="mb-2 text-[11px] text-zinc-500">{hint}</p> : null}
      {children}
    </section>
  );
}

function FunnelCard({ title, months }: { title: string; months: number[] }) {
  const values = [...months];
  while (values.length < 7) values.push(0);
  const m1 = values[0] || 0;
  const max = Math.max(1, m1);
  return (
    <ChartCard title={title} hint="Все успешные подписки · мес. 1 → 7 (число платежей у пользователя)">
      <div className="flex flex-col gap-2.5">
        {values.slice(0, 7).map((count, idx) => {
          const pctOfM1 = m1 > 0 ? Math.round((count / m1) * 1000) / 10 : 0;
          const widthPct = Math.max(count ? 8 : 0, (count / max) * 100);
          return (
            <div key={idx} className="flex flex-col items-center gap-1">
              <div className="flex w-full items-center justify-between text-[11px] text-zinc-400">
                <span>{idx + 1}-й месяц</span>
                <span className="text-zinc-300">
                  {fmt(count)}
                  {m1 > 0 ? <span className="text-zinc-500"> · {pctOfM1}%</span> : null}
                </span>
              </div>
              <div className="flex h-3 w-full items-center justify-center">
                <div
                  className="h-3 rounded-md bg-emerald-400/75"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {m1 === 0 ? <p className="mt-2 text-sm text-zinc-500">Пока нет оплат подписки.</p> : null}
    </ChartCard>
  );
}

function BarList({
  items,
  empty,
}: {
  items: Array<{ key: string; label: string; value: number; widthPct: number; valueLabel?: string }>;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <div className={SCROLL_LIST_CLASS}>
      {items.map((item) => {
        const pct = Math.max(item.value ? 4 : 0, Math.min(100, item.widthPct));
        return (
          <div key={item.key} className="flex items-center gap-2">
            <div className="w-[4.5rem] shrink-0 truncate text-xs text-zinc-400" title={item.label}>
              {item.label}
            </div>
            <div className="h-2 min-w-0 flex-1 rounded-full bg-white/5">
              <div
                className="h-2 rounded-full bg-emerald-400/80"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="shrink-0 whitespace-nowrap text-right text-xs text-zinc-300">
              {item.valueLabel ?? item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Вертикальные столбцы для серии токенов (высота в px — % от flex-колонки не работает). */
function TokenBars({
  items,
  maxTokens,
}: {
  items: Array<{ key: string; label: string; tokens: number }>;
  maxTokens: number;
}) {
  const BAR_MAX_PX = 80;
  // Показываем хронологически слева→направо (старые слева).
  const ordered = [...items].reverse();
  return (
    <div className="admin-scroll overflow-x-auto pb-1">
      <div className="flex min-w-full items-end gap-1.5 px-0.5">
        {ordered.map((item) => {
          const hPx =
            item.tokens > 0
              ? Math.max(8, Math.round((item.tokens / maxTokens) * BAR_MAX_PX))
              : 2;
          return (
            <div key={item.key} className="flex min-w-[2.25rem] flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-zinc-400">{fmt(item.tokens)}</span>
              <div className="flex h-20 w-full max-w-[1.75rem] items-end justify-center">
                <div
                  className="w-full rounded-t bg-emerald-400/80"
                  style={{ height: `${hPx}px` }}
                  title={`${item.label}: ${fmt(item.tokens)}`}
                />
              </div>
              <span className="truncate text-[10px] text-zinc-500">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}
