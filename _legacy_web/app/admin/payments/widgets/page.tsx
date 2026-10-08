"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";

type WidgetRow = {
  id: string;
  title: string;
  active: boolean;
  updated_at: string;
  catalog: { id: string; tier: string; title: string; amount: number; currency: string } | null;
};

export default function AdminPaymentWidgetsPage() {
  const router = useRouter();
  const [items, setItems] = useState<WidgetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch<{ items: WidgetRow[] }>("/api/admin/payment-widgets");
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить виджеты");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(copyFrom?: string) {
    const title = copyFrom ? "" : window.prompt("Название виджета (видно только в админке)")?.trim();
    if (!copyFrom && !title) return;
    setBusy(true);
    try {
      const { item } = await adminFetch<{ item: WidgetRow }>("/api/admin/payment-widgets", {
        method: "POST",
        body: JSON.stringify(copyFrom ? { copy_from: copyFrom } : { title }),
      });
      router.push(`/admin/payments/widgets/${item.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать виджет");
      setBusy(false);
    }
  }

  async function remove(row: WidgetRow) {
    if (!window.confirm(`Удалить виджет «${row.title}»? На сайтах, где он вставлен, форма перестанет показываться.`)) {
      return;
    }
    setBusy(true);
    try {
      await adminFetch(`/api/admin/payment-widgets/${row.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/admin/payments"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> Платежи
      </Link>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Виджеты оплаты</h1>
          <p className="text-sm text-zinc-500">
            Форма оплаты для лендингов: вставляется одной строкой кода. Продукт и цены — из каталога.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Plus size={16} /> Новый виджет
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
      {items === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {items && !items.length ? <p className="text-sm text-zinc-500">Виджетов пока нет.</p> : null}

      <div className="flex flex-col gap-2">
        {items?.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-emerald-400"
          >
            <Link href={`/admin/payments/widgets/${row.id}`} className="min-w-0 flex-1">
              <p className="truncate font-semibold text-zinc-900">{row.title}</p>
              <p className="truncate text-sm text-zinc-500">
                {row.catalog ? row.catalog.title : "продукт не выбран"}
                {!row.active ? <span className="ml-2 text-amber-600">выключен</span> : null}
              </p>
            </Link>
            <button
              type="button"
              title="Копировать виджет"
              disabled={busy}
              onClick={() => void create(row.id)}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              title="Удалить"
              disabled={busy}
              onClick={() => void remove(row)}
              className="rounded-lg p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
