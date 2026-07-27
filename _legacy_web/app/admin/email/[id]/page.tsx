"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import { EmailBlockEditor } from "../_components/EmailBlockEditor";
import { EmailInlinePreview } from "../_components/EmailInlinePreview";
import {
  blocksForLocale,
  blocksToHtml,
  ensureBlocksFromHtml,
  localeHasEmailCopy,
  parseBlocksI18n,
  type BlocksByLocale,
  type EmailBlock,
} from "../_lib/blocks";

const TARGET_LOCALES = ["en", "de", "fr", "it", "es", "pt", "nl"] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];
type ContentLocale = "ru" | TargetLocale;

const LOCALE_LABELS: Record<ContentLocale, string> = {
  ru: "RU",
  en: "EN",
  de: "DE",
  fr: "FR",
  it: "IT",
  es: "ES",
  pt: "PT",
  nl: "NL",
};

type Campaign = {
  id: string;
  status: string;
  name: string;
  subject: string;
  html_body: string;
  subject_i18n?: Record<string, string> | null;
  html_body_i18n?: Record<string, string> | null;
  blocks_i18n?: unknown;
  segment_query?: Record<string, unknown> | null;
  recipient_count: number;
  skipped_locale_count: number;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  complained_count: number;
  unsubscribed_count: number;
  error_count: number;
  sent_at: string | null;
  created_at: string;
};

type SegmentState = {
  all_installed: boolean;
  include_demo: boolean;
  membership_tiers: Array<"free" | "oracle" | "master">;
  last_seen_within_days: string;
  last_seen_older_than_days: string;
  email_contains: string;
};

const DEFAULT_SEGMENT: SegmentState = {
  all_installed: true,
  include_demo: false,
  membership_tiers: [],
  last_seen_within_days: "",
  last_seen_older_than_days: "",
  email_contains: "",
};

const inputCls =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

function positiveDays(raw: string): number | undefined {
  const n = Math.floor(Number(String(raw).trim()));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function segmentToQuery(s: SegmentState): Record<string, unknown> {
  const within = positiveDays(s.last_seen_within_days);
  const older = positiveDays(s.last_seen_older_than_days);
  const email = s.email_contains.trim().toLowerCase() || undefined;
  const base = {
    marketing_statuses: ["active"] as string[],
    ...(within != null ? { last_seen_within_days: within } : {}),
    ...(older != null ? { last_seen_older_than_days: older } : {}),
    ...(email ? { email_contains: email } : {}),
  };
  if (s.all_installed) {
    return { ...base, all_installed: true };
  }
  return {
    ...base,
    all_installed: false,
    include_demo: s.include_demo,
    membership_tiers: s.membership_tiers,
  };
}

function queryToSegment(raw: Record<string, unknown> | null | undefined): SegmentState {
  const s = { ...DEFAULT_SEGMENT };
  if (!raw) return s;
  s.all_installed = raw.all_installed === true;
  s.include_demo = raw.include_demo === true && !s.all_installed;
  if (Array.isArray(raw.membership_tiers) && !s.all_installed) {
    s.membership_tiers = raw.membership_tiers.filter(
      (v): v is "free" | "oracle" | "master" =>
        v === "free" || v === "oracle" || v === "master",
    );
  }
  if (raw.last_seen_within_days != null && String(raw.last_seen_within_days).trim()) {
    s.last_seen_within_days = String(raw.last_seen_within_days);
  }
  if (raw.last_seen_older_than_days != null && String(raw.last_seen_older_than_days).trim()) {
    s.last_seen_older_than_days = String(raw.last_seen_older_than_days);
  }
  if (typeof raw.email_contains === "string") s.email_contains = raw.email_contains;
  // Migrate old linked_only-only drafts
  if (
    !s.all_installed &&
    !s.include_demo &&
    s.membership_tiers.length === 0 &&
    (raw.linked_only === true || Object.keys(raw).length === 0)
  ) {
    s.all_installed = true;
  }
  return s;
}

export default function AdminEmailCampaignPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentLocale>("ru");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectI18n, setSubjectI18n] = useState<Record<string, string>>({});
  const [htmlBody, setHtmlBody] = useState("");
  const [htmlI18n, setHtmlI18n] = useState<Record<string, string>>({});
  const [blocksI18n, setBlocksI18n] = useState<BlocksByLocale>({});
  const [segment, setSegment] = useState<SegmentState>(DEFAULT_SEGMENT);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [testTo, setTestTo] = useState("");

  const readOnly = campaign?.status === "sent" || campaign?.status === "sending";

  const load = useCallback(async () => {
    try {
      const { campaign: row } = await adminFetch<{ campaign: Campaign }>(
        `/api/admin/email/campaigns/${id}`,
      );
      setCampaign(row);
      setName(row.name ?? "");
      setSubject(row.subject ?? "");
      setSubjectI18n((row.subject_i18n as Record<string, string>) ?? {});
      setHtmlBody(row.html_body ?? "");
      setHtmlI18n((row.html_body_i18n as Record<string, string>) ?? {});
      let blocks = parseBlocksI18n(row.blocks_i18n);
      if (!blocks.ru?.length && (row.html_body ?? "").trim()) {
        blocks = { ...blocks, ru: ensureBlocksFromHtml(row.html_body) };
      }
      setBlocksI18n(blocks);
      setSegment(queryToSegment(row.segment_query as Record<string, unknown>));
      setRecipientCount(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewSubject = useMemo(() => {
    return activeTab === "ru" ? subject : (subjectI18n[activeTab] ?? "");
  }, [activeTab, subject, subjectI18n]);

  const previewBodyHtml = useMemo(() => {
    const blocks = blocksForLocale(blocksI18n, activeTab);
    let body = blocksToHtml(blocks);
    if (!body) {
      body = activeTab === "ru" ? htmlBody : (htmlI18n[activeTab] ?? "");
    }
    return body;
  }, [activeTab, blocksI18n, htmlBody, htmlI18n]);

  function hasCopy(locale: ContentLocale): boolean {
    return localeHasEmailCopy(locale, subject, subjectI18n, htmlBody, htmlI18n, blocksI18n);
  }

  async function refreshCount() {
    setCounting(true);
    try {
      const { count } = await adminFetch<{ count: number }>("/api/admin/email/segment", {
        method: "POST",
        body: JSON.stringify({ query: segmentToQuery(segment) }),
      });
      setRecipientCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось посчитать сегмент");
    } finally {
      setCounting(false);
    }
  }

  async function saveMeta() {
    if (readOnly) return;
    setSaving(true);
    setInfo(null);
    try {
      const { campaign: row } = await adminFetch<{ campaign: Campaign }>(
        `/api/admin/email/campaigns/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            segment_query: segmentToQuery(segment),
          }),
        },
      );
      setCampaign(row);
      setInfo("Сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function saveLocaleContent(nextSubject: string, nextBlocks: EmailBlock[]) {
    const nextBlocksI18n = { ...blocksI18n, [activeTab]: nextBlocks };
    const rendered = blocksToHtml(nextBlocks);
    let nextSubjectRu = subject;
    let nextSubjectI18n = { ...subjectI18n };
    let nextHtmlRu = htmlBody;
    let nextHtmlI18n = { ...htmlI18n };

    if (activeTab === "ru") {
      nextSubjectRu = nextSubject;
      nextHtmlRu = rendered;
    } else {
      nextSubjectI18n = { ...nextSubjectI18n, [activeTab]: nextSubject };
      nextHtmlI18n = { ...nextHtmlI18n, [activeTab]: rendered };
    }

    const { campaign: row } = await adminFetch<{ campaign: Campaign }>(
      `/api/admin/email/campaigns/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          subject: nextSubjectRu,
          html_body: nextHtmlRu,
          subject_i18n: nextSubjectI18n,
          html_body_i18n: nextHtmlI18n,
          blocks_i18n: nextBlocksI18n,
        }),
      },
    );
    setCampaign(row);
    setSubject(nextSubjectRu);
    setSubjectI18n(nextSubjectI18n);
    setHtmlBody(nextHtmlRu);
    setHtmlI18n(nextHtmlI18n);
    setBlocksI18n(nextBlocksI18n);
    setInfo("Письмо сохранено");
  }

  async function runTranslate() {
    const sourceLocale: ContentLocale = hasCopy("ru")
      ? "ru"
      : (TARGET_LOCALES.find((l) => hasCopy(l)) ?? "ru");
    const sourceSubject =
      sourceLocale === "ru" ? subject.trim() : (subjectI18n[sourceLocale] ?? "").trim();
    const sourceBlocks = blocksForLocale(blocksI18n, sourceLocale);
    const sourceBody =
      blocksToHtml(sourceBlocks) ||
      (sourceLocale === "ru" ? htmlBody : (htmlI18n[sourceLocale] ?? ""));
    if (!sourceSubject) {
      setError("Заполните тему хотя бы на одном языке");
      return;
    }
    const fillLocales = (["ru", ...TARGET_LOCALES] as ContentLocale[]).filter(
      (locale) => locale !== sourceLocale && !hasCopy(locale),
    );
    if (fillLocales.length === 0) {
      setInfo("Все вкладки уже заполнены");
      return;
    }
    setTranslating(true);
    setError(null);
    try {
      const { translations } = await adminFetch<{
        translations: Record<string, { title: string; body: string }>;
      }>("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({
          type: "post",
          source_locale: sourceLocale,
          source_title: sourceSubject,
          source_body: sourceBody,
          fill_locales: fillLocales,
        }),
      });

      let nextSubject = subject;
      const nextSubjectI18n = { ...subjectI18n };
      let nextHtml = htmlBody;
      const nextHtmlI18n = { ...htmlI18n };
      let nextBlocks = { ...blocksI18n };

      if (translations.ru && !hasCopy("ru")) {
        nextSubject = translations.ru.title;
        nextHtml = translations.ru.body;
        nextBlocks = { ...nextBlocks, ru: ensureBlocksFromHtml(translations.ru.body) };
      }
      for (const locale of TARGET_LOCALES) {
        const t = translations[locale];
        if (!t || hasCopy(locale)) continue;
        nextSubjectI18n[locale] = t.title;
        nextHtmlI18n[locale] = t.body;
        nextBlocks[locale] = ensureBlocksFromHtml(t.body);
      }

      await adminFetch(`/api/admin/email/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: nextSubject,
          html_body: nextHtml,
          subject_i18n: nextSubjectI18n,
          html_body_i18n: nextHtmlI18n,
          blocks_i18n: nextBlocks,
        }),
      });
      setSubject(nextSubject);
      setSubjectI18n(nextSubjectI18n);
      setHtmlBody(nextHtml);
      setHtmlI18n(nextHtmlI18n);
      setBlocksI18n(nextBlocks);
      setInfo("Переводы заполнены");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Перевод не удался");
    } finally {
      setTranslating(false);
    }
  }

  async function sendCampaign(e: FormEvent) {
    e.preventDefault();
    if (!campaign || readOnly) return;
    if (recipientCount === null) {
      setError("Сначала обновите число получателей (кнопка со стрелками)");
      return;
    }
    if (!confirm(`Отправить рассылку примерно ${recipientCount} получателям?`)) return;
    setSending(true);
    setError(null);
    try {
      await saveMeta();
      const result = await adminFetch<{
        sent_count: number;
        skipped_locale_count: number;
        error_count: number;
        campaign: Campaign;
      }>(`/api/admin/email/campaigns/${id}/send`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setCampaign(result.campaign);
      setInfo(
        `Отправлено: ${result.sent_count}, пропущено (нет языка): ${result.skipped_locale_count}, ошибок: ${result.error_count}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Отправка не удалась");
    } finally {
      setSending(false);
    }
  }

  async function sendTest() {
    if (!testTo.trim()) return;
    setSending(true);
    try {
      const result = await adminFetch<{ resend_id: string; locale: string }>(
        `/api/admin/email/campaigns/${id}/send`,
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

  async function copyCampaign() {
    try {
      const { campaign: copy } = await adminFetch<{ campaign: { id: string } }>(
        `/api/admin/email/campaigns/${id}/copy`,
        { method: "POST", body: "{}" },
      );
      router.push(`/admin/email/${copy.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Копирование не удалось");
    }
  }

  async function remove() {
    if (!confirm("Удалить рассылку?")) return;
    try {
      await adminFetch(`/api/admin/email/campaigns/${id}`, { method: "DELETE" });
      router.push("/admin/email");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Удаление не удалось");
    }
  }

  function selectAllInstalled() {
    setSegment((p) => ({
      ...p,
      all_installed: true,
      include_demo: false,
      membership_tiers: [],
    }));
    setRecipientCount(null);
  }

  function toggleDemo() {
    setSegment((p) => ({
      ...p,
      all_installed: false,
      include_demo: !p.include_demo,
    }));
    setRecipientCount(null);
  }

  function toggleTier(tier: "free" | "oracle" | "master") {
    setSegment((p) => {
      const has = p.membership_tiers.includes(tier);
      return {
        ...p,
        all_installed: false,
        membership_tiers: has
          ? p.membership_tiers.filter((t) => t !== tier)
          : [...p.membership_tiers, tier],
      };
    });
    setRecipientCount(null);
  }

  const editorBlocks = useMemo(() => {
    const existing = blocksForLocale(blocksI18n, activeTab);
    if (existing.length) return existing;
    const html = activeTab === "ru" ? htmlBody : (htmlI18n[activeTab] ?? "");
    return ensureBlocksFromHtml(html);
  }, [activeTab, blocksI18n, htmlBody, htmlI18n]);

  if (!campaign && !error) {
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
          <Link href="/admin/email" className="text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">
              {name.trim() || "Рассылка"}
            </h1>
            <p className="text-xs text-zinc-500">
              {campaign?.status}
              {campaign?.sent_at ? ` · ${formatAdminDateTime(campaign.sent_at)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copyCampaign()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            <Copy size={14} /> Копировать
          </button>
          {!readOnly ? (
            <>
              <button
                type="button"
                onClick={() => void remove()}
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
            </>
          ) : null}
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

      <label className="block text-xs font-medium text-zinc-500">
        Название рассылки
        <input
          className={`${inputCls} mt-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          placeholder="Например: Вебинар 25.07"
        />
      </label>

      {campaign && (campaign.status === "sent" || campaign.sent_count > 0) ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-8">
          {[
            ["Отправлено", campaign.sent_count],
            ["Доставлено", campaign.delivered_count],
            ["Открыто", campaign.opened_count],
            ["Клики", campaign.clicked_count],
            ["Отказ", campaign.bounced_count],
            ["Спам", campaign.complained_count],
            ["Отписались", campaign.unsubscribed_count],
            ["Ошибки", campaign.error_count],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-center"
            >
              <div className="text-lg font-semibold text-zinc-900">{value}</div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {(Object.keys(LOCALE_LABELS) as ContentLocale[]).map((locale) => (
          <button
            key={locale}
            type="button"
            onClick={() => setActiveTab(locale)}
            className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold ${
              activeTab === locale
                ? "bg-emerald-600 text-white"
                : "text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {LOCALE_LABELS[locale]}
            {hasCopy(locale) ? (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300" />
            ) : null}
          </button>
        ))}
        {!readOnly ? (
          <>
            <button
              type="button"
              onClick={() => void runTranslate()}
              disabled={translating}
              className="ml-2 rounded-lg px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {translating ? "Перевод…" : "Перевести пустые"}
            </button>
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              <Pencil size={14} /> Редактировать
            </button>
          </>
        ) : null}
      </div>

      <EmailInlinePreview
        subject={previewSubject}
        localeLabel={LOCALE_LABELS[activeTab]}
        bodyHtml={previewBodyHtml}
      />

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Сегмент</h2>
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <span>
              Получателей:{" "}
              {recipientCount === null ? "— нажмите обновить" : recipientCount}
            </span>
            <button
              type="button"
              title="Обновить число получателей"
              onClick={() => void refreshCount()}
              disabled={counting || readOnly}
              className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              {counting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <RefreshCw size={16} />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "demo", label: "Демо", on: segment.include_demo && !segment.all_installed },
              {
                key: "free",
                label: "Навигатор",
                on: segment.membership_tiers.includes("free") && !segment.all_installed,
              },
              {
                key: "oracle",
                label: "Наставник",
                on: segment.membership_tiers.includes("oracle") && !segment.all_installed,
              },
              {
                key: "master",
                label: "Мастер",
                on: segment.membership_tiers.includes("master") && !segment.all_installed,
              },
              { key: "all", label: "Все установившие", on: segment.all_installed },
            ] as const
          ).map((chip) => (
            <button
              key={chip.key}
              type="button"
              disabled={readOnly}
              onClick={() => {
                if (chip.key === "all") selectAllInstalled();
                else if (chip.key === "demo") toggleDemo();
                else toggleTier(chip.key);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs ${
                chip.on
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-500">
            Был в приложении ≤ N дней назад
            <input
              className={`${inputCls} mt-1`}
              value={segment.last_seen_within_days}
              disabled={readOnly}
              onChange={(e) => {
                setSegment((p) => ({ ...p, last_seen_within_days: e.target.value }));
                setRecipientCount(null);
              }}
              placeholder="например 7"
              inputMode="numeric"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Не заходил ≥ N дней
            <input
              className={`${inputCls} mt-1`}
              value={segment.last_seen_older_than_days}
              disabled={readOnly}
              onChange={(e) => {
                setSegment((p) => ({ ...p, last_seen_older_than_days: e.target.value }));
                setRecipientCount(null);
              }}
              placeholder="например 30"
              inputMode="numeric"
            />
          </label>
          <label className="text-xs text-zinc-500 sm:col-span-2">
            Email содержит
            <input
              className={`${inputCls} mt-1`}
              value={segment.email_contains}
              disabled={readOnly}
              onChange={(e) => {
                setSegment((p) => ({ ...p, email_contains: e.target.value }));
                setRecipientCount(null);
              }}
            />
          </label>
        </div>
      </section>

      <form
        onSubmit={(e) => void sendCampaign(e)}
        className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-zinc-800">Отправка</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-xs text-zinc-500">
            Тест на email
            <input
              className={`${inputCls} mt-1`}
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={sending || !testTo.trim()}
            className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Тест
          </button>
          {!readOnly ? (
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              Отправить сегменту
            </button>
          ) : null}
        </div>
      </form>

      {editorOpen ? (
        <EmailBlockEditor
          localeLabel={LOCALE_LABELS[activeTab]}
          subject={activeTab === "ru" ? subject : (subjectI18n[activeTab] ?? "")}
          blocks={editorBlocks}
          onClose={() => setEditorOpen(false)}
          onSave={async ({ subject: s, blocks }) => {
            await saveLocaleContent(s, blocks);
          }}
        />
      ) : null}
    </div>
  );
}
