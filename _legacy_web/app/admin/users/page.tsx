"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronRight, Loader2, Plus, Search } from "lucide-react";

import {
  ACCESS_FILTER_LABELS_RU,
  isEmailOnlyUser,
  type AccessFilterSeg,
} from "../_lib/accessNow";
import { adminFetch } from "../_lib/adminApi";
import {
  formatAccessPeriodHeader,
  formatAdminDateTime,
} from "../_lib/adminDates";
import { countryNameRu } from "../_lib/countryNamesRu";
import { AccessNowBadge, AutoRenewCancelledNote } from "./_components/TierBadge";
import { AddUserModal } from "./_components/AddUserModal";

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
  getcourse_last_activity_at?: string | null;
  current_period_end?: string | null;
  subscription_status?: "active" | "cancelled" | null;
};

type Filters = {
  query: string;
  access: string;
  addon: string;
  addonSince: string;
  activeHours: string;
  lastSeenWithin: string;
  lastSeenOlder: string;
  locale: string;
  countryCode: string;
  city: string;
  marketingStatus: string;
  onboardedFrom: string;
  onboardedTo: string;
  createdFrom: string;
  createdTo: string;
  sort: string;
  order: "asc" | "desc";
  hasSubTier: string;
};

const PAGE_SIZE = 50;

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

const EMPTY_FILTERS: Filters = {
  query: "",
  access: "",
  addon: "",
  addonSince: "",
  activeHours: "",
  lastSeenWithin: "",
  lastSeenOlder: "",
  locale: "",
  countryCode: "",
  city: "",
  marketingStatus: "",
  onboardedFrom: "",
  onboardedTo: "",
  createdFrom: "",
  createdTo: "",
  sort: "created_at",
  order: "desc",
  hasSubTier: "",
};

function filtersFromSearchParams(sp: URLSearchParams): Filters {
  return {
    query: sp.get("q") ?? "",
    access: sp.get("access") ?? "",
    addon: sp.get("addon") ?? "",
    addonSince: sp.get("addon_since") ?? "",
    activeHours: sp.get("active_hours") ?? "",
    lastSeenWithin: sp.get("last_seen_within_days") ?? "",
    lastSeenOlder: sp.get("last_seen_older_than_days") ?? "",
    locale: sp.get("locale") ?? "",
    countryCode: (sp.get("country_code") ?? "").toUpperCase(),
    city: sp.get("city") ?? "",
    marketingStatus: sp.get("marketing_status") ?? "",
    onboardedFrom: sp.get("onboarded_from") ?? "",
    onboardedTo: sp.get("onboarded_to") ?? "",
    createdFrom: sp.get("created_from") ?? "",
    createdTo: sp.get("created_to") ?? "",
    sort: sp.get("sort") ?? "created_at",
    order: sp.get("order") === "asc" ? "asc" : "desc",
    hasSubTier:
      sp.get("has_sub_tier") === "oracle" || sp.get("has_sub_tier") === "master"
        ? sp.get("has_sub_tier")!
        : "",
  };
}

function buildQueryParams(f: Filters, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (f.query.trim()) params.set("q", f.query.trim());
  if (f.access) params.set("access", f.access);
  if (f.addon) params.set("addon", f.addon);
  if (f.addonSince) params.set("addon_since", f.addonSince);
  if (f.hasSubTier === "oracle" || f.hasSubTier === "master") {
    params.set("has_sub_tier", f.hasSubTier);
  }
  if (f.activeHours) params.set("active_hours", f.activeHours);
  if (f.lastSeenWithin.trim()) params.set("last_seen_within_days", f.lastSeenWithin.trim());
  if (f.lastSeenOlder.trim()) params.set("last_seen_older_than_days", f.lastSeenOlder.trim());
  if (f.locale) params.set("locale", f.locale);
  if (f.countryCode.trim()) params.set("country_code", f.countryCode.trim());
  if (f.city.trim()) params.set("city", f.city.trim());
  if (f.marketingStatus) params.set("marketing_status", f.marketingStatus);
  if (f.onboardedFrom) params.set("onboarded_from", f.onboardedFrom);
  if (f.onboardedTo) params.set("onboarded_to", f.onboardedTo);
  if (f.createdFrom) params.set("created_from", f.createdFrom);
  if (f.createdTo) params.set("created_to", f.createdTo);
  if (f.sort) params.set("sort", f.sort);
  if (f.order) params.set("order", f.order);
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params;
}

function hasActiveFilters(f: Filters): boolean {
  return Boolean(
    f.query.trim() ||
      f.access ||
      f.addon ||
      f.addonSince ||
      f.activeHours ||
      f.lastSeenWithin.trim() ||
      f.lastSeenOlder.trim() ||
      f.locale ||
      f.countryCode.trim() ||
      f.city.trim() ||
      f.marketingStatus ||
      f.onboardedFrom ||
      f.onboardedTo ||
      f.createdFrom ||
      f.createdTo ||
      f.hasSubTier,
  );
}

function UsersList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const requestSeq = useRef(0);
  const hydrated = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fromUrl = filtersFromSearchParams(searchParams);
    setDraft(fromUrl);
    setApplied(fromUrl);
    hydrated.current = true;
  }, [searchParams]);

  const loadPage = useCallback(
    async (filters: Filters, offset: number, mode: "replace" | "append") => {
      const seq = ++requestSeq.current;
      if (mode === "replace") setLoading(true);
      else setLoadingMore(true);
      try {
        const params = buildQueryParams(filters, offset);
        const res = await adminFetch<{
          users: AdminUserRow[];
          total: number;
          limit: number;
          offset: number;
        }>(`/api/admin/users?${params}`);
        if (seq !== requestSeq.current) return;
        setTotal(res.total);
        setUsers((prev) =>
          mode === "append" && prev ? [...prev, ...res.users] : res.users,
        );
        setError(null);
      } catch (err) {
        if (seq === requestSeq.current) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить пользователей");
          if (mode === "replace") setUsers([]);
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!hydrated.current) return;
    void loadPage(applied, 0, "replace");
  }, [applied, loadPage]);

  const canLoadMore = (users?.length ?? 0) < total && !loading && !loadingMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && users) {
          void loadPage(applied, users.length, "append");
        }
      },
      { rootMargin: "240px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [applied, canLoadMore, loadPage, users]);

  function applySearch() {
    // Applied filters come from URL (dig-down + «Найти») — one load path.
    const params = buildQueryParams(draft, 0);
    params.delete("limit");
    params.delete("offset");
    const qs = params.toString();
    router.replace(qs ? `/admin/users?${qs}` : "/admin/users", { scroll: false });
  }

  const countLabel = useMemo(() => {
    return hasActiveFilters(applied) ? `Найдено: ${total}` : `Всего: ${total}`;
  }, [applied, total]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Пользователи</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">{countLabel}</p>
          {applied.activeHours ? (
            <p className="text-xs text-zinc-500">
              активны за {applied.activeHours} ч (события в приложении)
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Plus size={16} />
            Добавить пользователя
          </button>
          <Link
            href="/admin/users/stats"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            <BarChart3 size={16} />
            Статистика
          </Link>
        </div>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-zinc-200 bg-white p-3">
        <label className="relative block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            value={draft.query}
            onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySearch();
              }
            }}
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
            const on = draft.access === chip.value;
            return (
              <button
                key={chip.value || "all"}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, access: chip.value }))}
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
          Заполните фильтры и нажмите «Найти».
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={draft.addon}
            onChange={(e) => setDraft((d) => ({ ...d, addon: e.target.value }))}
            className={inputCls}
          >
            {ADDON_OPTIONS.map((opt) => (
              <option key={opt.value || "any-addon"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={draft.activeHours}
            onChange={(e) => setDraft((d) => ({ ...d, activeHours: e.target.value }))}
            className={inputCls}
          >
            <option value="">Любая активность (события в приложении)</option>
            <option value="24">Активны за 24 ч</option>
            <option value="72">Активны за 72 ч</option>
            <option value="168">Активны за 168 ч</option>
          </select>
          <select
            value={draft.locale}
            onChange={(e) => setDraft((d) => ({ ...d, locale: e.target.value }))}
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
            value={draft.marketingStatus}
            onChange={(e) => setDraft((d) => ({ ...d, marketingStatus: e.target.value }))}
            className={inputCls}
          >
            {MARKETING_OPTIONS.map((opt) => (
              <option key={opt.value || "any"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={draft.lastSeenWithin}
            onChange={(e) => setDraft((d) => ({ ...d, lastSeenWithin: e.target.value }))}
            placeholder="Был в приложении ≤ N дней"
            inputMode="numeric"
            className={inputCls}
          />
          <input
            value={draft.lastSeenOlder}
            onChange={(e) => setDraft((d) => ({ ...d, lastSeenOlder: e.target.value }))}
            placeholder="Не заходил в приложение ≥ N дней"
            inputMode="numeric"
            className={inputCls}
          />
          <input
            value={draft.countryCode}
            onChange={(e) =>
              setDraft((d) => ({ ...d, countryCode: e.target.value.toUpperCase() }))
            }
            placeholder="Страна (код, напр. RU)"
            maxLength={2}
            className={inputCls}
          />
          <input
            value={draft.city}
            onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
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
                value={draft.onboardedFrom}
                onChange={(e) => setDraft((d) => ({ ...d, onboardedFrom: e.target.value }))}
                className={`${inputCls} flex-1`}
              />
              <input
                type="date"
                value={draft.onboardedTo}
                onChange={(e) => setDraft((d) => ({ ...d, onboardedTo: e.target.value }))}
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
                value={draft.createdFrom}
                onChange={(e) => setDraft((d) => ({ ...d, createdFrom: e.target.value }))}
                className={`${inputCls} flex-1`}
              />
              <input
                type="date"
                value={draft.createdTo}
                onChange={(e) => setDraft((d) => ({ ...d, createdTo: e.target.value }))}
                className={`${inputCls} flex-1`}
              />
            </div>
          </fieldset>
        </div>

        <div className="grid gap-2 border-t border-zinc-100 pt-3 sm:grid-cols-2">
          <select
            value={draft.sort}
            onChange={(e) => setDraft((d) => ({ ...d, sort: e.target.value }))}
            className={inputCls}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Сортировка: {opt.label}
              </option>
            ))}
          </select>
          <select
            value={draft.order}
            onChange={(e) =>
              setDraft((d) => ({ ...d, order: e.target.value === "asc" ? "asc" : "desc" }))
            }
            className={inputCls}
          >
            <option value="desc">По убыванию</option>
            <option value="asc">По возрастанию</option>
          </select>
        </div>

        <div className="flex justify-end border-t border-zinc-100 pt-3">
          <button
            type="button"
            onClick={applySearch}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Найти
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {loading && users === null ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {users?.length === 0 && !loading ? (
        <p className="text-sm text-zinc-500">Никого не нашлось.</p>
      ) : null}

      <div className="flex flex-col gap-3">
        {users?.map((user) => {
          const period = formatAccessPeriodHeader({
            membershipTier: user.membership_tier,
            membershipExpiresAt: user.membership_expires_at,
            trialExpiresAt: user.trial_expires_at,
            startedAt: user.membership_started_at,
            createdAt: user.onboarded_at || user.created_at,
            paidPeriodEnd: user.current_period_end,
          });
          const nextCharge =
            user.subscription_status === "active" && user.current_period_end
              ? formatAdminDateTime(user.current_period_end)
              : null;
          const emailOnly = isEmailOnlyUser(user);
          const activityAt = emailOnly
            ? user.getcourse_last_activity_at
            : user.last_seen_at;
          const place = [
            user.country_code?.trim()
              ? countryNameRu(user.country_code)
              : null,
            user.city?.trim() || null,
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <Link
              key={user.id}
              href={`/admin/users/${user.id}`}
              className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-3 transition-colors hover:border-emerald-400/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-zinc-900">
                    {[user.display_name, user.last_name].filter(Boolean).join(" ") ||
                      "Без имени"}
                  </span>
                  {emailOnly ? (
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
                  {nextCharge ? (
                    <span className="text-[11px] text-zinc-500">
                      след. платёж: {nextCharge}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                  <span className="truncate">{user.email ?? "—"}</span>
                  {place ? <span>{place}</span> : null}
                  {activityAt ? (
                    <span>
                      {emailOnly ? "активность: " : "заходил: "}
                      {formatAdminDateTime(activityAt)}
                    </span>
                  ) : null}
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-zinc-600" />
            </Link>
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-8" />
      {loadingMore ? (
        <p className="flex items-center justify-center gap-2 py-3 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю ещё…
        </p>
      ) : null}

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          void loadPage(applied, 0, "replace");
        }}
      />
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
