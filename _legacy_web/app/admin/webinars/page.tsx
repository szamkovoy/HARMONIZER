"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HelpCircle, Loader2, Plus, Users } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";

type WebinarListRow = {
  id: string;
  title: string;
  starts_at: string;
  recording_url: string | null;
  is_published: boolean;
  registration_count: number;
  question_count: number;
};

const dtFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function AdminWebinarsPage() {
  const [webinars, setWebinars] = useState<WebinarListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ webinars: WebinarListRow[] }>("/api/admin/webinars")
      .then(({ webinars }) => setWebinars(webinars))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить вебинары"));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Вебинары</h1>
          <p className="text-sm text-zinc-500">Анонсы, вопросы с голосами, записавшиеся, ссылки на записи.</p>
        </div>
        <Link
          href="/admin/webinars/new"
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950"
        >
          <Plus size={16} strokeWidth={2.2} /> Новый
        </Link>
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {webinars === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {webinars?.length === 0 ? <p className="text-sm text-zinc-500">Пока ни одного вебинара.</p> : null}

      <div className="flex flex-col gap-3">
        {webinars?.map((webinar) => {
          const isPast = new Date(webinar.starts_at).getTime() < Date.now();
          return (
            <Link
              key={webinar.id}
              href={`/admin/webinars/${webinar.id}`}
              className="rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4 transition-colors hover:border-emerald-400/30"
            >
              <p className="font-semibold text-zinc-100">{webinar.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    webinar.is_published ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {webinar.is_published ? "Опубликован" : "Черновик"}
                </span>
                <span className="text-zinc-400">{dtFmt.format(new Date(webinar.starts_at))}</span>
                {isPast ? (
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-zinc-400">
                    {webinar.recording_url ? "Запись прикреплена" : "Прошёл, без записи"}
                  </span>
                ) : null}
                <span className="flex items-center gap-1 text-zinc-500">
                  <Users size={12} /> {webinar.registration_count}
                </span>
                <span className="flex items-center gap-1 text-zinc-500">
                  <HelpCircle size={12} /> {webinar.question_count}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
