"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { countryNameRu } from "../../_lib/countryNamesRu";
import { formatAdminDateTime } from "../../_lib/adminDates";

type DisplayCurrency = "RUB" | "EUR" | "USD";

type ProviderStats = {
  count: number;
  sum: number;
  currency: string;
  by_tier: Record<string, { count: number; sum: number }>;
  daily_series: Array<{ date: string; count: number; sum: number }>;
};

type Period = 7 | 30 | 90 | "all";

type Stats = {
  generated_at: string;
  period_days: Period;
  range_all_time?: boolean;
  grain: "day" | "week";
  display_currency: DisplayCurrency;
  providers: {
    lavatop: ProviderStats;
    yookassa: ProviderStats;
  };
  by_tier: Record<string, { count: number; sum: number }>;
  by_country: Array<{ code: string; count: number; sum: number }>;
  daily_series: Array<{ date: string; count: number; sum: number }>;
  total: { count: number; sum: number; currency: string };
};

const PERIODS: Period[] = [7, 30, 90, "all"];
const CURRENCIES: Array<{ code: DisplayCurrency; label: string }> = [
  { code: "RUB", label: "₽" },
  { code: "EUR", label: "€" },
  { code: "USD", label: "$" },
];
const TIER_LABELS: Record<string, string> = {
  oracle: "Наставник",
  master: "Мастер",
  webinar: "Вебинар",
  book: "Книга",
};

const SCROLL_LIST_CLASS =
  "admin-scroll flex max-h-[11.5rem] flex-col gap-2 overflow-y-auto pr-1";

function moneyFmt(n: number, currency: DisplayCurrency): string {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "₽";
  return `${new Intl.NumberFormat("ru-RU").format(n)} ${symbol}`;
}

function formatBucket(date: string, grain: "day" | "week"): string {
  const raw = String(date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const [y, m, d] = raw.split("-");
  if (grain === "week") return `нед. ${d}.${m}`;
  return `${d}.${m}.${y?.slice(2) ?? ""}`;
}

function periodLabelOf(period: Period): string {
  if (period === "all") return "всё время";
  return `${period} дн.`;
}

export default function AdminPaymentStatsPage() {
  const [days, setDays] = useState<Period>(7);
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [currency, setCurrency] = useState<DisplayCurrency>("RUB");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveGrain: "day" | "week" = days === "all" ? "week" : grain;

  useEffect(() => {
    if (days === "all" && grain !== "week") setGrain("week");
  }, [days, grain]);

  useEffect(() => {
    setStats(null);
    setError(null);
    const daysParam = days === "all" ? "all" : String(days);
    adminFetch<Stats>(
      `/api/admin/payments/stats?days=${daysParam}&grain=${effectiveGrain}&currency=${currency}`,
    )
      .then(setStats)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Не удалось загрузить статистику"),
      );
  }, [days, effectiveGrain, currency]);

  const displayCurrency = stats?.display_currency ?? currency;
  const period: Period = stats?.range_all_time
    ? "all"
    : ((stats?.period_days as Period) ?? days);
  const periodLabel = periodLabelOf(period);
  const seriesNewestFirst = useMemo(
    () =>
      [...(stats?.daily_series ?? [])].sort((a, b) =>
        String(b.date).localeCompare(String(a.date)),
      ),
    [stats],
  );
  const maxSum = Math.max(1, ...seriesNewestFirst.map((x) => x.sum));
  const countryRows = stats?.by_country ?? [];
  const maxCountry = Math.max(1, ...countryRows.map((x) => x.sum));
  const activeTiers = Object.keys(TIER_LABELS).filter(
    (tier) => (stats?.by_tier[tier]?.sum ?? 0) > 0,
  );

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/payments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> К списку платежей
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Статистика выручки</h1>
          <p className="text-sm text-zinc-500">
            Net после комиссии шлюза и конвертации. Lava.top + ЮКасса.
          </p>
          {stats ? (
            <p className="mt-1 text-xs text-zinc-600">
              Срез: {formatAdminDateTime(stats.generated_at)}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((value) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => setDays(value)}
              className={`rounded-xl px-3 py-2 text-sm ${
                days === value
                  ? "bg-emerald-600 font-semibold text-white"
                  : "border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {value === "all" ? "Всё время" : `${value} дн.`}
            </button>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-zinc-200 sm:inline-block" aria-hidden />
          {(
            [
              ["day", "Дни"],
              ["week", "Недели"],
            ] as const
          ).map(([value, label]) => {
            const disabled = days === "all" && value === "day";
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => setGrain(value)}
                className={`rounded-xl px-3 py-2 text-sm ${
                  disabled
                    ? "cursor-not-allowed border border-zinc-100 text-zinc-400"
                    : effectiveGrain === value
                      ? "bg-emerald-600 font-semibold text-white"
                      : "border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                {label}
              </button>
            );
          })}
          <span className="mx-1 hidden h-6 w-px bg-zinc-200 sm:inline-block" aria-hidden />
          {CURRENCIES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => setCurrency(code)}
              className={`rounded-xl px-3 py-2 text-sm ${
                currency === code
                  ? "bg-emerald-600 font-semibold text-white"
                  : "border border-zinc-200 text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              {label}
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
          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-bold text-zinc-900">
              По тарифам / продуктам за {periodLabel}
            </h2>
            <p className="mb-3 text-[11px] text-zinc-500">Lava.top + ЮКасса</p>
            {activeTiers.length === 0 ? (
              <p className="text-sm text-zinc-500">За выбранный период оплат по продуктам не было.</p>
            ) : (
              <div
                className={`grid gap-2 ${
                  activeTiers.length === 1
                    ? "sm:grid-cols-1"
                    : activeTiers.length === 2
                      ? "sm:grid-cols-2"
                      : activeTiers.length === 3
                        ? "sm:grid-cols-2 lg:grid-cols-3"
                        : "sm:grid-cols-2 lg:grid-cols-4"
                }`}
              >
                {activeTiers.map((tier) => (
                  <div key={tier} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                    <div className="text-xs text-zinc-500">{TIER_LABELS[tier]}</div>
                    <div className="text-lg font-bold text-zinc-900">
                      {moneyFmt(stats.by_tier[tier]?.sum ?? 0, displayCurrency)}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {stats.by_tier[tier]?.count ?? 0} платежей
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <ProviderCard
              title={`Выручка Lava.top за ${periodLabel}`}
              hint="После комиссии Lava 8% и конвертации (Т-Банк или ЦБ)"
              stats={stats.providers.lavatop}
              currency={displayCurrency}
              grain={stats.grain}
              emptyHint="Оплат Lava.top за период нет (или ещё без net-settlement)."
            />
            <ProviderCard
              title={`Выручка ЮКасса за ${periodLabel}`}
              hint="После комиссии ЮКасса 2.5% и конвертации (Т-Банк или ЦБ)"
              stats={stats.providers.yookassa}
              currency={displayCurrency}
              grain={stats.grain}
              emptyHint="Оплат ЮКасса за период нет."
            />
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-bold text-zinc-900">
              Общая динамика выручки за {periodLabel}
            </h2>
            <p className="mb-2 text-[11px] text-zinc-500">Lava.top + ЮКасса</p>
            <p className="mb-3 text-sm text-zinc-800">
              Всего:{" "}
              <span className="font-semibold">{moneyFmt(stats.total.sum, displayCurrency)}</span>
              <span className="ml-2 text-xs text-zinc-500">
                · {stats.total.count} платеж(ей)
              </span>
            </p>
            {seriesNewestFirst.length === 0 ? (
              <p className="text-sm text-zinc-500">За выбранный период оплат не было.</p>
            ) : (
              <div className={SCROLL_LIST_CLASS}>
                {seriesNewestFirst.map((item) => (
                  <BarRow
                    key={item.date}
                    label={formatBucket(item.date, stats.grain)}
                    widthPct={(item.sum / maxSum) * 100}
                    valueLabel={moneyFmt(item.sum, displayCurrency)}
                    count={item.count}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-1 text-sm font-bold text-zinc-900">
              Выручка по странам за {periodLabel}
            </h2>
            <p className="mb-3 text-[11px] text-zinc-500">Lava.top + ЮКасса</p>
            {countryRows.length === 0 ? (
              <p className="text-sm text-zinc-500">
                За период нет оплат или у плательщиков ещё нет country_code.
              </p>
            ) : (
              <div className={SCROLL_LIST_CLASS}>
                {countryRows.map((row) => (
                  <BarRow
                    key={row.code}
                    label={row.code === "??" ? "Неизвестно" : countryNameRu(row.code)}
                    labelTitle={row.code}
                    widthPct={(row.sum / maxCountry) * 100}
                    valueLabel={moneyFmt(row.sum, displayCurrency)}
                    count={row.count}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** Полоска: симметричные отступы label↔bar и bar↔сумма (без широкой пустой колонки суммы). */
function BarRow({
  label,
  labelTitle,
  widthPct,
  valueLabel,
  count,
}: {
  label: string;
  labelTitle?: string;
  widthPct: number;
  valueLabel: string;
  count?: number;
}) {
  const pct = Math.max(widthPct > 0 ? 4 : 0, Math.min(100, widthPct));
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-[4.5rem] shrink-0 truncate text-xs text-zinc-400"
        title={labelTitle ?? label}
      >
        {label}
      </div>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-zinc-100">
        <div
          className="h-2 rounded-full bg-emerald-400/80"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="shrink-0 whitespace-nowrap text-right text-xs text-zinc-700">
        {valueLabel}
      </div>
      {count != null ? (
        <div className="w-5 shrink-0 text-right text-xs text-zinc-500">{count}</div>
      ) : null}
    </div>
  );
}

function ProviderCard({
  title,
  hint,
  stats,
  currency,
  grain,
  emptyHint,
}: {
  title: string;
  hint: string;
  stats: ProviderStats;
  currency: DisplayCurrency;
  grain: "day" | "week";
  emptyHint: string;
}) {
  const series = useMemo(
    () => [...stats.daily_series].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [stats.daily_series],
  );
  const maxSum = Math.max(1, ...series.map((x) => x.sum));
  const tierEntries = Object.entries(stats.by_tier).filter(([, v]) => v.count > 0 || v.sum > 0);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-bold text-zinc-900">{title}</h2>
      <p className="mb-3 text-[11px] text-zinc-500">{hint}</p>
      <p className="mb-2 text-sm text-zinc-800">
        Всего: <span className="font-semibold">{moneyFmt(stats.sum, currency)}</span>
        <span className="ml-2 text-xs text-zinc-500">· {stats.count} платеж(ей)</span>
      </p>
      {stats.count === 0 ? (
        <p className="text-sm text-zinc-500">{emptyHint}</p>
      ) : (
        <>
          <div className={SCROLL_LIST_CLASS}>
            {series.map((item) => (
              <BarRow
                key={item.date}
                label={formatBucket(item.date, grain)}
                widthPct={(item.sum / maxSum) * 100}
                valueLabel={moneyFmt(item.sum, currency)}
              />
            ))}
          </div>
          {tierEntries.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
              {tierEntries.map(([tier, row]) => (
                <span key={tier} className="rounded-full border border-zinc-200 px-2 py-0.5">
                  {TIER_LABELS[tier] ?? tier}: {moneyFmt(row.sum, currency)} ({row.count})
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
