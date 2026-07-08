"use client";

import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { adminFetch } from "../../_lib/adminApi";
import { dateInputValue, formatAdminDateTime } from "../../_lib/adminDates";
import { PaymentFormModal } from "../../users/_components/PaymentFormModal";
import { TierBadge } from "../../users/_components/TierBadge";
import {
  EMPTY_PAYMENT_FORM,
  SOURCE_LABELS,
  type AdminPaymentRow,
  type PaymentFormValues,
} from "../../users/_types/payments";

type PaymentHistorySectionProps = {
  title?: string;
  payments: AdminPaymentRow[];
  ownerUserId?: string;
  includeUserLink?: boolean;
  onChanged?: () => Promise<void> | void;
};

function initialFormFromPayment(payment: AdminPaymentRow): PaymentFormValues {
  return {
    tier: payment.tier,
    expiresAt: dateInputValue(payment.paid_until),
    amount: String(payment.amount ?? 0),
    comment: payment.comment ?? "",
  };
}

export function PaymentHistorySection({
  title = "История платежей",
  payments,
  ownerUserId,
  includeUserLink = false,
  onChanged,
}: PaymentHistorySectionProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPaymentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editingInitial = useMemo(
    () => (editing ? initialFormFromPayment(editing) : EMPTY_PAYMENT_FORM),
    [editing],
  );

  async function afterChange() {
    setCreateOpen(false);
    setEditing(null);
    setError(null);
    await onChanged?.();
  }

  async function createPayment(values: PaymentFormValues, expiresIso: string | null) {
    if (!ownerUserId) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/users/${ownerUserId}`, {
        method: "PATCH",
        body: JSON.stringify({
          tier: values.tier,
          expires_at: expiresIso,
          amount: values.amount.trim() ? Number(values.amount.replace(",", ".")) : 0,
          comment: values.comment.trim() || undefined,
        }),
      });
      await afterChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить платёж");
    } finally {
      setSaving(false);
    }
  }

  async function updatePayment(values: PaymentFormValues, expiresIso: string | null) {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/payments/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tier: values.tier,
          expires_at: expiresIso,
          amount: values.amount.trim() ? Number(values.amount.replace(",", ".")) : 0,
          comment: values.comment.trim() || undefined,
        }),
      });
      await afterChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
        {ownerUserId ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/90 px-3 py-2 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400"
          >
            <Plus size={14} />
            Добавить платёж
          </button>
        ) : null}
      </div>

      {payments.length === 0 ? <p className="text-sm text-zinc-500">Платежей пока нет.</p> : null}
      <div className="flex flex-col gap-1.5">
        {payments.map((payment) => (
          <div key={payment.id} className="rounded-lg border border-white/5 bg-black/20 p-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {includeUserLink ? (
                <Link
                  href={`/admin/users/${payment.user_id}`}
                  className="font-semibold text-zinc-100 underline-offset-2 hover:text-emerald-300 hover:underline"
                >
                  {payment.display_name ?? "Без имени"}
                </Link>
              ) : null}
              <TierBadge tier={payment.tier} />
              <span className="font-semibold text-zinc-200">
                {payment.amount > 0 ? `${payment.amount} ${payment.currency}` : `0 ${payment.currency}`}
              </span>
              <span className="text-[11px] text-zinc-500">{SOURCE_LABELS[payment.source] ?? payment.source}</span>
              <span className="text-[11px] text-zinc-500">{formatAdminDateTime(payment.created_at)}</span>
              <span className="text-[11px] text-zinc-500">
                {payment.paid_until ? `до ${formatAdminDateTime(payment.paid_until)}` : "бессрочно"}
              </span>
              {payment.edited_at ? (
                <span className="text-[11px] text-zinc-500">
                  (отредактировано: {formatAdminDateTime(payment.edited_at)})
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setEditing(payment);
                }}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
              >
                <Pencil size={12} />
                Редактировать
              </button>
            </div>
            {includeUserLink && payment.email ? (
              <div className="mt-1 text-[11px] text-zinc-500">{payment.email}</div>
            ) : null}
            {payment.comment ? <p className="mt-1 text-xs text-zinc-400">{payment.comment}</p> : null}
          </div>
        ))}
      </div>

      <PaymentFormModal
        open={createOpen}
        title="Добавить платёж"
        initial={EMPTY_PAYMENT_FORM}
        allowFree={false}
        saving={saving}
        error={error}
        onClose={() => {
          if (!saving) {
            setCreateOpen(false);
            setError(null);
          }
        }}
        onSubmit={createPayment}
      />

      <PaymentFormModal
        open={Boolean(editing)}
        title="Редактировать платёж"
        initial={editingInitial}
        allowFree={false}
        saving={saving}
        error={error}
        onClose={() => {
          if (!saving) {
            setEditing(null);
            setError(null);
          }
        }}
        onSubmit={updatePayment}
      />
    </section>
  );
}
