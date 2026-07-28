"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Copy, Loader2, Save, Trash2 } from "lucide-react";

import { adminFetch } from "../../../../../_lib/adminApi";
import {
  EmailDeliveryStats,
  hasDeliveryActivity,
} from "../../../../_components/EmailDeliveryStats";
import {
  EmailMessageWorkspace,
  translateEmptyEmailLocales,
} from "../../../../_components/EmailMessageWorkspace";
import {
  blocksToHtml,
  ensureBlocksFromHtml,
  parseBlocksI18n,
  sanitizeEmailBlocks,
  type BlocksByLocale,
  type EmailBlock,
} from "../../../../_lib/blocks";
import type { ContentLocale } from "../../../../_lib/emailLocales";

type Automation = {
  id: string;
  name: string;
};

type Step = {
  id: string;
  name: string;
  position: number;
  delay_hours: number;
  subject: string;
  subject_i18n: Record<string, string> | null;
  html_body: string;
  html_body_i18n: Record<string, string> | null;
  blocks_i18n: unknown;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count: number;
  failed_count: number;
};

const inputCls =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

export default function AdminEmailAutomationStepPage() {
  const params = useParams<{ id: string; stepId: string }>();
  const automationId = params.id;
  const stepId = params.stepId;
  const router = useRouter();

  const [automation, setAutomation] = useState<Automation | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectI18n, setSubjectI18n] = useState<Record<string, string>>({});
  const [htmlBody, setHtmlBody] = useState("");
  const [htmlI18n, setHtmlI18n] = useState<Record<string, string>>({});
  const [blocksI18n, setBlocksI18n] = useState<BlocksByLocale>({});
  const [delayHours, setDelayHours] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [testTo, setTestTo] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{ automation: Automation; steps: Step[] }>(
        `/api/admin/email/automations/${automationId}`,
      );
      const row = data.steps.find((s) => s.id === stepId);
      if (!row) {
        setError("Письмо не найдено в цепочке");
        return;
      }
      setAutomation(data.automation);
      setStep(row);
      setName((row.name ?? "").trim());
      setSubject(row.subject ?? "");
      setSubjectI18n((row.subject_i18n as Record<string, string>) ?? {});
      setHtmlBody(row.html_body ?? "");
      setHtmlI18n((row.html_body_i18n as Record<string, string>) ?? {});
      let blocks = parseBlocksI18n(row.blocks_i18n);
      if (!blocks.ru?.length && (row.html_body ?? "").trim()) {
        blocks = { ...blocks, ru: ensureBlocksFromHtml(row.html_body) };
      }
      setBlocksI18n(blocks);
      setDelayHours(row.delay_hours ?? 0);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    }
  }, [automationId, stepId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveMeta(): Promise<boolean> {
    setSaving(true);
    setInfo(null);
    try {
      const { step: row } = await adminFetch<{ step: Step }>(
        `/api/admin/email/automations/${automationId}/steps/${stepId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            delay_hours: Math.max(0, Math.floor(delayHours)),
          }),
        },
      );
      setStep(row);
      setName((row.name ?? "").trim());
      setDelayHours(row.delay_hours);
      setInfo("Сохранено");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
      return false;
    } finally {
      setSaving(false);
    }
  }

  /** Dirty title → confirm + save before opening the block editor. */
  async function confirmNameBeforeEdit(): Promise<boolean> {
    const saved = (step?.name ?? "").trim();
    if (name.trim() === saved) return true;
    if (!confirm("Новое название будет сохранено")) return false;
    return saveMeta();
  }

  async function saveLocaleContent(
    locale: ContentLocale,
    nextSubject: string,
    nextBlocks: EmailBlock[],
  ) {
    const cleaned = sanitizeEmailBlocks(nextBlocks);
    const nextBlocksI18n = { ...blocksI18n, [locale]: cleaned };
    const rendered = blocksToHtml(cleaned);
    let nextSubjectRu = subject;
    let nextSubjectI18n = { ...subjectI18n };
    let nextHtmlRu = htmlBody;
    let nextHtmlI18n = { ...htmlI18n };

    if (locale === "ru") {
      nextSubjectRu = nextSubject;
      nextHtmlRu = rendered;
    } else {
      nextSubjectI18n = { ...nextSubjectI18n, [locale]: nextSubject };
      nextHtmlI18n = { ...nextHtmlI18n, [locale]: rendered };
    }

    const { step: row } = await adminFetch<{ step: Step }>(
      `/api/admin/email/automations/${automationId}/steps/${stepId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          subject: nextSubjectRu,
          html_body: nextHtmlRu,
          subject_i18n: nextSubjectI18n,
          html_body_i18n: nextHtmlI18n,
          blocks_i18n: nextBlocksI18n,
        }),
      },
    );
    setStep(row);
    setName((row.name ?? "").trim() || name.trim());
    setSubject(nextSubjectRu);
    setSubjectI18n(nextSubjectI18n);
    setHtmlBody(nextHtmlRu);
    setHtmlI18n(nextHtmlI18n);
    setBlocksI18n(nextBlocksI18n);
    setInfo("Письмо сохранено");
  }

  async function runTranslate() {
    setTranslating(true);
    setError(null);
    try {
      const next = await translateEmptyEmailLocales({
        content: {
          subject,
          subjectI18n,
          htmlBody,
          htmlI18n,
          blocksI18n,
        },
        adminFetch,
      });
      await adminFetch(
        `/api/admin/email/automations/${automationId}/steps/${stepId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subject: next.subject,
            html_body: next.htmlBody,
            subject_i18n: next.subjectI18n,
            html_body_i18n: next.htmlI18n,
            blocks_i18n: next.blocksI18n,
          }),
        },
      );
      setSubject(next.subject);
      setSubjectI18n(next.subjectI18n);
      setHtmlBody(next.htmlBody);
      setHtmlI18n(next.htmlI18n);
      setBlocksI18n(next.blocksI18n);
      setInfo("Переводы заполнены");
    } catch (err) {
      if (err instanceof Error && err.message === "ALL_FILLED") {
        setInfo("Все вкладки уже заполнены");
      } else {
        setError(err instanceof Error ? err.message : "Перевод не удался");
      }
    } finally {
      setTranslating(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setSending(true);
    setError(null);
    try {
      const result = await adminFetch<{ resend_id: string; locale: string }>(
        `/api/admin/email/automations/${automationId}/steps/${stepId}/send`,
        {
          method: "POST",
          body: JSON.stringify({ test_to: testTo.trim() }),
        },
      );
      setInfo(`Тест отправлен (${result.locale}), id ${result.resend_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Тест не удался");
    } finally {
      setSending(false);
    }
  }

  async function copyStep() {
    setError(null);
    try {
      const { step: copy } = await adminFetch<{ step: { id: string } }>(
        `/api/admin/email/automations/${automationId}/steps/${stepId}/copy`,
        { method: "POST", body: "{}" },
      );
      if (!copy?.id) throw new Error("Сервер не вернул id копии");
      router.replace(`/admin/email/automations/${automationId}/steps/${copy.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Копирование не удалось");
    }
  }

  async function removeStep() {
    if (!window.confirm("Удалить это письмо из цепочки?")) return;
    try {
      await adminFetch(
        `/api/admin/email/automations/${automationId}/steps/${stepId}`,
        { method: "DELETE" },
      );
      router.replace(`/admin/email/automations/${automationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    }
  }

  if (!step && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загрузка…
      </div>
    );
  }

  const backHref = `/admin/email/automations/${automationId}`;
  const subtitle = [
    automation?.name?.trim() || "Цепочка",
    step ? `письмо ${step.position}` : null,
    `задержка ${delayHours}ч`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Письмо цепочки</h1>
            <p className="text-xs text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyStep()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Copy size={14} /> Копировать
          </button>
          <button
            type="button"
            onClick={() => void removeStep()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => void saveMeta()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Сохранить
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

      {step && hasDeliveryActivity(step) ? (
        <EmailDeliveryStats counts={step} showUnsubscribed={false} />
      ) : null}

      <label className="block text-xs font-medium text-zinc-500">
        Название письма
        <input
          className={`${inputCls} mt-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Приветствие через сутки"
        />
      </label>

      <EmailMessageWorkspace
        content={{
          subject,
          subjectI18n,
          htmlBody,
          htmlI18n,
          blocksI18n,
        }}
        onSaveLocaleContent={saveLocaleContent}
        onTranslateEmpty={runTranslate}
        translating={translating}
        testTo={testTo}
        onTestToChange={setTestTo}
        onSendTest={sendTest}
        sending={sending}
        showSendBlock
        onBeforeOpenEditor={confirmNameBeforeEdit}
        afterPreview={
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-800">Задержка</h2>
            <label className="block text-xs text-zinc-500">
              Задержка перед отправкой (часов)
              <input
                type="number"
                min={0}
                className={`${inputCls} mt-1 max-w-[200px]`}
                value={delayHours}
                onChange={(e) =>
                  setDelayHours(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
              <span className="mt-1 block text-[11px] text-zinc-400">
                {step?.position === 1
                  ? "После срабатывания условия цепочки"
                  : "После предыдущего письма"}
              </span>
            </label>
          </section>
        }
      />
    </div>
  );
}
