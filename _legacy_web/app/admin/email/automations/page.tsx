"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Workflow } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";

type Automation = {
  id: string;
  key: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  steps: { id: string; position: number; delay_hours: number; subject: string }[];
  runner: string;
};

const TRIGGER_RU: Record<string, string> = {
  manual: "Вручную",
  app_first_open: "Первый запуск / активность в приложении",
  onboarded: "После онбординга",
  subscription_expired: "Подписка не продлена",
  inactive: "Неактивен",
};

export default function AdminEmailAutomationsPage() {
  const [rows, setRows] = useState<Automation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

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

  async function toggleActive(a: Automation) {
    setToggling(a.id);
    try {
      await adminFetch(`/api/admin/email/automations/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !a.is_active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить");
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/email" className="text-zinc-500 hover:text-zinc-800">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Цепочки писем</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Welcome-раннер (B1): enroll по активности/онбордингу, отправка шагов по cron.
            Полный редактор шагов — в B2.
          </p>
        </div>
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
            <li
              key={a.id}
              className="rounded-2xl border border-zinc-200 bg-white px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3">
                  <Workflow size={20} className="mt-0.5 text-emerald-600" />
                  <div>
                    <div className="font-medium text-zinc-900">{a.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {TRIGGER_RU[a.trigger_type] ?? a.trigger_type} · key{" "}
                      <code className="text-zinc-600">{a.key}</code>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={toggling === a.id}
                  onClick={() => void toggleActive(a)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                    a.is_active
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {toggling === a.id ? "…" : a.is_active ? "Активна — выкл." : "Выключена — вкл."}
                </button>
              </div>
              <div className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
                {a.steps.length === 0 ? (
                  <p>Шагов нет — раннер enroll сделает, но отправлять нечего.</p>
                ) : (
                  <ol className="list-decimal space-y-1 pl-5">
                    {a.steps.map((s) => (
                      <li key={s.id}>
                        +{s.delay_hours}ч · {s.subject.trim() || "без темы"}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
