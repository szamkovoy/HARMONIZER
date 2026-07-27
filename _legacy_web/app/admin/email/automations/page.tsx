"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Workflow } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";

type Automation = {
  id: string;
  key: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  steps: { id: string; position: number; delay_hours: number; subject: string }[];
};

const TRIGGER_RU: Record<string, string> = {
  manual: "Вручную",
  account_registered: "Регистрация аккаунта (первый OTP)",
  app_first_open: "Первый запуск (legacy)",
  onboarded: "После онбординга (legacy)",
  subscription_expired: "Не продлил подписку (3 дня)",
  inactive: "Неактивен 14 дней",
};

export default function AdminEmailAutomationsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const { automations } = await adminFetch<{ automations: Automation[] }>(
        "/api/admin/email/automations",
      );
      setRows(automations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createChain() {
    setCreating(true);
    try {
      const { automation } = await adminFetch<{ automation: { id: string } }>(
        "/api/admin/email/automations",
        {
          method: "POST",
          body: JSON.stringify({ name: "Новая цепочка", trigger_type: "manual" }),
        },
      );
      router.push(`/admin/email/automations/${automation.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/email" className="text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Цепочки писем</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Откройте цепочку, чтобы править шаги, задержки и условие срабатывания.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void createChain()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Новая цепочка
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {rows === null ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id}>
              <Link
                href={`/admin/email/automations/${a.id}`}
                className="block rounded-2xl border border-zinc-200 bg-white px-4 py-4 hover:border-emerald-300 hover:bg-emerald-50/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3">
                    <Workflow size={20} className="mt-0.5 text-emerald-600" />
                    <div>
                      <div className="font-medium text-zinc-900">{a.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {TRIGGER_RU[a.trigger_type] ?? a.trigger_type} · {a.steps.length}{" "}
                        {a.steps.length === 1 ? "письмо" : "писем"}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      a.is_active
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {a.is_active ? "Активна" : "Выключена"}
                  </span>
                </div>
                {a.steps.length > 0 ? (
                  <ol className="mt-3 list-decimal space-y-1 border-t border-zinc-100 pl-5 pt-3 text-sm text-zinc-600">
                    {a.steps.map((s) => (
                      <li key={s.id}>
                        +{s.delay_hours}ч · {s.subject.trim() || "без темы"}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
