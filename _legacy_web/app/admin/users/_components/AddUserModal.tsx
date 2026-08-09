"use client";

import Link from "next/link";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AdminApiError, adminFetch } from "../../_lib/adminApi";

export type AddUserForm = {
  email: string;
  display_name: string;
  last_name: string;
  phone: string;
  country_code: string;
  city: string;
  birth_date: string;
};

const EMPTY: AddUserForm = {
  email: "",
  display_name: "",
  last_name: "",
  phone: "",
  country_code: "",
  city: "",
  birth_date: "",
};

const inputCls =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none";

type AddUserModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (userId: string) => void;
};

export function AddUserModal({ open, onClose, onCreated }: AddUserModalProps) {
  const [form, setForm] = useState<AddUserForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existsUserId, setExistsUserId] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      setExistsUserId(null);
      setCreatedUserId(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (saving || createdUserId) return;
    const email = form.email.trim().toLowerCase();
    if (!email.includes("@")) {
      setError("Укажите корректный email");
      return;
    }
    setSaving(true);
    setError(null);
    setExistsUserId(null);
    try {
      const res = await adminFetch<{ id: string; email: string }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email,
          display_name: form.display_name.trim() || undefined,
          last_name: form.last_name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          country_code: form.country_code.trim() || undefined,
          city: form.city.trim() || undefined,
          birth_date: form.birth_date.trim() || undefined,
        }),
      });
      setCreatedUserId(res.id);
      onCreated(res.id);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409) {
        const body = err.body as { userId?: string | null; code?: string } | null;
        setExistsUserId(body?.userId ?? null);
        setError(err.message || "Пользователь с таким email уже есть в базе");
      } else {
        setError(err instanceof Error ? err.message : "Не удалось добавить");
      }
    } finally {
      setSaving(false);
    }
  }

  if (createdUserId) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl"
        >
          <div className="mb-3 flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={22} />
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Пользователь добавлен</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Он в маркетинговой базе (сегмент «Только рассылки»), OTP не отправлялся.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Закрыть
            </button>
            <Link
              href={`/admin/users/${createdUserId}`}
              className="inline-flex items-center rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Открыть карточку
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900">Добавить пользователя</h3>
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
          В маркетинговую базу без OTP — как при импорте из Геткурса. Обязателен только email.
        </p>

        <div className="flex flex-col gap-2">
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email *"
            type="email"
            autoComplete="off"
            className={inputCls}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.display_name}
              onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              placeholder="Имя"
              className={inputCls}
            />
            <input
              value={form.last_name}
              onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
              placeholder="Фамилия"
              className={inputCls}
            />
          </div>
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="Телефон"
            className={inputCls}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={form.country_code}
              onChange={(e) =>
                setForm((f) => ({ ...f, country_code: e.target.value.toUpperCase() }))
              }
              placeholder="Страна (код, напр. RU)"
              maxLength={2}
              className={inputCls}
            />
            <input
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              placeholder="Город"
              className={inputCls}
            />
          </div>
          <label className="text-xs text-zinc-500">
            Дата рождения
            <input
              type="date"
              value={form.birth_date}
              onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))}
              className={`${inputCls} mt-1`}
            />
          </label>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600">
            {error}
            {existsUserId ? (
              <>
                {" "}
                <Link
                  href={`/admin/users/${existsUserId}`}
                  className="font-semibold text-emerald-700 underline underline-offset-2"
                >
                  Открыть карточку
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Отменить
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
