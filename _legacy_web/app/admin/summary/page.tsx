"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Loader2, RefreshCw } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

const WEEK_OPTIONS = [4, 8, 12, 24] as const;

export default function AdminSummaryPage() {
  const [weeks, setWeeks] = useState<number>(8);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminFetch<{ text: string }>(
        `/api/admin/summary?weeks=${weeks}`,
        { method: "POST" },
      );
      setText(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить сводку");
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyAll() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Не удалось скопировать — браузер не дал доступ к буферу");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <a href="/admin" className="mt-1 text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </a>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Сводка</h1>
            <p className="text-xs text-zinc-500">
              Текстовый отчёт для стратегического чата. Без email и имён. Считается при открытии.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-zinc-200 bg-white p-0.5">
            {WEEK_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWeeks(w)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  weeks === w ? "bg-emerald-600 text-white" : "text-zinc-600"
                }`}
              >
                {w}н
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Обновить
          </button>
          <button
            type="button"
            disabled={loading || !text}
            onClick={() => void copyAll()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Copy size={16} />
            {copied ? "Скопировано" : "Скопировать всё"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading && !text ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Считаю сводку…
        </div>
      ) : null}

      {text ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-white p-4 text-xs leading-relaxed text-zinc-800">
          {text}
        </pre>
      ) : null}

      <p className="text-[11px] text-zinc-400">
        Источник: RPC `admin_summary_report` (один round-trip к Postgres). Тестовые аккаунты — env `ADMIN_SUMMARY_TEST_EMAILS`.
        Обновлено: {formatAdminDateTime(new Date().toISOString())}
      </p>
    </div>
  );
}
