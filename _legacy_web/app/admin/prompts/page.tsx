"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";

type PromptSummary = {
  prompt_key: string;
  prompt_type: string;
  use_case: string | null;
  versions: number;
  active_version: number | null;
  latest_version: number;
  model_hint: string | null;
};

export default function AdminPromptsPage() {
  const [prompts, setPrompts] = useState<PromptSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ prompts: PromptSummary[] }>("/api/admin/prompts")
      .then(({ prompts }) => setPrompts(prompts))
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось загрузить промпты"));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-zinc-100">Промпты</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Версии системных промптов. Активная версия используется боевым кодом; новая версия создаётся поверх, старые
        остаются в истории.
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {prompts === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {prompts?.map((prompt) => (
          <Link
            key={prompt.prompt_key}
            href={`/admin/prompts/${prompt.prompt_key}`}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3 transition-colors hover:border-white/25"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold text-zinc-100">{prompt.prompt_key}</span>
                {prompt.active_version !== null ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    v{prompt.active_version} активна
                  </span>
                ) : (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                    нет активной
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                <span>{prompt.prompt_type}{prompt.use_case ? ` · ${prompt.use_case}` : ""}</span>
                <span>версий: {prompt.versions}</span>
                {prompt.model_hint ? <span>модель: {prompt.model_hint}</span> : null}
              </div>
            </div>
            <ChevronRight size={16} className="shrink-0 text-zinc-600" />
          </Link>
        ))}
      </div>
    </div>
  );
}
