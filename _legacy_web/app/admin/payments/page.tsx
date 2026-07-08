"use client";

import Link from "next/link";
import { BarChart3, Loader2 } from "lucide-react";
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
          <h1 className="text-xl font-bold text-zinc-100">Платежи</h1>
          <p className="text-sm text-zinc-500">Общий список записей леджера. Самые свежие записи — сверху.</p>
        </div>
        <Link
          href="/admin/payments/stats"
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5"
        >
          <BarChart3 size={16} />
          Статистика
        </Link>
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
