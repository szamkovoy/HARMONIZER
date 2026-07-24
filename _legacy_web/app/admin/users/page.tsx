"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, ChevronRight, Loader2, Search } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatUserTierPeriod } from "../_lib/adminDates";
import { TIER_LABELS, TierBadge } from "./_components/TierBadge";

type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  created_at: string | null;
};

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("");
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async (q: string, t: string) => {
    const seq = ++requestSeq.current;
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (t) params.set("tier", t);
      const { users } = await adminFetch<{ users: AdminUserRow[] }>(`/api/admin/users?${params}`);
      if (seq === requestSeq.current) setUsers(users);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить пользователей");
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query, tier), query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [query, tier, load]);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Пользователи</h1>
          <p className="text-sm text-zinc-500">Поиск по имени или email, фильтр по тарифу. Показываются до 100 записей.</p>
        </div>
        <Link
          href="/admin/users/stats"
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          <BarChart3 size={16} />
          Статистика
        </Link>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или email…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">Все тарифы</option>
          {Object.entries(TIER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {users === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {users?.length === 0 ? <p className="text-sm text-zinc-500">Никого не нашлось.</p> : null}

      <div className="flex flex-col gap-1.5">
        {users?.map((user) => (
          <Link
            key={user.id}
            href={`/admin/users/${user.id}`}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-300"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-semibold text-zinc-900">
                  {user.display_name?.trim() || "Без имени"}
                </span>
                <TierBadge tier={user.membership_tier} />
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                <span className="truncate">{user.email ?? "—"}</span>
                {formatUserTierPeriod(user.created_at, user.membership_expires_at, user.membership_tier) ? (
                  <span>{formatUserTierPeriod(user.created_at, user.membership_expires_at, user.membership_tier)}</span>
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
