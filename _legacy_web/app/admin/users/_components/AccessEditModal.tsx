"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { dateInputValue, expiryIsoFromDateInput } from "../../_lib/adminDates";
import { ACCESS_NOW_LABELS_RU, accessNowSegment, type AccessNowSeg } from "../../_lib/accessNow";

export type AccessEditValues = {
  access: AccessNowSeg;
  startsAt: string;
  endsAt: string;
};

type AccessEditModalProps = {
  open: boolean;
  saving: boolean;
  error: string | null;
  initial: AccessEditValues;
  onClose: () => void;
  onSubmit: (values: {
    access: AccessNowSeg;
    startsAtIso: string | null;
    endsAtIso: string | null;
  }) => void | Promise<void>;
};

const ACCESS_OPTIONS: AccessNowSeg[] = ["trial", "navigator", "oracle", "master"];

export function accessEditInitialFromUser(user: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at?: string | null;
  membership_started_at?: string | null;
  created_at?: string | null;
  onboarded_at?: string | null;
}): AccessEditValues {
  const access = accessNowSegment({
    membership_tier: user.membership_tier,
    membership_expires_at: user.membership_expires_at,
    trial_expires_at: user.trial_expires_at ?? null,
  });
  const start =
    user.membership_started_at || user.onboarded_at || user.created_at || null;
  const end =
    access === "trial"
      ? user.trial_expires_at ?? null
      : access === "navigator"
        ? null
        : user.membership_expires_at;
  return {
    access,
    startsAt: dateInputValue(start),
    endsAt: dateInputValue(end),
  };
}

export function AccessEditModal({
  open,
  saving,
  error,
  initial,
  onClose,
  onSubmit,
}: AccessEditModalProps) {
  const [form, setForm] = useState<AccessEditValues>(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  if (!open) return null;

  const needsEnd = form.access === "trial" || form.access === "oracle" || form.access === "master";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900">Изменить тариф</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-700"
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs text-zinc-500">
          Последняя операция побеждает: оплата, подписка или ручной платёж снова перезапишут тариф.
          Пустое «по» для платного тарифа — бессрочно.
        </p>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-zinc-500">
            Тариф
            <select
              value={form.access}
              onChange={(e) =>
                setForm((f) => ({ ...f, access: e.target.value as AccessNowSeg }))
              }
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none"
            >
              {ACCESS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {ACCESS_NOW_LABELS_RU[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-zinc-500">
            С какого числа
            <input
              type="date"
              value={form.startsAt}
              onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none"
            />
          </label>

          {needsEnd || form.access === "navigator" ? (
            <label className="text-xs text-zinc-500">
              По какое число{form.access === "navigator" ? " (обычно пусто)" : ""}
              <input
                type="date"
                value={form.endsAt}
                onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          ) : null}

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                const startsAtIso = form.startsAt
                  ? expiryIsoFromDateInput(form.startsAt)
                  : null;
                // expiryIsoFromDateInput returns end-of-day; for start use start of day UTC
                const starts =
                  form.startsAt && /^\d{4}-\d{2}-\d{2}$/.test(form.startsAt)
                    ? `${form.startsAt}T00:00:00.000Z`
                    : startsAtIso;
                const endsAtIso = form.endsAt.trim()
                  ? expiryIsoFromDateInput(form.endsAt)
                  : null;
                void onSubmit({
                  access: form.access,
                  startsAtIso: starts,
                  endsAtIso,
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
