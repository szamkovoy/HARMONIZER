"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { TIER_LABELS } from "../../users/_components/TierBadge";

type Row = {
  contractId: string;
  userId: string | null;
  email: string | null;
  tier: string;
  productKind: string | null;
  productRef: string | null;
  amount: number | null;
  currency: string | null;
  provider: string | null;
  reason: string | null;
  at: string;
};

type Lists = { failed: Row[]; lapsed: Row[]; pending: Row[] };

function productLabel(row: Row): string {
  const tier = TIER_LABELS[row.tier] ?? row.tier;
  if (row.productKind === "subscription") return `${tier} · подписка`;
  if (row.productRef) return `${tier} · ${row.productRef}`;
  return tier;
}

function money(row: Row): string {
  if (row.amount == null) return row.currency ?? "—";
  return `${row.amount} ${row.currency ?? ""}`.trim();
}

function Table({ rows, emptyReason }: { rows: Row[]; emptyReason: string }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">Пока пусто.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-2 pr-3 font-medium">Время</th>
            <th className="py-2 pr-3 font-medium">Email</th>
            <th className="py-2 pr-3 font-medium">Продукт</th>
            <th className="py-2 pr-3 font-medium">Сумма</th>
            <th className="py-2 pr-3 font-medium">Шлюз</th>
            <th className="py-2 font-medium">Причина</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.contractId} className="border-t border-zinc-100 align-top">
              <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">{formatAdminDateTime(row.at)}</td>
              <td className="py-2 pr-3">
                {row.userId ? (
                  <Link href={`/admin/users/${row.userId}`} className="text-emerald-800 hover:underline">
                    {row.email || "профиль"}
                  </Link>
                ) : (
                  <span className="text-zinc-700">{row.email || "—"}</span>
                )}
              </td>
              <td className="py-2 pr-3 text-zinc-800">{productLabel(row)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-zinc-700">{money(row)}</td>
              <td className="py-2 pr-3 text-zinc-700">{row.provider || "—"}</td>
              <td className="py-2 text-zinc-600">{row.reason || emptyReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UnsuccessfulPayments() {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminFetch<Lists>("/api/admin/payments/unsuccessful")
      .then((data) => {
        if (!cancelled) setLists(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!lists) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загружаю…
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 text-base font-semibold text-zinc-900">Отказы</h2>
        <p className="mb-2 text-sm text-zinc-500">Счёт в статусе failed, с причиной.</p>
        <Table rows={lists.failed} emptyReason="—" />
      </section>
      <section>
        <h2 className="mb-2 text-base font-semibold text-zinc-900">Закрытые продления</h2>
        <p className="mb-2 text-sm text-zinc-500">Отменены с причиной renewal… или lapsed…</p>
        <Table rows={lists.lapsed} emptyReason="—" />
      </section>
      <section>
        <h2 className="mb-2 text-base font-semibold text-zinc-900">Брошенные</h2>
        <p className="mb-2 text-sm text-zinc-500">Pending старше 30 минут. Это не отдельный статус.</p>
        <Table rows={lists.pending} emptyReason="нет оплаты больше 30 минут" />
      </section>
    </div>
  );
}
