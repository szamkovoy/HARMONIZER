"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  RefreshCw,
  Save,
  Square,
  Trash2,
} from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";
import {
  EmailDeliveryStats,
  hasDeliveryActivity,
} from "../_components/EmailDeliveryStats";
import {
  EmailMessageWorkspace,
  translateEmptyEmailLocales,
} from "../_components/EmailMessageWorkspace";
import {
  blocksToHtml,
  sanitizeEmailBlocks,
  ensureBlocksFromHtml,
  parseBlocksI18n,
  type BlocksByLocale,
  type EmailBlock,
} from "../_lib/blocks";
import type { ContentLocale } from "../_lib/emailLocales";

type CampaignProgress = {
  queued: number;
  accepted: number;
  failed: number;
  remaining_estimate: number | null;
  next_wave_size: number;
  next_wave_at: string | null;
  halted: boolean;
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
  warmup_plan?: { sizes?: number[]; hour_msk?: number; repeat_last?: boolean } | null;
  warmup_wave_index?: number;
  next_wave_at?: string | null;
  next_wave_size?: number | null;
  audience_cap?: number | null;
  send_halted_at?: string | null;
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
  /** Entire email_contacts base (incl. non-installers). */
  all_contacts: boolean;
  /** App accounts only (OTP confirmed → linked user_id). */
  all_installed: boolean;
  /** Active trial (trial_expires_at) — same «Демо» as /admin/users. */
  include_demo: boolean;
  /** Registered in the last 24 hours. */
  include_new_24h: boolean;
  /** App user without Harmonizer onboarding (excl. GetCourse email-only). */
  not_in_harmonizer: boolean;
  /** GetCourse import who never opened the app. */
  email_only: boolean;
  membership_tiers: Array<"free" | "oracle" | "master">;
  last_seen_within_days: string;
  last_seen_older_than_days: string;
  account_created_on_or_after: string;
  account_created_on_or_before: string;
  onboarded_on_or_after: string;
  onboarded_on_or_before: string;
  /** Profile locale filter (empty = any). */
  locale: string;
  email_contains: string;
};

const DEFAULT_SEGMENT: SegmentState = {
  all_contacts: true,
  all_installed: false,
  include_demo: false,
  include_new_24h: false,
  not_in_harmonizer: false,
  email_only: false,
  membership_tiers: [],
  last_seen_within_days: "",
  last_seen_older_than_days: "",
  account_created_on_or_after: "",
  account_created_on_or_before: "",
  onboarded_on_or_after: "",
  onboarded_on_or_before: "",
  locale: "",
  email_contains: "",
};

const SEGMENT_LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;

const STATUS_RU: Record<string, string> = {
  draft: "черновик",
  sending: "отправка…",
  paused: "пауза",
  sent: "отправлено",
  failed: "ошибка",
};

const inputCls =
  "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

function positiveDays(raw: string): number | undefined {
  const n = Math.floor(Number(String(raw).trim()));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function dateOnly(raw: string): string | undefined {
  const t = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : undefined;
}

function segmentToQuery(s: SegmentState): Record<string, unknown> {
  const within = positiveDays(s.last_seen_within_days);
  const older = positiveDays(s.last_seen_older_than_days);
  const email = s.email_contains.trim().toLowerCase() || undefined;
  const accAfter = dateOnly(s.account_created_on_or_after);
  const accBefore = dateOnly(s.account_created_on_or_before);
  const onbAfter = dateOnly(s.onboarded_on_or_after);
  const onbBefore = dateOnly(s.onboarded_on_or_before);
  const locale = s.locale.trim().toLowerCase().slice(0, 2);
  const base = {
    marketing_statuses: ["active"] as string[],
    ...(within != null ? { last_seen_within_days: within } : {}),
    ...(older != null ? { last_seen_older_than_days: older } : {}),
    ...(accAfter ? { account_created_on_or_after: accAfter } : {}),
    ...(accBefore ? { account_created_on_or_before: accBefore } : {}),
    ...(onbAfter ? { onboarded_on_or_after: onbAfter } : {}),
    ...(onbBefore ? { onboarded_on_or_before: onbBefore } : {}),
    ...(locale ? { locales: [locale] } : {}),
    ...(email ? { email_contains: email } : {}),
  };
  if (s.all_contacts) {
    return { ...base, all_contacts: true };
  }
  if (s.all_installed) {
    return { ...base, all_installed: true };
  }
  return {
    ...base,
    all_contacts: false,
    all_installed: false,
    include_demo: s.include_demo,
    include_new_24h: s.include_new_24h,
    not_in_harmonizer: s.not_in_harmonizer,
    email_only: s.email_only,
    membership_tiers: s.membership_tiers,
  };
}

function queryToSegment(raw: Record<string, unknown> | null | undefined): SegmentState {
  const s = { ...DEFAULT_SEGMENT };
  if (!raw) return s;
  s.all_contacts = raw.all_contacts === true;
  s.all_installed = raw.all_installed === true && !s.all_contacts;
  s.include_demo = raw.include_demo === true && !s.all_installed && !s.all_contacts;
  s.include_new_24h =
    raw.include_new_24h === true && !s.all_installed && !s.all_contacts;
  s.not_in_harmonizer =
    raw.not_in_harmonizer === true && !s.all_installed && !s.all_contacts;
  s.email_only = raw.email_only === true && !s.all_installed && !s.all_contacts;
  if (Array.isArray(raw.membership_tiers) && !s.all_installed && !s.all_contacts) {
    s.membership_tiers = raw.membership_tiers.filter(
      (v): v is "free" | "oracle" | "master" =>
        v === "free" || v === "oracle" || v === "master",
    );
  }
  if (Array.isArray(raw.locales) && raw.locales.length === 1 && typeof raw.locales[0] === "string") {
    s.locale = raw.locales[0].slice(0, 2).toLowerCase();
  }
  if (raw.last_seen_within_days != null && String(raw.last_seen_within_days).trim()) {
    s.last_seen_within_days = String(raw.last_seen_within_days);
  }
  if (raw.last_seen_older_than_days != null && String(raw.last_seen_older_than_days).trim()) {
    s.last_seen_older_than_days = String(raw.last_seen_older_than_days);
  }
  if (typeof raw.account_created_on_or_after === "string") {
    s.account_created_on_or_after = raw.account_created_on_or_after;
  }
  if (typeof raw.account_created_on_or_before === "string") {
    s.account_created_on_or_before = raw.account_created_on_or_before;
  }
  if (typeof raw.onboarded_on_or_after === "string") {
    s.onboarded_on_or_after = raw.onboarded_on_or_after;
  }
  if (typeof raw.onboarded_on_or_before === "string") {
    s.onboarded_on_or_before = raw.onboarded_on_or_before;
  }
  if (typeof raw.email_contains === "string") s.email_contains = raw.email_contains;
  if (
    !s.all_contacts &&
    !s.all_installed &&
    !s.include_demo &&
    !s.include_new_24h &&
    !s.not_in_harmonizer &&
    !s.email_only &&
    s.membership_tiers.length === 0
  ) {
    // Legacy: email-only → whole base; empty → all contacts default.
    if (typeof raw.email_contains === "string" && raw.email_contains.trim()) {
      s.all_contacts = true;
    } else if (raw.linked_only === true) {
      s.all_installed = true;
    } else if (Object.keys(raw).length === 0) {
      s.all_contacts = true;
    }
  }
  return s;
}

export default function AdminEmailCampaignPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [progress, setProgress] = useState<CampaignProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectI18n, setSubjectI18n] = useState<Record<string, string>>({});
  const [htmlBody, setHtmlBody] = useState("");
  const [htmlI18n, setHtmlI18n] = useState<Record<string, string>>({});
  const [blocksI18n, setBlocksI18n] = useState<BlocksByLocale>({});
  const [segment, setSegment] = useState<SegmentState>(DEFAULT_SEGMENT);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [skippedLocaleCount, setSkippedLocaleCount] = useState(0);
  const [segmentHint, setSegmentHint] = useState<string | null>(null);
  const [counting, setCounting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [audienceCap, setAudienceCap] = useState("");
  const [testTo, setTestTo] = useState("");

  const sendingNow = campaign?.status === "sending";
  const finished = campaign?.status === "sent";
  const readOnly = sendingNow || finished;

  const load = useCallback(async () => {
    try {
      const { campaign: row, progress: prog } = await adminFetch<{
        campaign: Campaign;
        progress?: CampaignProgress;
      }>(`/api/admin/email/campaigns/${id}`);
      setCampaign(row);
      setProgress(prog ?? null);
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
      setAudienceCap(row.audience_cap != null ? String(row.audience_cap) : "");
      setRecipientCount(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (campaign?.status !== "sending") return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [campaign?.status, load]);

  async function refreshCount(): Promise<{
    count: number;
    copyEmpty: boolean;
  } | null> {
    setCounting(true);
    setSegmentHint(null);
    try {
      const result = await adminFetch<{
        count: number;
        segment_count?: number;
        skipped_locale_count?: number;
        copy_empty?: boolean;
        no_audience?: boolean;
      }>("/api/admin/email/segment", {
        method: "POST",
        body: JSON.stringify({
          query: segmentToQuery(segment),
          subject,
          html_body: htmlBody,
          subject_i18n: subjectI18n,
          html_body_i18n: htmlI18n,
        }),
      });
      const copyEmpty = result.copy_empty === true;
      setRecipientCount(result.count);
      const skipped = result.skipped_locale_count ?? 0;
      setSkippedLocaleCount(skipped);
      if (result.no_audience) {
        setSegmentHint(
          "Выберите аудиторию («Вся база» / «Все установившие» / тариф) или укажите фрагмент email.",
        );
      } else if (copyEmpty) {
        setSegmentHint(
          `В сегменте ${result.segment_count ?? result.count}. Письмо пока пустое — это размер сегмента, не те, кому уйдёт. После текста письмо получат только те, у кого заполнен перевод на язык профиля.`,
        );
      } else if (skipped > 0) {
        setSegmentHint(
          `В сегменте ${result.segment_count ?? result.count + skipped}, из них ${skipped} без перевода на язык профиля — им письмо не уйдёт.`,
        );
      }
      return { count: result.count, copyEmpty };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось посчитать сегмент");
      return null;
    } finally {
      setCounting(false);
    }
  }

  async function saveMeta(): Promise<boolean> {
    if (readOnly) return false;
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
            audience_cap: audienceCap.trim() ? Number(audienceCap.trim()) : null,
          }),
        },
      );
      setCampaign(row);
      setName((row.name ?? "").trim() || name.trim());
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
    const saved = (campaign?.name ?? "").trim();
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
      await adminFetch(`/api/admin/email/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: next.subject,
          html_body: next.htmlBody,
          subject_i18n: next.subjectI18n,
          html_body_i18n: next.htmlI18n,
          blocks_i18n: next.blocksI18n,
        }),
      });
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

  async function sendCampaign(e: FormEvent) {
    e.preventDefault();
    if (!campaign || finished || sendingNow) return;
    setError(null);
    const preview = await refreshCount();
    if (preview === null) return;
    if (preview.copyEmpty) {
      setError(
        "Сначала напишите письмо — пустое письмо никому не уйдёт. Число выше — размер сегмента.",
      );
      return;
    }
    if (preview.count === 0) {
      setError(
        segmentHint ||
          "Получателей нет — проверьте сегмент и переводы на языки профилей.",
      );
      return;
    }
    const wave =
      progress?.next_wave_size ||
      campaign.next_wave_size ||
      500;
    const already = progress?.accepted ?? campaign.sent_count ?? 0;
    if (
      !confirm(
        `Отправить следующую волну до ${wave} писем самым свежим из сегмента?\nУже принято Resend: ${already}. Повторно им не уйдёт.`,
      )
    ) {
      return;
    }
    setSending(true);
    try {
      const { campaign: row } = await adminFetch<{ campaign: Campaign }>(
        `/api/admin/email/campaigns/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            segment_query: segmentToQuery(segment),
            audience_cap: audienceCap.trim() ? Number(audienceCap.trim()) : null,
            subject,
            html_body: htmlBody,
            subject_i18n: subjectI18n,
            html_body_i18n: htmlI18n,
            blocks_i18n: blocksI18n,
          }),
        },
      );
      setCampaign(row);
      const result = await adminFetch<{
        sent_count: number;
        queued_enqueued?: number;
        status?: string;
        timed_out?: boolean;
        campaign: Campaign;
      }>(`/api/admin/email/campaigns/${id}/send`, {
        method: "POST",
        body: JSON.stringify({ start_wave: true }),
      });
      setCampaign(result.campaign);
      setInfo(
        "Волна запущена. Можно закрыть вкладку — отправка продолжится на сервере. Остановить — кнопка ниже.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Отправка не удалась");
      await load();
    } finally {
      setSending(false);
    }
  }

  async function haltCampaign() {
    if (!campaign || finished) return;
    setError(null);
    try {
      await adminFetch(`/api/admin/email/campaigns/${id}/halt`, {
        method: "POST",
        body: "{}",
      });
      setInfo("Отправка остановлена. Кому Resend уже принял письмо — повторно не уйдёт.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось остановить");
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
    setError(null);
    try {
      const { campaign: copy } = await adminFetch<{ campaign: { id: string } }>(
        `/api/admin/email/campaigns/${id}/copy`,
        { method: "POST", body: "{}" },
      );
      if (!copy?.id) throw new Error("Сервер не вернул id копии");
      router.replace(`/admin/email/${copy.id}`);
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

  function selectAllContacts() {
    setSegment((p) => ({
      ...p,
      all_contacts: true,
      all_installed: false,
      include_demo: false,
      include_new_24h: false,
      not_in_harmonizer: false,
      email_only: false,
      membership_tiers: [],
    }));
    setRecipientCount(null);
  }

  function selectAllInstalled() {
    setSegment((p) => ({
      ...p,
      all_contacts: false,
      all_installed: true,
      include_demo: false,
      include_new_24h: false,
      not_in_harmonizer: false,
      email_only: false,
      membership_tiers: [],
    }));
    setRecipientCount(null);
  }

  function toggleDemo() {
    setSegment((p) => ({
      ...p,
      all_contacts: false,
      all_installed: false,
      include_demo: !p.include_demo,
    }));
    setRecipientCount(null);
  }

  function toggleNew24h() {
    setSegment((p) => ({
      ...p,
      all_contacts: false,
      all_installed: false,
      include_new_24h: !p.include_new_24h,
    }));
    setRecipientCount(null);
  }

  function toggleNotInHarmonizer() {
    setSegment((p) => ({
      ...p,
      all_contacts: false,
      all_installed: false,
      not_in_harmonizer: !p.not_in_harmonizer,
    }));
    setRecipientCount(null);
  }

  function toggleEmailOnly() {
    setSegment((p) => ({
      ...p,
      all_contacts: false,
      all_installed: false,
      email_only: !p.email_only,
    }));
    setRecipientCount(null);
  }

  function toggleTier(tier: "free" | "oracle" | "master") {
    setSegment((p) => {
      const has = p.membership_tiers.includes(tier);
      return {
        ...p,
        all_contacts: false,
        all_installed: false,
        membership_tiers: has
          ? p.membership_tiers.filter((t) => t !== tier)
          : [...p.membership_tiers, tier],
      };
    });
    setRecipientCount(null);
  }

  if (!campaign && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загрузка…
      </div>
    );
  }

  const statusLabel = STATUS_RU[campaign?.status ?? "draft"] ?? campaign?.status ?? "черновик";
  const statusLine =
    campaign?.status === "sent" && campaign.sent_at
      ? `${statusLabel} · ${formatAdminDateTime(campaign.sent_at)}`
      : campaign?.status === "paused" && campaign.next_wave_at
        ? `${statusLabel} · следующая волна ${formatAdminDateTime(campaign.next_wave_at)}`
        : statusLabel;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/email" className="text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Рассылка</h1>
            <p className="text-xs text-zinc-500">{statusLine}</p>
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

      {campaign && hasDeliveryActivity(campaign) ? (
        <EmailDeliveryStats counts={campaign} showUnsubscribed />
      ) : null}

      {campaign ? (
        <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="text-sm font-semibold text-zinc-800">Прогрев волнами</h2>
          <p className="text-xs text-zinc-500">
            Очередь: 500 → 500 (завтра 16:00 МСК) → 1000 → 1000 → 2000 → 2000 → далее по 3000
            каждые 24 часа. Сортировка — последняя активность в приложении или снимок Геткурса.
            Кому Resend уже принял письмо, повторно не отправим.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Принято Resend
              </div>
              <div className="text-lg font-bold text-zinc-900">
                {progress?.accepted ?? campaign.sent_count}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                В очереди
              </div>
              <div className="text-lg font-bold text-zinc-900">{progress?.queued ?? 0}</div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Следующая волна
              </div>
              <div className="text-lg font-bold text-zinc-900">
                {progress?.next_wave_size ?? campaign.next_wave_size ?? 500}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Осталось в лимите
              </div>
              <div className="text-lg font-bold text-zinc-900">
                {progress?.remaining_estimate ?? "—"}
              </div>
            </div>
          </div>
          {sendingNow ? (
            <p className="text-xs text-amber-800">
              Сейчас идёт отправка. Письмо лучше не править. Можно остановить — уже ушедшие
              адреса останутся отмеченными.
            </p>
          ) : null}
          {campaign.next_wave_at && campaign.status === "paused" ? (
            <p className="text-xs text-emerald-800">
              Следующая волна сама стартует {formatAdminDateTime(campaign.next_wave_at)} (16:00
              МСК). До этого можно править текст и нажать «Остановить», чтобы отменить автозапуск.
            </p>
          ) : null}
          <label className="block text-xs font-medium text-zinc-500">
            Потолок аудитории (пусто = вся база по активности)
            <input
              className={`${inputCls} mt-1 max-w-xs`}
              inputMode="numeric"
              placeholder="например 6000"
              value={audienceCap}
              disabled={readOnly}
              onChange={(e) => setAudienceCap(e.target.value.replace(/[^\d]/g, ""))}
            />
          </label>
        </section>
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

      <EmailMessageWorkspace
        readOnly={readOnly}
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
        sending={sending || sendingNow}
        showSendBlock={!finished}
        onBulkSend={!finished && !sendingNow ? sendCampaign : undefined}
        bulkSendLabel={`Отправить волну (${progress?.next_wave_size ?? campaign?.next_wave_size ?? 500})`}
        sendExtra={
          sendingNow ? (
            <button
              type="button"
              onClick={() => void haltCampaign()}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
            >
              <Square size={14} />
              Остановить
            </button>
          ) : campaign?.status === "paused" ? (
            <button
              type="button"
              onClick={() => void haltCampaign()}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Снять автозапуск
            </button>
          ) : null
        }
        onBeforeOpenEditor={readOnly ? undefined : confirmNameBeforeEdit}
        afterPreview={
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-800">Сегмент</h2>
              <div className="flex flex-col items-end gap-0.5 text-sm text-emerald-700">
                <div className="flex items-center gap-2">
                  <span>
                    Получателей:{" "}
                    {recipientCount === null ? "— нажмите обновить" : recipientCount}
                  </span>
                  <button
                    type="button"
                    title="Обновить число получателей (с учётом языков письма)"
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
                {segmentHint ? (
                  <p className="max-w-md text-right text-[11px] font-normal text-zinc-500">
                    {segmentHint}
                  </p>
                ) : null}
                {recipientCount !== null && skippedLocaleCount === 0 && !segmentHint ? (
                  <p className="text-[11px] font-normal text-zinc-400">
                    Учтены языки письма и locale в профиле
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  {
                    key: "base",
                    label: "Вся база",
                    on: segment.all_contacts,
                  },
                  {
                    key: "demo",
                    label: "Демо",
                    on:
                      segment.include_demo &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "new24h",
                    label: "Новые 24ч",
                    on:
                      segment.include_new_24h &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "not_in_harmonizer",
                    label: "Не в гармонизаторе",
                    on:
                      segment.not_in_harmonizer &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "email_only",
                    label: "Только рассылки",
                    on:
                      segment.email_only &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "free",
                    label: "Навигатор",
                    on:
                      segment.membership_tiers.includes("free") &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "oracle",
                    label: "Наставник",
                    on:
                      segment.membership_tiers.includes("oracle") &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "master",
                    label: "Мастер",
                    on:
                      segment.membership_tiers.includes("master") &&
                      !segment.all_installed &&
                      !segment.all_contacts,
                  },
                  {
                    key: "all",
                    label: "Все установившие",
                    on: segment.all_installed,
                  },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    if (chip.key === "base") selectAllContacts();
                    else if (chip.key === "all") selectAllInstalled();
                    else if (chip.key === "demo") toggleDemo();
                    else if (chip.key === "new24h") toggleNew24h();
                    else if (chip.key === "not_in_harmonizer") toggleNotInHarmonizer();
                    else if (chip.key === "email_only") toggleEmailOnly();
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
            <p className="text-[11px] text-zinc-400">
              «Вся база» — все контакты (в т.ч. импорт из Геткурса). «Все установившие» —
              аккаунт с подтверждённым OTP. «Демо» — активный trial. «Новые 24ч» —
              регистрация в системе за сутки. «Не в гармонизаторе» — начал OTP/приложение,
              онбординг не завершён. «Только рассылки» — импорт из Геткурса без входа в
              приложение. «Навигатор» — free без активного демо. Активность ниже — по
              последнему входу в приложение (Гармонизатор). Даты «в системе» —{" "}
              <span className="whitespace-nowrap">users.created_at</span> (аккаунт), не
              онбординг; без даты в сегмент входят и контакты без аккаунта.
            </p>

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
                Не заходил в приложение ≥ N дней
                <input
                  className={`${inputCls} mt-1`}
                  value={segment.last_seen_older_than_days}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({
                      ...p,
                      last_seen_older_than_days: e.target.value,
                    }));
                    setRecipientCount(null);
                  }}
                  placeholder="например 30"
                  inputMode="numeric"
                />
              </label>
              <label className="text-xs text-zinc-500">
                Язык профиля
                <select
                  className={`${inputCls} mt-1`}
                  value={segment.locale}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({ ...p, locale: e.target.value }));
                    setRecipientCount(null);
                  }}
                >
                  <option value="">Любой язык</option>
                  {SEGMENT_LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {code.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-500">
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
              <label className="text-xs text-zinc-500">
                Регистрация в системе ≥
                <input
                  type="date"
                  className={`${inputCls} mt-1`}
                  value={segment.account_created_on_or_after}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({
                      ...p,
                      account_created_on_or_after: e.target.value,
                    }));
                    setRecipientCount(null);
                  }}
                />
              </label>
              <label className="text-xs text-zinc-500">
                Регистрация в системе ≤
                <input
                  type="date"
                  className={`${inputCls} mt-1`}
                  value={segment.account_created_on_or_before}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({
                      ...p,
                      account_created_on_or_before: e.target.value,
                    }));
                    setRecipientCount(null);
                  }}
                />
              </label>
              <label className="text-xs text-zinc-500">
                Регистрация в Гармонизаторе ≥
                <input
                  type="date"
                  className={`${inputCls} mt-1`}
                  value={segment.onboarded_on_or_after}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({
                      ...p,
                      onboarded_on_or_after: e.target.value,
                    }));
                    setRecipientCount(null);
                  }}
                />
              </label>
              <label className="text-xs text-zinc-500">
                Регистрация в Гармонизаторе ≤
                <input
                  type="date"
                  className={`${inputCls} mt-1`}
                  value={segment.onboarded_on_or_before}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSegment((p) => ({
                      ...p,
                      onboarded_on_or_before: e.target.value,
                    }));
                    setRecipientCount(null);
                  }}
                />
              </label>
            </div>
          </section>
        }
      />
    </div>
  );
}
