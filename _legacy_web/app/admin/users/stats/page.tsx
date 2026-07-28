"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { countryNameRu } from "../../_lib/countryNamesRu";
import { formatAdminDateTime } from "../../_lib/adminDates";

type Period = 7 | 30 | 90 | "all";

type Stats = {
  generated_at: string;
  period_days: Period;
  range_all_time?: boolean;
  grain: "day" | "week";
  total_users: number;
  by_access: Record<string, number>;
  addon_buyers: { webinar: number; book: number };
  by_country: Array<{ code: string; count: number }>;
  by_locale: Array<{ locale: string; count: number }>;
  registrations_in_period: number;
  registration_series: Array<{ date: string; count: number }>;
  active_users: { last_24h: number | null; last_72h: number | null; last_168h: number | null };
};

/** Одна сетка для полос: подпись / бар / число — выравнивание между блоками. */
const BAR_ROW = "grid grid-cols-[96px_1fr_40px] items-center gap-3";

/** ~10 строк, дальше scrollbar — как на дашборде / payments stats. */
const SCROLL_LIST_CLASS =
  "admin-scroll flex max-h-[11.5rem] flex-col gap-2 overflow-y-auto pr-1";

const LOCALE_LABEL_RU: Record<string, string> = {
  ru: "Русский",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};

function localeLabelRu(code: string): string {
  return LOCALE_LABEL_RU[code] ?? code;
}

const PERIODS: Period[] = [7, 30, 90, "all"];

/** UI order: Демо → Навигатор → Наставник → Мастер */
const ACCESS_ORDER = [
  ["trial", "Демо"],
  ["navigator", "Навигатор"],
  ["oracle", "Наставник"],
  ["master", "Мастер"],
] as const;

function periodLabel(period: Period): string {
  if (period === "all") return "всё время";
  return `${period} дн.`;
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function usersHref(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const q = sp.toString();
  return q ? `/admin/users?${q}` : "/admin/users";
}

function StatNum({
  value,
  href,
}: {
  value: number;
  href?: string | null;
}) {
  if (value > 0 && href) {
    return (
      <Link
        href={href}
        className="text-xl font-bold text-emerald-700 hover:underline"
      >
        {value}
      </Link>
    );
  }
  return <div className="text-xl font-bold text-zinc-900">{value}</div>;
}

export default function AdminUserStatsPage() {
  const [days, setDays] = useState<Period>(30);
  const [grain, setGrain] = useState<"day" | "week">("day");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveGrain: "day" | "week" = days === "all" ? "week" : grain;

  useEffect(() => {
    if (days === "all" && grain !== "week") setGrain("week");
  }, [days, grain]);

  useEffect(() => {
    setStats(null);
    const daysParam = days === "all" ? "all" : String(days);
    adminFetch<Stats>(
      `/api/admin/users/stats?days=${daysParam}&grain=${effectiveGrain}`,
    )
      .then(setStats)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Не удалось загрузить статистику"),
      );
  }, [days, effectiveGrain]);

  const maxReg = Math.max(...(stats?.registration_series.map((x) => x.count) ?? [1]), 1);
  const maxCountry = Math.max(...(stats?.by_country.map((x) => x.count) ?? [1]), 1);
  const maxLocale = Math.max(...(stats?.by_locale?.map((x) => x.count) ?? [1]), 1);
  const period: Period = stats?.range_all_time
    ? "all"
    : ((stats?.period_days as Period) ?? days);
  const periodText = periodLabel(period);
  const periodFrom = period === "all" ? "2000-01-01" : ymdDaysAgo(period);
  const periodTo = todayYmd();
  const periodOnboarded =
    period === "all"
      ? { onboarded_from: "2000-01-01" as string | undefined }
      : {
          onboarded_from: periodFrom,
          onboarded_to: periodTo,
        };

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> К списку пользователей
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">
            Статистика использования Гармонизатора
          </h1>
          <p className="text-sm text-zinc-500">
            Пользователи с регистрацией в Гармонизаторе (onboarded_at), доступ, допы, активность,
            страны и языки за выбранный период. Ненулевые цифры — ссылки на список.
          </p>
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
              title="Всего пользователей"
              hint={`С onboarded_at · срез: ${formatAdminDateTime(stats.generated_at)}`}
            >
              <StatNum
                value={stats.total_users}
                href={usersHref({ onboarded_from: "2000-01-01" })}
              />
            </Card>
            <Card
              title={`Регистрации в Гарм за ${periodText}`}
              hint={
                effectiveGrain === "week" ? "По onboarded_at, недели" : "По onboarded_at, дни"
              }
            >
              <StatNum
                value={stats.registrations_in_period}
                href={usersHref({
                  onboarded_from: periodFrom,
                  onboarded_to: periodTo,
                })}
              />
            </Card>
            <Card title="Активность" hint="24ч / 72ч / 168ч · клик = список">
              <div className="mt-1 flex flex-wrap items-baseline gap-x-1 text-xl font-bold text-zinc-900">
                {(
                  [
                    [stats.active_users.last_24h, 24],
                    [stats.active_users.last_72h, 72],
                    [stats.active_users.last_168h, 168],
                  ] as const
                ).map(([n, hours], i) => (
                  <span key={hours} className="inline-flex items-baseline">
                    {i > 0 ? <span className="mx-1 text-zinc-400">/</span> : null}
                    {typeof n === "number" && n > 0 ? (
                      <Link
                        href={usersHref({ active_hours: String(hours) })}
                        className="text-emerald-700 hover:underline"
                      >
                        {n}
                      </Link>
                    ) : (
                      <span>{n ?? "—"}</span>
                    )}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-900">
              Распределение по тарифам сейчас
            </h2>
            <div className="grid gap-2 sm:grid-cols-4">
              {ACCESS_ORDER.map(([key, label]) => {
                const n = stats.by_access[key] ?? 0;
                return (
                  <div key={key} className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                    <div className="text-xs text-zinc-500">{label}</div>
                    <StatNum
                      value={n}
                      href={usersHref({
                        access: key,
                        onboarded_from: "2000-01-01",
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-900">
              Покупали допов за {periodText}
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              Уникальные пользователи с оплатой разового вебинара или книги (не число продаж).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Вебинар</div>
                <StatNum
                  value={stats.addon_buyers?.webinar ?? 0}
                  href={usersHref({
                    addon: "webinar",
                    addon_since: period === "all" ? undefined : periodFrom,
                  })}
                />
              </div>
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Книга</div>
                <StatNum
                  value={stats.addon_buyers?.book ?? 0}
                  href={usersHref({
                    addon: "book",
                    addon_since: period === "all" ? undefined : periodFrom,
                  })}
                />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-900">
              Динамика регистраций в Гармонизаторе
            </h2>
            <div className={SCROLL_LIST_CLASS}>
              {stats.registration_series.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  За выбранный период регистраций в Гарм не было.
                </p>
              ) : null}
              {stats.registration_series.map((item) => {
                const to =
                  effectiveGrain === "week"
                    ? addDaysYmd(item.date, 6)
                    : item.date;
                return (
                  <div key={item.date} className={BAR_ROW}>
                    <div className="truncate text-xs text-zinc-400">
                      {item.date.split("-").reverse().join(".")}
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100">
                      <div
                        className="h-2 rounded-full bg-emerald-400/80"
                        style={{ width: `${Math.max(6, (item.count / maxReg) * 100)}%` }}
                      />
                    </div>
                    <div className="text-right">
                      {item.count > 0 ? (
                        <Link
                          href={usersHref({
                            onboarded_from: item.date,
                            onboarded_to: to,
                          })}
                          className="text-xs font-semibold text-emerald-700 hover:underline"
                        >
                          {item.count}
                        </Link>
                      ) : (
                        <span className="text-xs text-zinc-700">{item.count}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-900">
              Страны за {periodText}
            </h2>
            {stats.by_country.length === 0 ? (
              <p className="text-sm text-zinc-500">
                За выбранный период нет пользователей с country_code — появится после
                геолокации в приложении.
              </p>
            ) : (
              <div className={SCROLL_LIST_CLASS}>
                {stats.by_country.map((item) => {
                  const name = countryNameRu(item.code);
                  return (
                    <div key={item.code} className={BAR_ROW}>
                      <div className="truncate text-xs text-zinc-400" title={name}>
                        {name}
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100">
                        <div
                          className="h-2 rounded-full bg-emerald-400/80"
                          style={{
                            width: `${Math.max(6, (item.count / maxCountry) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="text-right">
                        {item.count > 0 ? (
                          <Link
                            href={usersHref({
                              country_code: item.code,
                              ...periodOnboarded,
                            })}
                            className="text-xs font-semibold text-emerald-700 hover:underline"
                          >
                            {item.count}
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-700">{item.count}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-bold text-zinc-900">
              Языки за {periodText}
            </h2>
            {(stats.by_locale?.length ?? 0) === 0 ? (
              <p className="text-sm text-zinc-500">
                За выбранный период нет пользователей с locale.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {(stats.by_locale ?? []).map((item) => {
                  const name = localeLabelRu(item.locale);
                  return (
                    <div key={item.locale} className={BAR_ROW}>
                      <div className="truncate text-xs text-zinc-400" title={name}>
                        {name}
                      </div>
                      <div className="h-2 rounded-full bg-zinc-100">
                        <div
                          className="h-2 rounded-full bg-emerald-400/80"
                          style={{
                            width: `${Math.max(6, (item.count / maxLocale) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="text-right">
                        {item.count > 0 ? (
                          <Link
                            href={usersHref({
                              locale: item.locale,
                              ...periodOnboarded,
                            })}
                            className="text-xs font-semibold text-emerald-700 hover:underline"
                          >
                            {item.count}
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-700">{item.count}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="mt-1">{children}</div>
      <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>
    </div>
  );
}
