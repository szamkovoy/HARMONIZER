"use client";

import Link from "next/link";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { adminFetch, AdminApiError } from "../../_lib/adminApi";
import { dateInputValue, formatAdminDateTime } from "../../_lib/adminDates";
import { PaymentFormModal } from "../../users/_components/PaymentFormModal";
import { TierBadge } from "../../users/_components/TierBadge";
import {
  EMPTY_PAYMENT_FORM,
  SOURCE_LABELS,
  type AdminPaymentRow,
  type PaymentFormValues,
} from "../../users/_types/payments";

type RefundPhase = "confirm" | "working" | "done" | "failed";

type PaymentHistorySectionProps = {
  title?: string;
  /** `section` — карточка с заголовком (карточка пользователя); `list` — плоский список как /admin/users. */
  variant?: "section" | "list";
  payments: AdminPaymentRow[];
  ownerUserId?: string;
  includeUserLink?: boolean;
  onChanged?: () => Promise<void> | void;
};

function initialFormFromPayment(payment: AdminPaymentRow): PaymentFormValues {
  const currency =
    payment.currency === "EUR" || payment.currency === "USD" || payment.currency === "RUB"
      ? payment.currency
      : "RUB";
  return {
    tier: payment.tier,
    expiresAt: dateInputValue(payment.paid_until),
    amount: String(payment.amount ?? 0),
    currency,
    comment: payment.comment ?? "",
  };
}

function isEditable(payment: AdminPaymentRow): boolean {
  if (payment.editable === false || payment.kind === "gateway") return false;
  return true;
}

export function PaymentHistorySection({
  title = "История платежей",
  variant = "section",
  payments,
  ownerUserId,
  includeUserLink = false,
  onChanged,
}: PaymentHistorySectionProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPaymentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<AdminPaymentRow | null>(null);
  const [refundPhase, setRefundPhase] = useState<RefundPhase>("confirm");
  const [refundMessage, setRefundMessage] = useState<string | null>(null);

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

  function closeRefundModal() {
    if (refundPhase === "working") return;
    setRefundTarget(null);
    setRefundPhase("confirm");
    setRefundMessage(null);
  }

  async function runRefund(mode: "lavatop_mark" | "yookassa_api" | "yookassa_mark") {
    if (!refundTarget?.contract_id) return;
    setRefundPhase("working");
    setRefundMessage(null);
    try {
      const result = await adminFetch<{ ok: boolean; yookassaRefundId?: string }>(
        "/api/admin/payments/refund",
        {
          method: "POST",
          body: JSON.stringify({ contractId: refundTarget.contract_id, mode }),
        },
      );
      setRefundPhase("done");
      setRefundMessage(
        mode === "yookassa_api"
          ? `Возврат выполнен успешно${result.yookassaRefundId ? ` (id ${result.yookassaRefundId})` : ""}. Статус платежа: возврат. Тариф по этому платежу отключён.`
          : "Статус платежа изменён на «возврат». Запись сохранится, в статистике как оплата учитываться не будет. Тариф по этому платежу отключён.",
      );
      await onChanged?.();
    } catch (err) {
      setRefundPhase("failed");
      const msg =
        err instanceof AdminApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Не удалось выполнить возврат";
      setRefundMessage(msg);
    }
  }

  async function confirmRefund() {
    if (!refundTarget?.contract_id) return;
    const provider = (refundTarget.provider || refundTarget.source || "").toLowerCase();
    const mode = provider === "yookassa" ? "yookassa_api" : "lavatop_mark";
    await runRefund(mode);
  }

  async function confirmManualYookassaRefund() {
    await runRefund("yookassa_mark");
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
          currency: values.currency,
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
    if (!editing || !isEditable(editing)) return;
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/payments/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          tier: values.tier,
          expires_at: expiresIso,
          amount: values.amount.trim() ? Number(values.amount.replace(",", ".")) : 0,
          currency: values.currency,
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

  const isList = variant === "list";
  const rowClass = isList
    ? "rounded-2xl border border-zinc-200 bg-white p-3 text-sm transition-colors hover:border-emerald-400/30"
    : "rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 text-sm";

  const list = (
    <>
      {payments.length === 0 ? <p className="text-sm text-zinc-500">Платежей пока нет.</p> : null}
      <div className={isList ? "flex flex-col gap-3" : "flex flex-col gap-1.5"}>
        {payments.map((payment) => {
          const editable = isEditable(payment);
          const name = payment.display_name ?? "Без имени";
          return (
            <div key={payment.id} className={rowClass}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {includeUserLink ? (
                  payment.user_id ? (
                    <Link
                      href={`/admin/users/${payment.user_id}`}
                      className="font-semibold text-zinc-900 underline-offset-2 hover:text-emerald-700 hover:underline"
                    >
                      {name}
                    </Link>
                  ) : (
                    <span className="font-semibold text-zinc-900">{name}</span>
                  )
                ) : null}
                <TierBadge tier={payment.tier} />
                <span className="font-semibold text-zinc-800">
                  {payment.amount > 0
                    ? `${payment.amount} ${payment.currency}`
                    : `0 ${payment.currency}`}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {SOURCE_LABELS[payment.source] ?? payment.source}
                </span>
                {payment.status === "refunded" ? (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    возврат
                  </span>
                ) : null}
                <span className="text-[11px] text-zinc-500">
                  {formatAdminDateTime(payment.created_at)}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {payment.paid_until
                    ? `до ${formatAdminDateTime(payment.paid_until)}`
                    : "бессрочно"}
                </span>
                {payment.edited_at ? (
                  <span className="text-[11px] text-zinc-500">
                    (отредактировано: {formatAdminDateTime(payment.edited_at)})
                  </span>
                ) : null}
                <span className="ml-auto inline-flex items-center gap-2">
                  {payment.kind === "gateway" && payment.refundable && payment.contract_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRefundTarget(payment);
                        setRefundPhase("confirm");
                        setRefundMessage(null);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:text-rose-700"
                    >
                      <RotateCcw size={12} />
                      Возврат
                    </button>
                  ) : null}
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEditing(payment);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-800"
                    >
                      <Pencil size={12} />
                      Редактировать
                    </button>
                  ) : null}
                </span>
              </div>
              {includeUserLink && payment.email ? (
                <div className="mt-1 text-[11px] text-zinc-500">{payment.email}</div>
              ) : null}
              {payment.comment ? <p className="mt-1 text-xs text-zinc-400">{payment.comment}</p> : null}
            </div>
          );
        })}
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

      {refundTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="mb-3 text-sm font-bold text-zinc-900">Возврат платежа</h3>
            {refundPhase === "confirm" ? (
              <>
                <p className="mb-4 text-sm leading-relaxed text-zinc-600">
                  {(refundTarget.provider || refundTarget.source) === "yookassa"
                    ? "Будет выполнен процесс возврата этого платежа через API ЮКассы. Отменить эту операцию невозможно."
                    : "Отправьте заявку на возврат в админке LavaTop. Для этого в списке платежей нужно кликнуть на платеже. Здесь же можно только изменить статус данного платежа на «Возврат». В результате запись о нём сохранится, но он не будет учитываться в статистике как оплаченный."}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeRefundModal}
                    className="rounded-xl px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmRefund()}
                    className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                  >
                    Подтверждаю возврат
                  </button>
                </div>
              </>
            ) : null}
            {refundPhase === "working" ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-200 border-t-rose-600" />
                <p className="text-sm text-zinc-600">Выполняем возврат…</p>
              </div>
            ) : null}
            {refundPhase === "done" || refundPhase === "failed" ? (
              <>
                <p
                  className={`mb-4 text-sm leading-relaxed ${
                    refundPhase === "done" ? "text-emerald-700" : "text-rose-600"
                  }`}
                >
                  {refundMessage}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  {refundPhase === "failed" &&
                  (refundTarget.provider || refundTarget.source) === "yookassa" ? (
                    <button
                      type="button"
                      onClick={() => void confirmManualYookassaRefund()}
                      className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                    >
                      Сделать возврат вручную
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeRefundModal}
                    className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Закрыть
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );

  if (isList) return list;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-zinc-900">{title}</h2>
        {ownerUserId ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-400"
          >
            <Plus size={14} />
            Добавить платёж
          </button>
        ) : null}
      </div>
      {list}
    </section>
  );
}
