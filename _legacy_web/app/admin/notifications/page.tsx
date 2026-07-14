"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, RefreshCw, Send, Trash2 } from "lucide-react";

import { PRODUCT_TIERS, TIER_LABELS_RU } from "@/modules/access/core/tiers";

import { adminFetch } from "../_lib/adminApi";
import { formatAdminDateTime } from "../_lib/adminDates";

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

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  title_i18n?: Record<string, string> | null;
  body_i18n?: Record<string, string> | null;
  link_url: string | null;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  sent_at?: string | null;
  created_at: string;
};

type WebinarOption = { id: string; title: string; starts_at: string };

const TIER_OPTIONS = PRODUCT_TIERS.map((tier) => ({
  value: `tier:${tier}`,
  label: `Тариф «${TIER_LABELS_RU[tier]}»`,
}));

const inputCls =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50";

export default function AdminNotificationsPage() {
  const [history, setHistory] = useState<NotificationRow[] | null>(null);
  const [webinars, setWebinars] = useState<WebinarOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ContentLocale>("ru");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [localeTabs, setLocaleTabs] = useState(emptyTabs);
  const [linkUrl, setLinkUrl] = useState("");
  const [segment, setSegment] = useState("all");
  const [sending, setSending] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = async (): Promise<NotificationRow[]> => {
    try {
      const { notifications } = await adminFetch<{ notifications: NotificationRow[] }>(
        "/api/admin/notifications",
      );
      setHistory(notifications);
      return notifications;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить историю");
      return [];
    }
  };

  useEffect(() => {
    void loadHistory();
    adminFetch<{ webinars: WebinarOption[] }>("/api/admin/webinars")
      .then(({ webinars }) => setWebinars(webinars))
      .catch(() => setWebinars([]));
  }, []);

  function updateLocaleTab(locale: TargetLocale, patch: Partial<LocaleTab>) {
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

  function clearActiveTranslation() {
    if (activeTab === "ru") {
      if (!window.confirm("Очистить русский заголовок и текст?")) return;
      setTitle("");
      setBody("");
      return;
    }
    if (
      !window.confirm(
        `Удалить перевод для ${LOCALE_FULL_NAMES[activeTab]}? Заголовок и текст этой вкладки будут очищены.`,
      )
    ) {
      return;
    }
    updateLocaleTab(activeTab, emptyTab());
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm("Отправить уведомление выбранному сегменту?")) return;
    setSending(true);
    setError(null);
    setSentInfo(null);
    try {
      const title_i18n: Record<string, string> = {};
      const body_i18n: Record<string, string> = {};
      for (const locale of TARGET_LOCALES) {
        if (localeTabs[locale].title.trim()) title_i18n[locale] = localeTabs[locale].title.trim();
        if (localeTabs[locale].body.trim()) body_i18n[locale] = localeTabs[locale].body;
      }
      const { notification } = await adminFetch<{ notification: NotificationRow }>("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          title,
          body,
          title_i18n,
          body_i18n,
          link_url: linkUrl || null,
          segment,
        }),
      });
      setSentInfo(
        `Отправлено: получателей ${notification.recipient_count}, push ушло ${notification.push_sent_count}, ошибок ${notification.push_error_count}.`,
      );
      setTitle("");
      setBody("");
      setLocaleTabs(emptyTabs());
      setLinkUrl("");
      setActiveTab("ru");
      await loadHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось отправить";
      // Undici/Vercel may abort the browser response after Expo already accepted the push.
      if (/terminated|aborted|failed to fetch/i.test(message)) {
        const list = await loadHistory();
        const latest = list[0];
        if (latest && latest.title === title.trim() && latest.sent_at) {
          setSentInfo(
            `Рассылка сохранена (получателей ${latest.recipient_count}, push ${latest.push_sent_count}). Ответ сети оборвался после отправки — это безопасно, можно не дублировать.`,
          );
          setTitle("");
          setBody("");
          setLocaleTabs(emptyTabs());
          setLinkUrl("");
          setActiveTab("ru");
          setError(null);
          return;
        }
      }
      setError(message);
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Удалить эту рассылку? Она исчезнет у всех получателей в «Мои уведомления».")) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      // POST с телом — надёжнее bodyless DELETE (прокси / Content-Type / refresh race).
      await adminFetch(`/api/admin/notifications/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "delete" }),
      });
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  }

  const ruHasContent = Boolean(title.trim() || body.trim());
  const activeHasTranslation =
    activeTab === "ru"
      ? ruHasContent
      : Boolean(localeTabs[activeTab].title.trim() || localeTabs[activeTab].body.trim());

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-zinc-100">Уведомления</h1>
      <p className="mb-5 text-sm text-zinc-500">
        Push + гарантированная копия в «Мои уведомления». Текст каждому — по языку профиля
        (`users.locale`, одна точка: resolveNotificationCopy; нет перевода → EN → RU).
      </p>

      <form onSubmit={handleSend} className="mb-6 rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-4">
        <div className="mb-4">
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-xl bg-black/30 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("ru")}
              className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === "ru" ? "bg-emerald-500 text-emerald-950" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              RU
              {ruHasContent ? (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ) : null}
            </button>
            {TARGET_LOCALES.map((locale) => {
              const hasContent = Boolean(localeTabs[locale].title.trim() || localeTabs[locale].body.trim());
              return (
                <button
                  key={locale}
                  type="button"
                  onClick={() => setActiveTab(locale)}
                  className={`relative shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === locale ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
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
                disabled={translating || sending}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:opacity-60"
                title="Перевести пустые языки (RU → EN → …)"
              >
                {translating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Перевести
              </button>
            </div>
          </div>
          {translateError ? <p className="mt-1 text-xs text-red-400">{translateError}</p> : null}
        </div>

        {activeTab === "ru" ? (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-zinc-400">Заголовок (Русский)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs text-zinc-400">Текст (Русский)</span>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={`${inputCls} resize-y`} />
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
              <span className="mb-1 block text-xs text-zinc-400">Текст ({LOCALE_FULL_NAMES[activeTab]})</span>
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
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Сегмент</span>
            <select value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
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

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {activeHasTranslation ? (
            <button
              type="button"
              onClick={clearActiveTranslation}
              className="text-xs text-zinc-500 underline-offset-2 transition-colors hover:text-red-300 hover:underline"
            >
              Удалить перевод ({LOCALE_LABELS[activeTab]})
            </button>
          ) : null}
        </div>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
        {sentInfo ? (
          <p className="mb-3 flex items-center gap-1.5 text-sm text-emerald-300">
            <CheckCircle2 size={15} /> {sentInfo}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending}
          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
        >
          {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={2} />}
          {sending ? "Отправляю…" : "Отправить"}
        </button>
      </form>

      <h2 className="mb-3 text-base font-semibold text-zinc-100">История</h2>
      {history === null ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : history.length === 0 ? (
        <p className="text-sm text-zinc-500">Рассылок ещё не было.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-3">
              <p className="font-semibold text-zinc-100">{item.title}</p>
              {item.body ? <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-400">{item.body}</p> : null}
              {item.link_url ? (
                <a href={item.link_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                  {item.link_url}
                </a>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="rounded-full bg-white/5 px-2 py-0.5">{item.segment_label}</span>
                <span>{formatAdminDateTime(item.created_at)}</span>
                <span>
                  получателей {item.recipient_count} · push {item.push_sent_count}
                  {item.push_error_count > 0 ? ` · ошибок ${item.push_error_count}` : ""}
                </span>
                <button
                  type="button"
                  disabled={deletingId === item.id}
                  onClick={() => void handleDelete(item.id)}
                  className="ml-auto flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-red-300 disabled:opacity-50"
                >
                  {deletingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
