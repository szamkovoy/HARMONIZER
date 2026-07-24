"use client";

import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";

type CatalogItem = {
  id: string;
  provider: string;
  tier: string;
  currency: string;
  amount: number;
  title: string;
  description: string | null;
  product_kind: string;
  active: boolean;
  updated_at: string;
};

const TIER_LABELS: Record<string, string> = {
  oracle: "Наставник",
  master: "Мастер",
  webinar: "Вебинар",
  book: "Книга",
};

const KIND_LABELS: Record<string, string> = {
  subscription: "подписка (30 дней)",
  one_time: "разовая покупка",
};

const PROVIDER_LABELS: Record<string, string> = {
  yookassa: "ЮКасса",
  lavatop: "Lava.top",
};

export default function AdminPaymentCatalogPage() {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAmount, setDraftAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: rows } = await adminFetch<{ items: CatalogItem[] }>(
        "/api/admin/payment-catalog",
      );
      setItems(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить каталог");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(item: CatalogItem) {
    setEditingId(item.id);
    setDraftTitle(item.title);
    setDraftDescription(item.description ?? "");
    setDraftAmount(String(item.amount));
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  async function saveEdit(id: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const amount = Number(String(draftAmount).replace(",", "."));
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Стоимость должна быть положительным числом");
      }
      await adminFetch(`/api/admin/payment-catalog/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: draftTitle.trim(),
          description: draftDescription.trim() || null,
          amount,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/admin/payments"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> Платежи
      </Link>
      <h1 className="text-xl font-bold text-zinc-900">Каталог ЮКасса</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Название и описание уходят в платёж ЮKassa (до 128 символов). Тип продукта и валюта
        зафиксированы; стоимость можно менять — она сразу попадёт в кабинет и checkout.
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {items === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {items?.map((item) => {
          const editing = editingId === item.id;
          return (
            <section
              key={item.id}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-700">
                  {PROVIDER_LABELS[item.provider] ?? item.provider}
                </span>
                <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-zinc-700">
                  {TIER_LABELS[item.tier] ?? item.tier}
                </span>
                <span>{KIND_LABELS[item.product_kind] ?? item.product_kind}</span>
                <span>
                  {item.amount} {item.currency}
                </span>
                {!item.active ? (
                  <span className="text-amber-300">выключен</span>
                ) : null}
              </div>

              {editing ? (
                <div className="space-y-3">
                  <label className="block text-xs text-zinc-500">
                    Название
                    <input
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      maxLength={128}
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                    />
                  </label>
                  <label className="block text-xs text-zinc-500">
                    Описание (в ЮKassa)
                    <textarea
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      maxLength={128}
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                    />
                    <span className="mt-0.5 block text-[11px] text-zinc-600">
                      {draftDescription.length}/128
                    </span>
                  </label>
                  <label className="block text-xs text-zinc-500">
                    Стоимость ({item.currency})
                    <input
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                    />
                  </label>
                  {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void saveEdit(item.id)}
                      className="rounded-xl bg-emerald-500/20 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      {saving ? "Сохраняю…" : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancelEdit}
                      className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-100"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-zinc-900">{item.title}</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    {item.description?.trim() || "— без описания —"}
                  </p>
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className="mt-3 text-sm text-emerald-700 hover:underline"
                  >
                    Редактировать
                  </button>
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
