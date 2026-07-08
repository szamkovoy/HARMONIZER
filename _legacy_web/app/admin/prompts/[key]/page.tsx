"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Play } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

type PromptVersion = {
  id: string;
  prompt_key: string;
  prompt_type: string;
  use_case: string | null;
  version: number;
  is_active: boolean;
  template: string;
  variables: Record<string, unknown>;
  model_hint: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
  response_format: string | null;
  notes: string | null;
  created_at: string;
};

/** {{variable}}-плейсхолдеры из шаблона — заготовка для playground. */
function extractVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) names.add(match[1]);
  return [...names];
}

export default function AdminPromptKeyPage() {
  const params = useParams<{ key: string }>();
  const [versions, setVersions] = useState<PromptVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Редактор новой версии
  const [template, setTemplate] = useState("");
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Playground
  const [varsJson, setVarsJson] = useState("{}");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ output: string; modelUsed: string; latencyMs: number } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const selected = useMemo(
    () => versions?.find((v) => v.id === selectedId) ?? versions?.[0] ?? null,
    [versions, selectedId],
  );

  const load = useCallback(async () => {
    try {
      const { versions } = await adminFetch<{ versions: PromptVersion[] }>(`/api/admin/prompts/${params.key}`);
      setVersions(versions);
      const active = versions.find((v) => v.is_active) ?? versions[0];
      setSelectedId(active?.id ?? null);
      if (active) {
        setTemplate(active.template);
        seedVariables(active);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить промпт");
    }
  }, [params.key]);

  function seedVariables(version: PromptVersion) {
    const names = extractVariables(version.template);
    const seed: Record<string, unknown> = {};
    for (const name of names) seed[name] = "";
    setVarsJson(JSON.stringify(seed, null, 2));
  }

  useEffect(() => {
    void load();
  }, [load]);

  function selectVersion(version: PromptVersion) {
    setSelectedId(version.id);
    setTemplate(version.template);
    setTestResult(null);
    setTestError(null);
    seedVariables(version);
  }

  async function activateVersion(version: PromptVersion) {
    setActionError(null);
    try {
      await adminFetch(`/api/admin/prompts/versions/${version.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: true }),
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось активировать");
    }
  }

  async function saveNewVersion() {
    if (!template.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/prompts/${params.key}`, {
        method: "POST",
        body: JSON.stringify({ template, notes: notes.trim() || undefined, activate }),
      });
      setNotes("");
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Не удалось сохранить версию");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!selected) return;
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      let variables: Record<string, unknown>;
      try {
        variables = JSON.parse(varsJson) as Record<string, unknown>;
      } catch {
        throw new Error("Переменные — некорректный JSON");
      }
      const result = await adminFetch<{ output: string; modelUsed: string; latencyMs: number }>(
        "/api/admin/prompts/test",
        {
          method: "POST",
          body: JSON.stringify({
            template,
            variables,
            model_hint: selected.model_hint,
            temperature: selected.temperature,
            max_output_tokens: selected.max_output_tokens,
            response_format: selected.response_format,
          }),
        },
      );
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Тест не удался");
    } finally {
      setTesting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl">
        <BackLink />
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }
  if (!versions || !selected) {
    return (
      <div className="mx-auto max-w-4xl">
        <BackLink />
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      </div>
    );
  }

  const templateChanged = template !== selected.template;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <BackLink />
      <div>
        <h1 className="font-mono text-lg font-bold text-zinc-100">{params.key}</h1>
        <p className="text-xs text-zinc-500">
          {selected.prompt_type}
          {selected.use_case ? ` · ${selected.use_case}` : ""} · модель: {selected.model_hint ?? "по умолчанию"} · t=
          {selected.temperature ?? "—"} · max {selected.max_output_tokens ?? "—"} токенов ·{" "}
          {selected.response_format ?? "text"}
        </p>
      </div>

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
        <h2 className="mb-2 text-sm font-bold text-zinc-100">Версии</h2>
        <div className="flex flex-wrap gap-1.5">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => selectVersion(version)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                version.id === selected.id
                  ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/25"
              }`}
              title={`${formatAdminDateTime(version.created_at)}${version.notes ? ` — ${version.notes}` : ""}`}
            >
              v{version.version}
              {version.is_active ? " ● " : ""}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span>
            v{selected.version} от {formatAdminDateTime(selected.created_at)}
            {selected.is_active ? " — активна" : ""}
          </span>
          {selected.notes ? <span className="italic">«{selected.notes}»</span> : null}
          {!selected.is_active ? (
            <button
              type="button"
              onClick={() => void activateVersion(selected)}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
            >
              <CheckCircle2 size={13} /> Сделать активной
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
        <h2 className="mb-2 text-sm font-bold text-zinc-100">Шаблон</h2>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={16}
          spellCheck={false}
          className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed text-zinc-100 focus:border-white/25 focus:outline-none"
        />
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Заметка к новой версии (что изменили и зачем)"
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void saveNewVersion()}
              disabled={saving || !templateChanged}
              className="rounded-xl bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : `Сохранить как v${(versions[0]?.version ?? 0) + 1}`}
            </button>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
              сразу сделать активной
            </label>
            {!templateChanged ? <span className="text-xs text-zinc-600">шаблон не менялся</span> : null}
            {actionError ? <span className="text-xs text-red-400">{actionError}</span> : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
        <h2 className="mb-1 text-sm font-bold text-zinc-100">Playground</h2>
        <p className="mb-2 text-xs text-zinc-500">
          Текущий шаблон из редактора выше прогоняется через боевой Gemini-пайплайн с этими переменными. В БД ничего не
          пишется.
        </p>
        <textarea
          value={varsJson}
          onChange={(e) => setVarsJson(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-relaxed text-zinc-100 focus:border-white/25 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500/90 px-4 py-2 text-sm font-semibold text-sky-950 transition-colors hover:bg-sky-400 disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {testing ? "Генерирую…" : "Прогнать"}
          </button>
          {testError ? <span className="text-xs text-red-400">{testError}</span> : null}
          {testResult ? (
            <span className="text-xs text-zinc-500">
              {testResult.modelUsed} · {(testResult.latencyMs / 1000).toFixed(1)} с
            </span>
          ) : null}
        </div>
        {testResult ? (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-white/5 bg-black/30 p-3 text-xs leading-relaxed text-zinc-200">
            {testResult.output}
          </pre>
        ) : null}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/prompts" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
      <ArrowLeft size={15} /> Все промпты
    </Link>
  );
}
