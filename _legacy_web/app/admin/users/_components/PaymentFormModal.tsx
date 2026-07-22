"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { expiryIsoFromDateInput } from "../../_lib/adminDates";
import { TIER_LABELS } from "./TierBadge";
import {
  CURRENCY_OPTIONS,
  EMPTY_PAYMENT_FORM,
  type PaymentFormValues,
} from "../_types/payments";

type PaymentFormModalProps = {
  open: boolean;
  title: string;
  initial: PaymentFormValues;
  allowFree?: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: PaymentFormValues, expiresIso: string | null) => void | Promise<void>;
};

export function PaymentFormModal({
  open,
  title,
  initial,
  allowFree = true,
  saving,
  error,
  onClose,
  onSubmit,
}: PaymentFormModalProps) {
  const [form, setForm] = useState<PaymentFormValues>(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  if (!open) return null;

  const isPaid = form.tier !== "free";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#12141a] p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          Платный тариф попадает в леджер. Пустая дата окончания — бессрочно. Время окончания — текущее на момент
          сохранения.
        </p>

        <div className="flex flex-col gap-2">
          <select
            value={form.tier}
            onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-white/25 focus:outline-none"
          >
            {Object.entries(TIER_LABELS)
              .filter(([value]) => allowFree || value !== "free")
              .filter(([value]) => value !== "practitioner" || form.tier === "practitioner")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>

          {isPaid ? (
            <>
              <input
                type="date"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-white/25 focus:outline-none"
              />
              <div className="flex gap-2">
                <input
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="Сумма"
                  inputMode="decimal"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
                />
                <select
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      currency: e.target.value as PaymentFormValues["currency"],
                    }))
                  }
                  className="w-[96px] shrink-0 rounded-xl border border-white/10 bg-black/30 px-2 py-2 text-sm text-zinc-100 focus:border-white/25 focus:outline-none"
                  aria-label="Валюта"
                >
                  {CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Комментарий"
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
              />
            </>
          ) : null}

          {error ? <p className="text-xs text-red-400">{error}</p> : null}

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSubmit(form, isPaid ? expiryIsoFromDateInput(form.expiresAt) : null)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { EMPTY_PAYMENT_FORM };
