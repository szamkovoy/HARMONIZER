"use client";

import Link from "next/link";
import { BarChart3, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { adminFetch } from "../_lib/adminApi";
import { useAdminInfiniteScroll } from "../_lib/useAdminInfiniteScroll";
import { PaymentHistorySection } from "./_components/PaymentHistorySection";
import type { AdminPaymentRow } from "../users/_types/payments";

const PAGE_SIZE = 50;

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<AdminPaymentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);

  const loadPage = useCallback(async (offset: number, mode: "replace" | "append") => {
    const seq = ++requestSeq.current;
    if (mode === "replace") setLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await adminFetch<{
        payments: AdminPaymentRow[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/admin/payments?${params}`);
      if (seq !== requestSeq.current) return;
      setTotal(res.total);
      setPayments((prev) =>
        mode === "append" && prev ? [...prev, ...res.payments] : res.payments,
      );
      setError(null);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить платежи");
        if (mode === "replace") setPayments([]);
      }
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadPage(0, "replace");
  }, [loadPage]);

  const canLoadMore =
    (payments?.length ?? 0) < total && !loading && !loadingMore && payments !== null;

  const sentinelRef = useAdminInfiniteScroll(canLoadMore, () => {
    if (payments) void loadPage(payments.length, "append");
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Платежи</h1>
          <p className="mt-0.5 text-base font-semibold text-zinc-800">Всего: {total}</p>
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
      {payments ? (
        <>
          <PaymentHistorySection
            payments={payments}
            variant="list"
            includeUserLink
            onChanged={() => loadPage(0, "replace")}
          />
          <div ref={sentinelRef} className="h-8" />
          {loadingMore ? (
            <p className="flex items-center justify-center gap-2 py-3 text-sm text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> Ещё…
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
