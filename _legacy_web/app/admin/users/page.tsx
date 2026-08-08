"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronRight, Loader2, Search } from "lucide-react";

import {
  ACCESS_FILTER_LABELS_RU,
  isEmailOnlyUser,
  type AccessFilterSeg,
} from "../_lib/accessNow";
import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime, formatUserAccessPeriod } from "../_lib/adminDates";
import { AccessNowBadge, AutoRenewCancelledNote } from "./_components/TierBadge";

type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  last_name?: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  trial_expires_at?: string | null;
  membership_started_at?: string | null;
  created_at: string | null;
  onboarded_at?: string | null;
  last_seen_at?: string | null;
  locale?: string | null;
  country_code?: string | null;
  city?: string | null;
  marketing_status?: string | null;
  auto_renew_cancelled?: boolean;
  crm_imported_at?: string | null;
};

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;

const MARKETING_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Любой статус писем" },
  { value: "active", label: "Получает письма" },
  { value: "unsubscribed", label: "Отписался" },
  { value: "suppressed", label: "Не доставляется" },
  { value: "complained", label: "Пометил как спам" },
];

const ACCESS_FILTER_VALUES: AccessFilterSeg[] = [
  "trial",
  "navigator",
  "oracle",
  "master",
  "not_in_harmonizer",
  "email_only",
];

const ADDON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Любые допы" },
  { value: "webinar", label: "Покупали вебинар" },
  { value: "book", label: "Покупали книгу" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "created_at", label: "Регистрация в системе" },
  { value: "onboarded_at", label: "Регистрация в Гармонизаторе" },
  { value: "tier_end", label: "Окончание тарифа" },
  { value: "last_seen", label: "Последний вход" },
  { value: "last_payment", label: "Последний платёж" },
  { value: "access", label: "Тариф / доступ" },
  { value: "locale", label: "Язык" },
];

const inputCls =
  "rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none";

function UsersList() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [access, setAccess] = useState("");
  const [addon, setAddon] = useState("");
  const [addonSince, setAddonSince] = useState("");
  const [activeHours, setActiveHours] = useState("");
  const [lastSeenWithin, setLastSeenWithin] = useState("");
  const [lastSeenOlder, setLastSeenOlder] = useState("");
  const [locale, setLocale] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [marketingStatus, setMarketingStatus] = useState("");
  const [onboardedFrom, setOnboardedFrom] = useState("");
  const [onboardedTo, setOnboardedTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sort, setSort] = useState("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const hydrated = useRef(false);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setAccess(searchParams.get("access") ?? "");
    setAddon(searchParams.get("addon") ?? "");
    setAddonSince(searchParams.get("addon_since") ?? "");
    setActiveHours(searchParams.get("active_hours") ?? "");
    setLastSeenWithin(searchParams.get("last_seen_within_days") ?? "");
    setLastSeenOlder(searchParams.get("last_seen_older_than_days") ?? "");
    setLocale(searchParams.get("locale") ?? "");
    setCountryCode((searchParams.get("country_code") ?? "").toUpperCase());
    setCity(searchParams.get("city") ?? "");
    setMarketingStatus(searchParams.get("marketing_status") ?? "");
    setOnboardedFrom(searchParams.get("onboarded_from") ?? "");
    setOnboardedTo(searchParams.get("onboarded_to") ?? "");
    setCreatedFrom(searchParams.get("created_from") ?? "");
    setCreatedTo(searchParams.get("created_to") ?? "");
    setSort(searchParams.get("sort") ?? "created_at");
    setOrder(searchParams.get("order") === "asc" ? "asc" : "desc");
    hydrated.current = true;
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!hydrated.current && searchParams.toString()) return;
    const seq = ++requestSeq.current;
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (access) params.set("access", access);
      if (addon) params.set("addon", addon);
      if (addonSince) params.set("addon_since", addonSince);
      const hasSubTier = searchParams.get("has_sub_tier");
      if (hasSubTier === "oracle" || hasSubTier === "master") {
        params.set("has_sub_tier", hasSubTier);
      }
      if (activeHours) params.set("active_hours", activeHours);
      if (lastSeenWithin.trim()) params.set("last_seen_within_days", lastSeenWithin.trim());
      if (lastSeenOlder.trim()) params.set("last_seen_older_than_days", lastSeenOlder.trim());
      if (locale) params.set("locale", locale);
      if (countryCode.trim()) params.set("country_code", countryCode.trim());
      if (city.trim()) params.set("city", city.trim());
      if (marketingStatus) params.set("marketing_status", marketingStatus);
      if (onboardedFrom) params.set("onboarded_from", onboardedFrom);
      if (onboardedTo) params.set("onboarded_to", onboardedTo);
      if (createdFrom) params.set("created_from", createdFrom);
      if (createdTo) params.set("created_to", createdTo);
      if (sort) params.set("sort", sort);
      if (order) params.set("order", order);
      const { users: rows } = await adminFetch<{ users: AdminUserRow[] }>(
        `/api/admin/users?${params}`,
      );
      if (seq === requestSeq.current) {
        setUsers(rows);
        setError(null);
      }
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить пользователей");
      }
    }
  }, [
    query,
    access,
    addon,
    addonSince,
    activeHours,
    lastSeenWithin,
    lastSeenOlder,
    locale,
    countryCode,
    city,
    marketingStatus,
    onboardedFrom,
    onboardedTo,
    createdFrom,
    createdTo,
    sort,
    order,
    searchParams,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Пользователи</h1>
          <p className="text-sm text-zinc-500">
            Поиск и фильтры. Показываются до 100 записей.
            {activeHours
              ? ` · активны за ${activeHours} ч (события в приложении)`
              : ""}
          </p>
        </div>
        <Link
          href="/admin/users/stats"
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          <BarChart3 size={16} />
          Статистика
        </Link>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-zinc-200 bg-white p-3">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или email…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "", label: "Все" },
              ...ACCESS_FILTER_VALUES.map((value) => ({
                value,
                label: ACCESS_FILTER_LABELS_RU[value],
              })),
            ] as const
          ).map((chip) => {
            const on = access === chip.value;
            return (
              <button
                key={chip.value || "all"}
                type="button"
                onClick={() => setAccess(chip.value)}
                className={`rounded-lg px-2.5 py-1 text-xs ${
                  on
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-400">
          Сегменты как в рассылке: «Только рассылки» — импорт из Геткурса без входа в
          приложение; «Не в гармонизаторе» — начал приложение/OTP, онбординг не завершён.
          Активность «был в приложении» — последний вход в Гармонизатор.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={addon}
            onChange={(e) => setAddon(e.target.value)}
            className={inputCls}
          >
            {ADDON_OPTIONS.map((opt) => (
              <option key={opt.value || "any-addon"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={activeHours}
            onChange={(e) => setActiveHours(e.target.value)}
            className={inputCls}
          >
            <option value="">Любая активность (события в приложении)</option>
            <option value="24">Активны за 24 ч</option>
            <option value="72">Активны за 72 ч</option>
            <option value="168">Активны за 168 ч</option>
          </select>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className={inputCls}
          >
            <option value="">Любой язык</option>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {code.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={marketingStatus}
            onChange={(e) => setMarketingStatus(e.target.value)}
            className={inputCls}
          >
            {MARKETING_OPTIONS.map((opt) => (
              <option key={opt.value || "any"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={lastSeenWithin}
            onChange={(e) => setLastSeenWithin(e.target.value)}
            placeholder="Был в приложении ≤ N дней"
            inputMode="numeric"
            className={inputCls}
          />
          <input
            value={lastSeenOlder}
            onChange={(e) => setLastSeenOlder(e.target.value)}
            placeholder="Не заходил в приложение ≥ N дней"
            inputMode="numeric"
            className={inputCls}
          />
          <input
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            placeholder="Страна (код, напр. RU)"
            maxLength={2}
            className={inputCls}
          />
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Город…"
            className={inputCls}
          />
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-zinc-500">
              Регистрация в Гармонизаторе
            </legend>
            <div className="flex gap-2">
              <input
                type="date"
                value={onboardedFrom}
                onChange={(e) => setOnboardedFrom(e.target.value)}
                className={`${inputCls} flex-1`}
              />
              <input
                type="date"
                value={onboardedTo}
                onChange={(e) => setOnboardedTo(e.target.value)}
                className={`${inputCls} flex-1`}
              />
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-zinc-500">
              Регистрация в системе
            </legend>
            <div className="flex gap-2">
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className={`${inputCls} flex-1`}
              />
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className={`${inputCls} flex-1`}
              />
            </div>
          </fieldset>
        </div>

        <div className="grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className={inputCls}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Сортировка: {opt.label}
              </option>
            ))}
          </select>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value === "asc" ? "asc" : "desc")}
            className={inputCls}
          >
            <option value="desc">По убыванию</option>
            <option value="asc">По возрастанию</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {users === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {users?.length === 0 ? <p className="text-sm text-zinc-500">Никого не нашлось.</p> : null}

      <div className="flex flex-col gap-3">
        {users?.map((user) => {
          const period = formatUserAccessPeriod(
            user.onboarded_at || user.created_at,
            user.membership_expires_at,
            user.membership_tier,
            user.trial_expires_at,
            user.membership_started_at,
          );
          const seenAt = user.last_seen_at;
          return (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors hover:border-emerald-400/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-900">
                    {user.display_name?.trim() || "Без имени"}
                  </span>
                  {isEmailOnlyUser(user) ? (
                    <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      Только рассылки
                    </span>
                  ) : !user.onboarded_at ? (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                      Не в гармонизаторе
                    </span>
                  ) : (
                    <>
                      <AccessNowBadge
                        membershipTier={user.membership_tier}
                        membershipExpiresAt={user.membership_expires_at}
                        trialExpiresAt={user.trial_expires_at}
                      />
                      <AutoRenewCancelledNote show={user.auto_renew_cancelled} />
                    </>
                  )}
                  {user.onboarded_at && period ? (
                    <span className="text-[11px] text-zinc-500">{period}</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                  <span className="truncate">{user.email ?? "—"}</span>
                  <span>
                    {seenAt
                      ? `заходил: ${formatAdminDateTime(seenAt)}`
                      : "не заходил"}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-zinc-600" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      }
    >
      <UsersList />
    </Suspense>
  );
}
