"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";

import { PRODUCT_TIERS, TIER_LABELS_RU } from "@/modules/access/core/tiers";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

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

const LOCALE_FULL_NAMES: Record<ContentLocale, string> = {
  ru: "Русский",
  en: "English",
  de: "Deutsch",
  fr: "Français",
  it: "Italiano",
  es: "Español",
  pt: "Português",
  nl: "Nederlands",
};

type LocaleTab = { title: string; body: string };

function emptyTab(): LocaleTab {
  return { title: "", body: "" };
}

function emptyTabs(): Record<TargetLocale, LocaleTab> {
  return {
    en: emptyTab(),
    de: emptyTab(),
    fr: emptyTab(),
    it: emptyTab(),
    es: emptyTab(),
    pt: emptyTab(),
    nl: emptyTab(),
  };
}

type NotificationDetail = {
  id: string;
  title: string;
  body: string;
  title_i18n: Record<string, string> | null;
  body_i18n: Record<string, string> | null;
  link_url: string | null;
  segment: string;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  sent_at: string | null;
  created_at: string;
};

type WebinarOption = { id: string; title: string; starts_at: string };

const TIER_OPTIONS = PRODUCT_TIERS.map((tier) => ({
  value: `tier:${tier}`,
  label: `Тариф «${TIER_LABELS_RU[tier]}»`,
}));

const inputCls =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500";

function StatCard({
  value,
  label,
  hint,
}: {
  value: number;
  label: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
      <div className="text-lg font-semibold text-zinc-900">{value}</div>
      <div className="text-xs font-medium text-zinc-700">{label}</div>
      <p className="mt-1 text-[11px] leading-snug text-zinc-400">{hint}</p>
    </div>
  );
}

export default function AdminNotificationDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<NotificationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentLocale>("ru");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [localeTabs, setLocaleTabs] = useState(emptyTabs);
  const [linkUrl, setLinkUrl] = useState("");
  const [segment, setSegment] = useState("all");
  const [webinars, setWebinars] = useState<WebinarOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await adminFetch<{ notification: NotificationDetail }>(
          `/api/admin/notifications/${params.id}`,
        );
        const n = data.notification;
        setItem(n);
        setTitle(n.title ?? "");
        setBody(n.body ?? "");
        setLinkUrl(n.link_url ?? "");
        setSegment(n.segment || "all");
        const tabs = emptyTabs();
        for (const locale of TARGET_LOCALES) {
          tabs[locale] = {
            title: n.title_i18n?.[locale] ?? "",
            body: n.body_i18n?.[locale] ?? "",
          };
        }
        setLocaleTabs(tabs);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить");
      }
    })();
    adminFetch<{ webinars: WebinarOption[] }>("/api/admin/webinars")
      .then(({ webinars: list }) => setWebinars(list))
      .catch(() => setWebinars([]));
  }, [params.id]);

  const locales = useMemo(
    () => ["ru", ...TARGET_LOCALES] as ContentLocale[],
    [],
  );

  const isDraft = Boolean(item && !item.sent_at);

  function updateLocaleTab(locale: TargetLocale, patch: Partial<LocaleTab>) {
    setInfo(null);
    setLocaleTabs((prev) => ({ ...prev, [locale]: { ...prev[locale], ...patch } }));
  }

  function pickTranslateSource(): {
    locale: ContentLocale;
    title: string;
    body: string;
  } | null {
    if (title.trim()) return { locale: "ru", title: title.trim(), body };
    for (const locale of TARGET_LOCALES) {
      if (localeTabs[locale].title.trim()) {
        return {
          locale,
          title: localeTabs[locale].title.trim(),
          body: localeTabs[locale].body,
        };
      }
    }
    return null;
  }

  async function runTranslate() {
    const source = pickTranslateSource();
    if (!source) {
      setTranslateError("Сначала заполните заголовок хотя бы на одном языке");
      return;
    }
    const fillLocales = (["ru", ...TARGET_LOCALES] as ContentLocale[]).filter((locale) => {
      if (locale === source.locale) return false;
      if (locale === "ru") return !title.trim();
      return !localeTabs[locale].title.trim();
    });
    if (fillLocales.length === 0) {
      setTranslateError("Все языки уже заполнены");
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    try {
      const { translations } = await adminFetch<{
        translations: Record<string, { title: string; body: string }>;
      }>("/api/admin/translate", {
        method: "POST",
        body: JSON.stringify({
          type: "post",
          source_locale: source.locale,
          source_title: source.title,
          source_body: source.body,
          fill_locales: fillLocales,
        }),
      });
      if (translations.ru) {
        if (!title.trim() && translations.ru.title.trim()) setTitle(translations.ru.title);
        if (!body.trim() && translations.ru.body) setBody(translations.ru.body);
      }
      setLocaleTabs((prev) => {
        const next = { ...prev };
        for (const locale of TARGET_LOCALES) {
          const t = translations[locale];
          if (!t || prev[locale].title.trim()) continue;
          next[locale] = { title: t.title, body: t.body };
        }
        return next;
      });
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Не удалось перевести");
    } finally {
      setTranslating(false);
    }
  }

  function buildI18n(): {
    title_i18n: Record<string, string>;
    body_i18n: Record<string, string>;
  } {
    const title_i18n: Record<string, string> = {};
    const body_i18n: Record<string, string> = {};
    for (const locale of TARGET_LOCALES) {
      if (localeTabs[locale].title.trim()) title_i18n[locale] = localeTabs[locale].title.trim();
      if (localeTabs[locale].body.trim()) body_i18n[locale] = localeTabs[locale].body;
    }
    return { title_i18n, body_i18n };
  }

  async function saveDraft() {
    if (!item || !isDraft) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const { title_i18n, body_i18n } = buildI18n();
      const { notification } = await adminFetch<{ notification: NotificationDetail }>(
        `/api/admin/notifications/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title,
            body,
            title_i18n,
            body_i18n,
            link_url: linkUrl || null,
            segment,
          }),
        },
      );
      setItem(notification);
      setInfo("Сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!item || !isDraft) return;
    if (!window.confirm("Отправить уведомление выбранному сегменту?")) return;
    setSending(true);
    setError(null);
    setInfo(null);
    try {
      const { title_i18n, body_i18n } = buildI18n();
      await adminFetch(`/api/admin/notifications/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          body,
          title_i18n,
          body_i18n,
          link_url: linkUrl || null,
          segment,
        }),
      });
      const { notification, skipped_no_locale_copy } = await adminFetch<{
        notification: NotificationDetail;
        skipped_no_locale_copy?: number;
      }>(`/api/admin/notifications/${item.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "send" }),
      });
      setItem(notification);
      const skipped =
        typeof skipped_no_locale_copy === "number" && skipped_no_locale_copy > 0
          ? `, без перевода языка профиля пропущено ${skipped_no_locale_copy}`
          : "";
      setInfo(
        `Отправлено: получателей ${notification.recipient_count}, push ушло ${notification.push_sent_count}, ошибок ${notification.push_error_count}${skipped}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    if (
      !window.confirm(
        "Удалить это уведомление? Оно исчезнет у всех получателей в «Мои уведомления».",
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await adminFetch(`/api/admin/notifications/${item.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      window.location.href = "/admin/notifications";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
      setDeleting(false);
    }
  }

  if (error && !item) {
    return (
      <div className="space-y-3">
        <Link href="/admin/notifications" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Уведомления
        </Link>
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Загрузка…
      </div>
    );
  }

  const ruHasContent = Boolean(title.trim());
  const activeHasTranslation =
    activeTab === "ru"
      ? Boolean(title.trim() || body.trim())
      : Boolean(
          localeTabs[activeTab].title.trim() || localeTabs[activeTab].body.trim(),
        );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href="/admin/notifications"
          className="mt-1 text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-zinc-900">
            {isDraft ? "Черновик уведомления" : "Уведомление"}
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            {item.segment_label}
            {" · "}
            {formatAdminDateTime(item.sent_at || item.created_at)}
            {isDraft ? " · не отправлено" : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={deleting}
          onClick={() => void handleDelete()}
          className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-600 hover:text-rose-600"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Удалить
        </button>
      </div>

      {!isDraft ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatCard
            value={item.recipient_count}
            label="Получателей"
            hint="Сколько человек вошло в рассылку — увидят уведомление в приложении."
          />
          <StatCard
            value={item.push_sent_count}
            label="Получили push"
            hint="Сколько человек получили push на телефон. Кто отключил уведомления в системе — сюда не входят."
          />
          <StatCard
            value={item.push_error_count}
            label="Ошибки push"
            hint="Сколько отправок на телефон не удалось. Если число больше нуля — можно разобрать и починить."
          />
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {info ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700">
          <CheckCircle2 size={15} /> {info}
        </p>
      ) : null}

      {isDraft ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="mb-4 text-sm text-zinc-500">
            Текст строго на языке профиля (`users.locale`): без перевода на вкладке
            языка получатель пропускается. Зелёная точка = есть заголовок.
          </p>

          <div className="mb-4">
            <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl bg-white p-1">
              {locales.map((locale) => {
                const hasContent =
                  locale === "ru"
                    ? ruHasContent
                    : Boolean(localeTabs[locale].title.trim());
                return (
                  <button
                    key={locale}
                    type="button"
                    onClick={() => setActiveTab(locale)}
                    className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      activeTab === locale
                        ? "bg-emerald-500 text-white"
                        : "text-zinc-400 hover:text-zinc-800"
                    }`}
                    title={LOCALE_FULL_NAMES[locale]}
                  >
                    {LOCALE_LABELS[locale]}
                    {hasContent ? (
                      <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    ) : null}
                  </button>
                );
              })}
              <div className="ml-auto flex items-center">
                <button
                  type="button"
                  onClick={() => void runTranslate()}
                  disabled={translating || sending || saving}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60"
                >
                  {translating ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  Перевести
                </button>
              </div>
            </div>
            {translateError ? (
              <p className="mt-1 text-xs text-red-400">{translateError}</p>
            ) : null}
          </div>

          {activeTab === "ru" ? (
            <>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">Заголовок (Русский)</span>
                <input
                  value={title}
                  onChange={(e) => {
                    setInfo(null);
                    setTitle(e.target.value);
                  }}
                  className={inputCls}
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1 block text-xs text-zinc-400">Текст (Русский)</span>
                <textarea
                  value={body}
                  onChange={(e) => {
                    setInfo(null);
                    setBody(e.target.value);
                  }}
                  rows={3}
                  className={`${inputCls} resize-y`}
                />
              </label>
            </>
          ) : (
            <>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">
                  Заголовок ({LOCALE_FULL_NAMES[activeTab]})
                </span>
                <input
                  value={localeTabs[activeTab].title}
                  onChange={(e) => updateLocaleTab(activeTab, { title: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1 block text-xs text-zinc-400">
                  Текст ({LOCALE_FULL_NAMES[activeTab]})
                </span>
                <textarea
                  value={localeTabs[activeTab].body}
                  onChange={(e) => updateLocaleTab(activeTab, { body: e.target.value })}
                  rows={3}
                  className={`${inputCls} resize-y`}
                />
              </label>
            </>
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Ссылка (необязательно)</span>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => {
                  setInfo(null);
                  setLinkUrl(e.target.value);
                }}
                placeholder="https://…"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-400">Сегмент</span>
              <select
                value={segment}
                onChange={(e) => {
                  setInfo(null);
                  setSegment(e.target.value);
                }}
                className={inputCls}
              >
                <option value="all">Все пользователи</option>
                {TIER_OPTIONS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label}
                  </option>
                ))}
                {webinars.map((webinar) => (
                  <option key={webinar.id} value={`webinar:${webinar.id}`}>
                    Вебинар «{webinar.title}» ({formatAdminDateTime(webinar.starts_at)})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeHasTranslation ? (
            <button
              type="button"
              onClick={() => {
                if (activeTab === "ru") {
                  if (!window.confirm("Очистить русский заголовок и текст?")) return;
                  setTitle("");
                  setBody("");
                } else {
                  if (
                    !window.confirm(
                      `Удалить перевод для ${LOCALE_FULL_NAMES[activeTab]}?`,
                    )
                  ) {
                    return;
                  }
                  updateLocaleTab(activeTab, emptyTab());
                }
              }}
              className="mb-4 text-xs text-zinc-500 underline-offset-2 hover:text-red-300 hover:underline"
            >
              Удалить перевод ({LOCALE_LABELS[activeTab]})
            </button>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || sending}
              onClick={() => void saveDraft()}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
            <button
              type="button"
              disabled={sending || saving}
              onClick={() => void handleSend()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} strokeWidth={2} />
              )}
              {sending ? "Отправляю…" : "Отправить"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {locales.map((locale) => {
              const has =
                locale === "ru"
                  ? Boolean(item.title.trim() || item.body.trim())
                  : Boolean(
                      (item.title_i18n?.[locale] ?? "").trim() ||
                        (item.body_i18n?.[locale] ?? "").trim(),
                    );
              return (
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
                  {has ? (
                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-base font-semibold text-zinc-900">
              {activeTab === "ru"
                ? item.title.trim() || "Без заголовка"
                : (item.title_i18n?.[activeTab] ?? "").trim() ||
                  item.title.trim() ||
                  "Без заголовка"}
            </h2>
            {(() => {
              const text =
                activeTab === "ru"
                  ? item.body
                  : (item.body_i18n?.[activeTab] ?? "").trim() || item.body;
              return text.trim() ? (
                <p className="whitespace-pre-wrap text-sm font-normal text-zinc-700">
                  {text}
                </p>
              ) : (
                <p className="text-sm text-zinc-400">Без текста</p>
              );
            })()}
            {item.link_url ? (
              <a
                href={item.link_url}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-emerald-700 underline"
              >
                {item.link_url}
              </a>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
