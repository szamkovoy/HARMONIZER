"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronRight, Loader2, Search } from "lucide-react";

import {
  TIER_LABELS_RU,
  VISIBLE_PRODUCT_TIERS,
} from "@/modules/access/core/tiers";

import { adminFetch } from "../_lib/adminApi";
import { formatUserAccessPeriod } from "../_lib/adminDates";
import { AccessNowBadge } from "./_components/TierBadge";

type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  trial_expires_at?: string | null;
  created_at: string | null;
  onboarded_at?: string | null;
  locale?: string | null;
  country_code?: string | null;
  city?: string | null;
  marketing_status?: string | null;
};

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;

const MARKETING_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Любой статус писем" },
  { value: "active", label: "Получает письма" },
  { value: "unsubscribed", label: "Отписался" },
  { value: "suppressed", label: "Не доставляется" },
  { value: "complained", label: "Пометил как спам" },
];

const ACCESS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Любой доступ сейчас" },
  { value: "trial", label: "Демо" },
  { value: "navigator", label: "Навигатор" },
  { value: "oracle", label: "Наставник" },
  { value: "master", label: "Мастер" },
];

const ADDON_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Любые допы" },
  { value: "webinar", label: "Покупали вебинар" },
  { value: "book", label: "Покупали книгу" },
];

const inputCls =
  "rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none";

function UsersList() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  const [access, setAccess] = useState("");
  const [addon, setAddon] = useState("");
  const [addonSince, setAddonSince] = useState("");
  const [activeHours, setActiveHours] = useState("");
  const [locale, setLocale] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [city, setCity] = useState("");
  const [marketingStatus, setMarketingStatus] = useState("");
  const [onboardedFrom, setOnboardedFrom] = useState("");
  const [onboardedTo, setOnboardedTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const hydrated = useRef(false);

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
    setTier(searchParams.get("tier") ?? "");
    setAccess(searchParams.get("access") ?? "");
    setAddon(searchParams.get("addon") ?? "");
    setAddonSince(searchParams.get("addon_since") ?? "");
    setActiveHours(searchParams.get("active_hours") ?? "");
    setLocale(searchParams.get("locale") ?? "");
    setCountryCode((searchParams.get("country_code") ?? "").toUpperCase());
    setCity(searchParams.get("city") ?? "");
    setMarketingStatus(searchParams.get("marketing_status") ?? "");
    setOnboardedFrom(searchParams.get("onboarded_from") ?? "");
    setOnboardedTo(searchParams.get("onboarded_to") ?? "");
    setCreatedFrom(searchParams.get("created_from") ?? "");
    setCreatedTo(searchParams.get("created_to") ?? "");
    hydrated.current = true;
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!hydrated.current && searchParams.toString()) return;
    const seq = ++requestSeq.current;
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (tier) params.set("tier", tier);
      if (access) params.set("access", access);
      if (addon) params.set("addon", addon);
      if (addonSince) params.set("addon_since", addonSince);
      if (activeHours) params.set("active_hours", activeHours);
      if (locale) params.set("locale", locale);
      if (countryCode.trim()) params.set("country_code", countryCode.trim());
      if (city.trim()) params.set("city", city.trim());
      if (marketingStatus) params.set("marketing_status", marketingStatus);
      if (onboardedFrom) params.set("onboarded_from", onboardedFrom);
      if (onboardedTo) params.set("onboarded_to", onboardedTo);
      if (createdFrom) params.set("created_from", createdFrom);
      if (createdTo) params.set("created_to", createdTo);
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
    tier,
    access,
    addon,
    addonSince,
    activeHours,
    locale,
    countryCode,
    city,
    marketingStatus,
    onboardedFrom,
    onboardedTo,
    createdFrom,
    createdTo,
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

        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value)}
            className={inputCls}
          >
            {ACCESS_OPTIONS.map((opt) => (
              <option key={opt.value || "any-access"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className={inputCls}
            title="Сырое поле membership_tier в БД (free = Навигатор). Демо — не тариф, а trial: фильтр «Демо» слева."
          >
            <option value="">Тариф в БД (сырой)</option>
            {VISIBLE_PRODUCT_TIERS.map((value) => (
              <option key={value} value={value}>
                {TIER_LABELS_RU[value]}
              </option>
            ))}
          </select>
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
            <option value="">Любая активность</option>
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
          <select
            value={marketingStatus}
            onChange={(e) => setMarketingStatus(e.target.value)}
            className={`${inputCls} sm:col-span-2`}
          >
            {MARKETING_OPTIONS.map((opt) => (
              <option key={opt.value || "any"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2">
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-zinc-500">
              Регистрация в Гарм (onboarded)
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
              Регистрация в БД (created)
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
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {users === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {users?.length === 0 ? <p className="text-sm text-zinc-500">Никого не нашлось.</p> : null}

      <div className="flex flex-col gap-3">
        {users?.map((user) => (
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
                <AccessNowBadge
                  membershipTier={user.membership_tier}
                  membershipExpiresAt={user.membership_expires_at}
                  trialExpiresAt={user.trial_expires_at}
                />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                <span className="truncate">{user.email ?? "—"}</span>
                {formatUserAccessPeriod(
                  user.created_at,
                  user.membership_expires_at,
                  user.membership_tier,
                  user.trial_expires_at,
                ) ? (
                  <span>
                    {formatUserAccessPeriod(
                      user.created_at,
                      user.membership_expires_at,
                      user.membership_tier,
                      user.trial_expires_at,
                    )}
                  </span>
                ) : null}
              </div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-zinc-600" />
          </Link>
        ))}
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
