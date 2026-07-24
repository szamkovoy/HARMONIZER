"use client";

import Link from "next/link";
import { BarChart3, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../_lib/adminApi";
import { PaymentHistorySection } from "./_components/PaymentHistorySection";
import type { AdminPaymentRow } from "../users/_types/payments";

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { payments } = await adminFetch<{ payments: AdminPaymentRow[] }>("/api/admin/payments");
      setPayments(payments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить платежи");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Платежи</h1>
          <p className="text-sm text-zinc-500">
            Lava.top / ЮКасса и ручные гранты. Суммы — как платил пользователь (без вычета комиссии).
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link
            href="/admin/payments/catalog"
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            <Package size={16} />
            Каталог ЮКасса
          </Link>
          <Link
            href="/admin/payments/stats"
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            <BarChart3 size={16} />
            Статистика выручки
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {payments === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {payments ? <PaymentHistorySection payments={payments} includeUserLink onChanged={load} /> : null}
    </div>
  );
}
