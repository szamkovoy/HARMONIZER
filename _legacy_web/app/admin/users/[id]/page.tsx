"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { TIER_LABELS, TierBadge } from "../_components/TierBadge";

type AdminUserCard = {
  id: string;
  email: string;
  display_name: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
  locale: string | null;
  created_at: string | null;
  onboarded_at: string | null;
  last_activity_at: string | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  currency: string;
  tier: string;
  paid_until: string | null;
  source: string;
  comment: string | null;
  created_at: string;
};

const dtFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" });

const SOURCE_LABELS: Record<string, string> = {
  manual: "вручную",
  store: "покупка",
  promo: "промо",
};

function fmtDate(value: string | null, withTime = false): string {
  if (!value) return "—";
  return (withTime ? dtFmt : dateFmt).format(new Date(value));
}

export default function AdminUserCardPage() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserCard | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Форма назначения тарифа
  const [tier, setTier] = useState("free");
  const [expiresAt, setExpiresAt] = useState("");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ user: AdminUserCard; payments: PaymentRow[] }>(
        `/api/admin/users/${params.id}`,
      );
      setUser(data.user);
      setPayments(data.payments);
      setTier(data.user.membership_tier);
      setExpiresAt(data.user.membership_expires_at ? data.user.membership_expires_at.slice(0, 10) : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пользователя");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTier() {
    setSaving(true);
    setSaveError(null);
    setSavedAt(null);
    try {
      await adminFetch(`/api/admin/users/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tier,
          expires_at: tier !== "free" && expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
          amount: amount.trim() ? Number(amount.replace(",", ".")) : 0,
          comment: comment.trim() || undefined,
        }),
      });
      setAmount("");
      setComment("");
      setSavedAt(Date.now());
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (error) {
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

  const isPaidTier = tier !== "free";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink />

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-zinc-100">{user.display_name?.trim() || "Без имени"}</h1>
          <TierBadge tier={user.membership_tier} />
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Локаль" value={user.locale ?? "—"} />
          <InfoRow label="Регистрация" value={fmtDate(user.created_at)} />
          <InfoRow label="Онбординг" value={fmtDate(user.onboarded_at)} />
          <InfoRow label="Триал до" value={fmtDate(user.trial_expires_at, true)} />
          <InfoRow label="Тариф до" value={user.membership_expires_at ? fmtDate(user.membership_expires_at, true) : "бессрочно"} />
          <InfoRow label="Последняя активность" value={fmtDate(user.last_activity_at, true)} />
          <InfoRow label="ID" value={user.id} mono />
        </dl>
      </section>

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <h2 className="text-sm font-bold text-zinc-100">Назначить тариф</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Платный тариф пишется в леджер платежей (source=manual). Пустая дата — бессрочно; «Бесплатный» сбрасывает срок.
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-white/25 focus:outline-none"
            >
              {Object.entries(TIER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {isPaidTier ? (
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-white/25 focus:outline-none"
              />
            ) : null}
            {isPaidTier ? (
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Сумма, ₽ (0 если бесплатно)"
                inputMode="decimal"
                className="w-48 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
              />
            ) : null}
          </div>
          {isPaidTier ? (
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий (например: оплата переводом от 8 июля)"
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveTier()}
              disabled={saving}
              className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить тариф"}
            </button>
            {savedAt ? <span className="text-xs text-emerald-400">Сохранено</span> : null}
            {saveError ? <span className="text-xs text-red-400">{saveError}</span> : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <h2 className="mb-2 text-sm font-bold text-zinc-100">История платежей</h2>
        {payments.length === 0 ? <p className="text-sm text-zinc-500">Платежей пока нет.</p> : null}
        <div className="flex flex-col gap-1.5">
          {payments.map((payment) => (
            <div key={payment.id} className="rounded-lg border border-white/5 bg-black/20 p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <TierBadge tier={payment.tier} />
                <span className="font-semibold text-zinc-200">
                  {payment.amount > 0 ? `${payment.amount} ${payment.currency}` : "0 (без оплаты)"}
                </span>
                <span className="text-[11px] text-zinc-500">{SOURCE_LABELS[payment.source] ?? payment.source}</span>
                <span className="text-[11px] text-zinc-500">{fmtDate(payment.created_at, true)}</span>
                {payment.paid_until ? (
                  <span className="text-[11px] text-zinc-500">до {fmtDate(payment.paid_until)}</span>
                ) : null}
              </div>
              {payment.comment ? <p className="mt-1 text-xs text-zinc-400">{payment.comment}</p> : null}
            </div>
          ))}
        </div>
      </section>
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
