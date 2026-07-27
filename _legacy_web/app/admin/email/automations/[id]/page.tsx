"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { adminFetch } from "../../../_lib/adminApi";
import { EmailBlockEditor } from "../../_components/EmailBlockEditor";
import {
  blocksToHtml,
  ensureBlocksFromHtml,
  parseBlocksI18n,
  type EmailBlock,
} from "../../_lib/blocks";

type Automation = {
  id: string;
  key: string;
  name: string;
  trigger_type: string;
  is_active: boolean;
  activated_at: string | null;
};

type Step = {
  id: string;
  position: number;
  delay_hours: number;
  subject: string;
  subject_i18n: Record<string, string> | null;
  html_body: string;
  html_body_i18n: Record<string, string> | null;
  blocks_i18n: unknown;
  sent_count?: number;
  delivered_count?: number;
  opened_count?: number;
  clicked_count?: number;
  bounced_count?: number;
  complained_count?: number;
  failed_count?: number;
};

const TRIGGER_OPTS: { value: string; label: string }[] = [
  { value: "account_registered", label: "Регистрация аккаунта (первый OTP)" },
  { value: "subscription_expired", label: "Не продлил подписку (через 3 дня)" },
  { value: "inactive", label: "Неактивен 14 дней" },
  { value: "manual", label: "Только вручную" },
];

const inputCls =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

export default function AdminEmailAutomationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("manual");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorStepId, setEditorStepId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ automation: Automation; steps: Step[] }>(
        `/api/admin/email/automations/${id}`,
      );
      setAutomation(data.automation);
      setName(data.automation.name);
      setTriggerType(data.automation.trigger_type);
      setSteps(data.steps);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const editorStep = useMemo(
    () => steps.find((s) => s.id === editorStepId) ?? null,
    [steps, editorStepId],
  );

  const editorBlocks: EmailBlock[] = useMemo(() => {
    if (!editorStep) return [];
    const blocks = parseBlocksI18n(editorStep.blocks_i18n);
    if (blocks.ru?.length) return blocks.ru;
    return ensureBlocksFromHtml(editorStep.html_body || "");
  }, [editorStep]);

  async function saveMeta() {
    setSaving(true);
    setInfo(null);
    try {
      const { automation: row } = await adminFetch<{ automation: Automation }>(
        `/api/admin/email/automations/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), trigger_type: triggerType }),
        },
      );
      setAutomation(row);
      setInfo("Сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!automation) return;
    setSaving(true);
    try {
      const { automation: row } = await adminFetch<{ automation: Automation }>(
        `/api/admin/email/automations/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !automation.is_active }),
        },
      );
      setAutomation(row);
      setInfo(row.is_active ? "Цепочка включена" : "Цепочка выключена");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переключить");
    } finally {
      setSaving(false);
    }
  }

  async function addStep() {
    try {
      await adminFetch(`/api/admin/email/automations/${id}/steps`, {
        method: "POST",
        body: JSON.stringify({
          delay_hours: 0,
          subject: "Новое письмо",
          html_body: "<p>Текст…</p>",
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить");
    }
  }

  async function updateDelay(stepId: string, delay_hours: number) {
    try {
      await adminFetch(`/api/admin/email/automations/${id}/steps/${stepId}`, {
        method: "PATCH",
        body: JSON.stringify({ delay_hours }),
      });
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, delay_hours } : s)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить delay");
    }
  }

  async function moveStep(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= steps.length) return;
    const ordered = [...steps];
    [ordered[index], ordered[j]] = [ordered[j], ordered[index]];
    const ordered_ids = ordered.map((s) => s.id);
    setSteps(ordered.map((s, i) => ({ ...s, position: i + 1 })));
    try {
      await adminFetch(`/api/admin/email/automations/${id}/steps`, {
        method: "PATCH",
        body: JSON.stringify({ ordered_ids }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось переместить");
      await load();
    }
  }

  async function removeStep(stepId: string) {
    if (!window.confirm("Удалить это письмо из цепочки?")) return;
    try {
      await adminFetch(`/api/admin/email/automations/${id}/steps/${stepId}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  }

  async function saveStepContent(next: { subject: string; blocks: EmailBlock[] }) {
    if (!editorStepId) return;
    const html = blocksToHtml(next.blocks);
    const blocks_i18n = { ru: next.blocks };
    await adminFetch(`/api/admin/email/automations/${id}/steps/${editorStepId}`, {
      method: "PATCH",
      body: JSON.stringify({
        subject: next.subject,
        html_body: html,
        blocks_i18n,
      }),
    });
    await load();
  }

  async function removeChain() {
    if (!window.confirm("Удалить всю цепочку?")) return;
    try {
      await adminFetch(`/api/admin/email/automations/${id}`, { method: "DELETE" });
      router.replace("/admin/email/automations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  }

  if (!automation && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/email/automations"
            className="text-zinc-500 hover:text-zinc-800"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{name.trim() || "Цепочка"}</h1>
            <p className="text-xs text-zinc-500">
              {automation?.key}
              {automation?.activated_at
                ? ` · активирована ${new Date(automation.activated_at).toLocaleString("ru")}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void removeChain()}
            className="rounded-xl border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveMeta()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Сохранить
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void toggleActive()}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              automation?.is_active
                ? "bg-emerald-600 text-white"
                : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {automation?.is_active ? "Активна — выкл." : "Выключена — вкл."}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </div>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <label className="block text-xs font-medium text-zinc-500">
          Название цепочки
          <input
            className={`${inputCls} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium text-zinc-500">
          Условие срабатывания
          <select
            className={`${inputCls} mt-1`}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
          >
            {TRIGGER_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-zinc-400">
          Для регистрации: письмо уходит один раз после первого подтверждения OTP (не при
          каждом коде). C1 — через 3 дня после окончания любой платной подписки. C2 — 14
          дней без захода в приложение. Delay первого письма — от момента срабатывания;
          у следующих — от предыдущего письма.
        </p>
      </section>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Письма в цепочке</h2>
          <button
            type="button"
            onClick={() => void addStep()}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white"
          >
            <Plus size={14} /> Добавить письмо
          </button>
        </div>

        {steps.length === 0 ? (
          <p className="text-sm text-zinc-500">Пока нет писем — добавьте первое.</p>
        ) : (
          <ul className="space-y-3">
            {steps.map((s, index) => (
              <li
                key={s.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-zinc-500">
                      Письмо {index + 1}
                    </div>
                    <div className="font-medium text-zinc-900">
                      {s.subject.trim() || "без темы"}
                    </div>
                    {(s.sent_count ?? 0) > 0 || (s.failed_count ?? 0) > 0 ? (
                      <div className="mt-1 text-[11px] text-zinc-500">
                        отпр. {s.sent_count ?? 0}
                        {" · "}дост. {s.delivered_count ?? 0}
                        {" · "}откр. {s.opened_count ?? 0}
                        {" · "}клики {s.clicked_count ?? 0}
                        {" · "}отказ {s.bounced_count ?? 0}
                        {(s.complained_count ?? 0) > 0
                          ? ` · спам ${s.complained_count}`
                          : ""}
                        {(s.failed_count ?? 0) > 0
                          ? ` · ошиб. ${s.failed_count}`
                          : ""}
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-zinc-400">
                        статистика появится после отправок
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      title="Вверх"
                      onClick={() => void moveStep(index, -1)}
                      className="rounded border border-zinc-200 bg-white p-1.5 text-zinc-600"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      title="Вниз"
                      onClick={() => void moveStep(index, 1)}
                      className="rounded border border-zinc-200 bg-white p-1.5 text-zinc-600"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorStepId(s.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white"
                    >
                      <Pencil size={12} /> Редактировать
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeStep(s.id)}
                      className="rounded border border-rose-200 p-1.5 text-rose-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <label className="mt-2 block text-xs text-zinc-500">
                  Задержка перед отправкой (часов)
                  <input
                    type="number"
                    min={0}
                    className={`${inputCls} mt-1 max-w-[160px]`}
                    value={s.delay_hours}
                    onChange={(e) => {
                      const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setSteps((prev) =>
                        prev.map((x) =>
                          x.id === s.id ? { ...x, delay_hours: n } : x,
                        ),
                      );
                    }}
                    onBlur={(e) => {
                      const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                      void updateDelay(s.id, n);
                    }}
                  />
                  <span className="mt-1 block text-[11px] text-zinc-400">
                    {index === 0
                      ? "После срабатывания условия цепочки"
                      : "После предыдущего письма"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editorStep ? (
        <EmailBlockEditor
          localeLabel="RU"
          subject={editorStep.subject}
          blocks={editorBlocks}
          onSave={async (next) => {
            await saveStepContent(next);
          }}
          onClose={() => setEditorStepId(null)}
        />
      ) : null}
    </div>
  );
}
