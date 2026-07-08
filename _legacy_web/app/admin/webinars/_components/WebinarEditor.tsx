"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Loader2, ThumbsUp, Trash2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";

export type AdminWebinar = {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  join_url: string | null;
  recording_url: string | null;
  is_published: boolean;
};

export type AdminWebinarQuestion = {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  is_hidden: boolean;
  created_at: string;
  vote_count: number;
};

export type AdminWebinarRegistration = {
  user_id: string;
  created_at: string;
  display_name: string;
  email: string;
  membership_tier: string;
};

const dtFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** datetime-local ждёт локальное время без зоны: YYYY-MM-DDTHH:mm. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WebinarEditor({
  webinar,
  questions,
  registrations,
}: {
  webinar: AdminWebinar | null;
  questions: AdminWebinarQuestion[];
  registrations: AdminWebinarRegistration[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(webinar?.title ?? "");
  const [description, setDescription] = useState(webinar?.description ?? "");
  const [startsAt, setStartsAt] = useState(webinar ? toLocalInputValue(webinar.starts_at) : "");
  const [joinUrl, setJoinUrl] = useState(webinar?.join_url ?? "");
  const [recordingUrl, setRecordingUrl] = useState(webinar?.recording_url ?? "");
  const [isPublished, setIsPublished] = useState(webinar?.is_published ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        title,
        description,
        starts_at: startsAt ? new Date(startsAt).toISOString() : "",
        join_url: joinUrl || null,
        recording_url: recordingUrl || null,
        is_published: isPublished,
      };
      if (webinar) {
        await adminFetch(`/api/admin/webinars/${webinar.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        router.refresh();
      } else {
        const { webinar: created } = await adminFetch<{ webinar: AdminWebinar }>("/api/admin/webinars", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        router.replace(`/admin/webinars/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!webinar || !window.confirm("Удалить вебинар вместе с вопросами и регистрациями?")) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/webinars/${webinar.id}`, { method: "DELETE" });
      router.replace("/admin/webinars");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold text-zinc-100">{webinar ? "Вебинар" : "Новый вебинар"}</h1>

      <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Название</span>
          <input required value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Описание (ссылки станут кликабельными)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className={`${inputCls} resize-y`}
          />
        </label>

        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Дата и время (ваш часовой пояс)</span>
            <input
              required
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Ссылка на трансляцию</span>
            <input
              type="url"
              value={joinUrl}
              onChange={(e) => setJoinUrl(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
          </label>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">
            Ссылка на запись (появится у пользователей тарифа «Мастер» после прикрепления)
          </span>
          <input
            type="url"
            value={recordingUrl}
            onChange={(e) => setRecordingUrl(e.target.value)}
            placeholder="https://…"
            className={inputCls}
          />
        </label>

        <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
            className="accent-emerald-500"
          />
          Опубликован (виден в приложении)
        </label>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
          >
            {busy ? "Сохраняю…" : webinar ? "Сохранить" : "Создать"}
          </button>
          {webinar ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
            >
              <Trash2 size={16} strokeWidth={1.8} /> Удалить
            </button>
          ) : null}
        </div>
      </form>

      {webinar ? (
        <>
          <QuestionsModeration initial={questions} />
          <RegistrationsList registrations={registrations} />
        </>
      ) : null}
    </div>
  );
}

function QuestionsModeration({ initial }: { initial: AdminWebinarQuestion[] }) {
  const [questions, setQuestions] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function toggleHidden(question: AdminWebinarQuestion) {
    setBusyId(question.id);
    try {
      await adminFetch(`/api/admin/comments/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_hidden: !question.is_hidden }),
      });
      setQuestions((prev) =>
        prev.map((q) => (q.id === question.id ? { ...q, is_hidden: !question.is_hidden } : q)),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function remove(question: AdminWebinarQuestion) {
    if (!window.confirm("Удалить вопрос безвозвратно?")) return;
    setBusyId(question.id);
    try {
      await adminFetch(`/api/admin/comments/${question.id}`, { method: "DELETE" });
      setQuestions((prev) => prev.filter((q) => q.id !== question.id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="mb-3 text-base font-semibold text-zinc-100">Вопросы ({questions.length})</h2>
      {questions.length === 0 ? <p className="text-sm text-zinc-500">Вопросов пока нет.</p> : null}
      <div className="flex flex-col gap-2">
        {questions.map((question) => (
          <div
            key={question.id}
            className={`flex items-start gap-3 rounded-xl border border-white/10 p-3 ${
              question.is_hidden ? "bg-black/20 opacity-60" : "bg-[rgba(30,32,38,0.92)]"
            }`}
          >
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
              <ThumbsUp size={12} /> {question.vote_count}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-semibold text-zinc-300">{question.display_name}</span>
                <span>{dtFmt.format(new Date(question.created_at))}</span>
                {question.is_hidden ? (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-400">Скрыт</span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{question.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {busyId === question.id ? <Loader2 size={16} className="animate-spin text-zinc-500" /> : null}
              <button
                type="button"
                onClick={() => toggleHidden(question)}
                disabled={busyId === question.id}
                title={question.is_hidden ? "Показать" : "Скрыть"}
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50"
              >
                {question.is_hidden ? <Eye size={16} strokeWidth={1.8} /> : <EyeOff size={16} strokeWidth={1.8} />}
              </button>
              <button
                type="button"
                onClick={() => remove(question)}
                disabled={busyId === question.id}
                title="Удалить"
                className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 size={16} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIER_LABELS: Record<string, string> = {
  free: "Бесплатный",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

function RegistrationsList({ registrations }: { registrations: AdminWebinarRegistration[] }) {
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-base font-semibold text-zinc-100">Записавшиеся ({registrations.length})</h2>
      {registrations.length === 0 ? <p className="text-sm text-zinc-500">Пока никто не записался.</p> : null}
      <div className="flex flex-col gap-1">
        {registrations.map((reg) => (
          <div
            key={reg.user_id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] px-3 py-2 text-sm"
          >
            <span className="font-medium text-zinc-200">{reg.display_name}</span>
            <span className="text-zinc-500">{reg.email}</span>
            <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
              {TIER_LABELS[reg.membership_tier] ?? reg.membership_tier}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
