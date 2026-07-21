"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { countryNameRu } from "../../_lib/countryNamesRu";
import { formatAdminDate, formatAdminDateTime } from "../../_lib/adminDates";
import { PaymentHistorySection } from "../../payments/_components/PaymentHistorySection";
import { TierBadge } from "../_components/TierBadge";
import type { AdminPaymentRow } from "../_types/payments";

type AdminUserCard = {
  id: string;
  email: string;
  display_name: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  locale: string | null;
  created_at: string | null;
  onboarded_at: string | null;
  last_activity_at: string | null;
  country_code: string | null;
  city: string | null;
};

function formatLocation(user: AdminUserCard): string {
  const country = user.country_code ? countryNameRu(user.country_code) : null;
  const city = user.city?.trim() || null;
  if (country && city) return `${country}, ${city}`;
  if (country) return country;
  if (city) return city;
  return "—";
}

export default function AdminUserCardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<AdminUserCard | null>(null);
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ user: AdminUserCard; payments: AdminPaymentRow[] }>(
        `/api/admin/users/${params.id}`,
      );
      setUser(data.user);
      setPayments(data.payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пользователя");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!user) return;
    const label = user.display_name?.trim() || user.email;
    const ok = window.confirm(
      `Удалить пользователя «${label}»?\n\nАккаунт и данные профиля будут удалены. Записи об оплатах останутся в отчётах (с email покупателя).`,
    );
    if (!ok) return;
    const again = window.confirm("Подтвердите ещё раз: удаление необратимо.");
    if (!again) return;

    setDeleting(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      router.replace("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить пользователя");
      setDeleting(false);
    }
  }

  if (error && !user) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink />

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-zinc-100">{user.display_name?.trim() || "Без имени"}</h1>
          <TierBadge tier={user.membership_tier} />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Язык" value={user.locale ?? "—"} />
          <InfoRow label="Местонахождение" value={formatLocation(user)} />
          <InfoRow label="Регистрация" value={formatAdminDate(user.created_at)} />
          <InfoRow label="Заполнил профиль" value={formatAdminDate(user.onboarded_at)} />
          <InfoRow
            label="Тариф до"
            value={user.membership_expires_at ? formatAdminDateTime(user.membership_expires_at) : "бессрочно"}
          />
          <InfoRow label="Последняя активность" value={formatAdminDateTime(user.last_activity_at)} />
          <InfoRow label="ID" value={user.id} mono />
        </dl>

        <div className="mt-4 border-t border-white/5 pt-4">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-50"
          >
            {deleting ? "Удаляю…" : "Удалить пользователя"}
          </button>
          <p className="mt-2 text-[11px] text-zinc-500">
            Требуется двойное подтверждение. Платежи Lava и ручные гранты сохраняются для отчётов.
          </p>
        </div>
      </section>

      <PaymentHistorySection payments={payments} ownerUserId={user.id} onChanged={load} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
      <ArrowLeft size={15} /> Все пользователи
    </Link>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-zinc-200 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
