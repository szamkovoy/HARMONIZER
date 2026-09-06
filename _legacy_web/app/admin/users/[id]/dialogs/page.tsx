"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { adminFetch } from "../../../_lib/adminApi";
import { formatAdminDateTime } from "../../../_lib/adminDates";

type ArchiveTurn = {
  role: "user" | "assistant";
  text: string;
  at?: string;
  branch?: string;
  turnMode?: string;
  shouldClose?: boolean;
  guards?: string[];
  planningPersistence?: Record<string, unknown>;
  practicePicked?: boolean;
};

type ArchiveRow = {
  id: string;
  conversation_id: string;
  entry_source: string | null;
  day_tab_mode: string | null;
  locale: string | null;
  algo_version: string | null;
  outcome: string;
  started_at: string;
  closed_at: string | null;
  turns: ArchiveTurn[];
  last_branch: string | null;
  review_status: string;
  reviewed_at: string | null;
  review_note: string | null;
};

const OUTCOME_RU: Record<string, string> = {
  open: "открыт",
  completed: "завершён штатно",
  practice_handoff: "ушёл в практику",
  superseded: "заменён новым заходом",
  interrupted: "обрыв",
  error: "ошибка",
};

const REVIEW_RU: Record<string, string> = {
  unreviewed: "не просмотрен",
  reviewed_ok: "норма",
  issue: "проблема",
  fixed: "исправлено",
};

const ENTRY_RU: Record<string, string> = {
  home: "Главная",
  day: "День",
};

function outcomeClass(outcome: string): string {
  switch (outcome) {
    case "completed":
    case "practice_handoff":
      return "bg-emerald-50 text-emerald-800";
    case "open":
      return "bg-zinc-100 text-zinc-700";
    case "superseded":
      return "bg-amber-50 text-amber-900";
    case "interrupted":
    case "error":
      return "bg-rose-50 text-rose-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

export default function UserDialogsPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const [displayName, setDisplayName] = useState<string>("");
  const [dialogs, setDialogs] = useState<ArchiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { review_status: string; review_note: string }>>(
    {},
  );

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{
        user: { display_name: string | null };
        dialogs: ArchiveRow[];
      }>(`/api/admin/users/${userId}/dialogs`);
      setDisplayName(data.user.display_name?.trim() || "Пользователь");
      setDialogs(data.dialogs);
      setDrafts(
        Object.fromEntries(
          (data.dialogs ?? []).map((row) => [
            row.id,
            { review_status: row.review_status, review_note: row.review_note ?? "" },
          ]),
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить диалоги");
      setDialogs([]);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveReview(row: ArchiveRow) {
    const draft = drafts[row.id];
    if (!draft) return;
    setSavingId(row.id);
    setError(null);
    try {
      await adminFetch(`/api/admin/users/${userId}/dialogs`, {
        method: "PATCH",
        body: JSON.stringify({
          archiveId: row.id,
          review_status: draft.review_status,
          review_note: draft.review_note.trim() || null,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить отметку");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link
        href={`/admin/users/${userId}`}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"
      >
        <ArrowLeft size={15} /> Карточка пользователя
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-zinc-900">Диалоги ассистента</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {displayName}. Журнал за 7 дней, по времени создания. Приложение эти тексты не читает.
        </p>
      </div>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {dialogs == null ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : dialogs.length === 0 ? (
        <p className="text-sm text-zinc-400">Пока нет сохранённых daily dialog за 7 дней.</p>
      ) : (
        dialogs.map((dialog, index) => {
          const draft = drafts[dialog.id] ?? {
            review_status: dialog.review_status,
            review_note: dialog.review_note ?? "",
          };
          const turns = Array.isArray(dialog.turns) ? dialog.turns : [];
          return (
            <section
              key={dialog.id}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-zinc-800">#{index + 1}</span>
                <span className={`rounded-full px-2 py-0.5 ${outcomeClass(dialog.outcome)}`}>
                  {OUTCOME_RU[dialog.outcome] ?? dialog.outcome}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                  {REVIEW_RU[dialog.review_status] ?? dialog.review_status}
                </span>
                <span className="text-zinc-500">
                  {ENTRY_RU[dialog.entry_source ?? ""] ?? dialog.entry_source ?? "вход?"}
                  {dialog.day_tab_mode ? ` · ${dialog.day_tab_mode}` : ""}
                  {dialog.locale ? ` · ${dialog.locale}` : ""}
                </span>
                <span className="text-zinc-400">{formatAdminDateTime(dialog.started_at)}</span>
              </div>
              <ol className="mt-3 space-y-2">
                {turns.length === 0 ? (
                  <li className="text-sm text-zinc-400">Ходов нет (закрыт до первой реплики).</li>
                ) : (
                  turns.map((turn, turnIndex) => (
                    <li key={`${dialog.id}-${turnIndex}`} className="text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="shrink-0 font-medium text-zinc-500">
                          {turn.role === "user" ? "Пользователь" : "Ассистент"}
                        </span>
                        {turn.branch ? (
                          <span className="text-[11px] text-zinc-400">{turn.branch}</span>
                        ) : null}
                        {turn.shouldClose ? (
                          <span className="text-[11px] text-emerald-700">shouldClose</span>
                        ) : null}
                        {turn.guards?.length ? (
                          <span className="text-[11px] text-amber-800">{turn.guards.join(", ")}</span>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-zinc-800">{turn.text}</p>
                    </li>
                  ))
                )}
              </ol>
              <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:items-end">
                <label className="text-xs text-zinc-500">
                  Разбор
                  <select
                    className="mt-1 block w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
                    value={draft.review_status}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [dialog.id]: { ...draft, review_status: event.target.value },
                      }))
                    }
                  >
                    <option value="unreviewed">не просмотрен</option>
                    <option value="reviewed_ok">норма</option>
                    <option value="issue">проблема</option>
                    <option value="fixed">исправлено</option>
                  </select>
                </label>
                <label className="min-w-0 flex-1 text-xs text-zinc-500">
                  Заметка
                  <input
                    className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
                    value={draft.review_note}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [dialog.id]: { ...draft, review_note: event.target.value },
                      }))
                    }
                    placeholder="кластер / гипотеза"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingId === dialog.id}
                  onClick={() => void saveReview(dialog)}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {savingId === dialog.id ? "Сохраняю…" : "Сохранить"}
                </button>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
