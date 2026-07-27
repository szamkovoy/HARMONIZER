"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

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

type NotificationDetail = {
  id: string;
  title: string;
  body: string;
  title_i18n: Record<string, string> | null;
  body_i18n: Record<string, string> | null;
  link_url: string | null;
  segment_label: string;
  recipient_count: number;
  push_sent_count: number;
  push_error_count: number;
  sent_at: string | null;
  created_at: string;
};

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

function hasLocaleCopy(
  item: NotificationDetail,
  locale: ContentLocale,
): boolean {
  if (locale === "ru") {
    return Boolean(item.title.trim() || item.body.trim());
  }
  const title = (item.title_i18n?.[locale] ?? "").trim();
  const body = (item.body_i18n?.[locale] ?? "").trim();
  return Boolean(title || body);
}

function pickLocaleText(
  item: NotificationDetail,
  locale: ContentLocale,
): { title: string; body: string } {
  if (locale === "ru") {
    return { title: item.title, body: item.body };
  }
  const title = (item.title_i18n?.[locale] ?? "").trim();
  const body = (item.body_i18n?.[locale] ?? "").trim();
  if (title || body) return { title, body };
  // Fallback to RU if this locale was never filled
  return { title: item.title, body: item.body };
}

export default function AdminNotificationDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<NotificationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentLocale>("ru");

  useEffect(() => {
    void (async () => {
      try {
        const data = await adminFetch<{
          notification: NotificationDetail;
        }>(`/api/admin/notifications/${params.id}`);
        setItem(data.notification);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось загрузить");
      }
    })();
  }, [params.id]);

  const locales = useMemo(
    () => ["ru", ...TARGET_LOCALES] as ContentLocale[],
    [],
  );

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

  const copy = pickLocaleText(item, activeTab);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start gap-3">
        <Link
          href="/admin/notifications"
          className="mt-1 text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Уведомления</h1>
          <p className="mt-1 text-xs text-zinc-500">
            {item.segment_label}
            {" · "}
            {formatAdminDateTime(item.sent_at || item.created_at)}
          </p>
        </div>
      </div>

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

      <div className="flex flex-wrap items-center gap-1">
        {locales.map((locale) => (
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
            {hasLocaleCopy(item, locale) ? (
              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-300" />
            ) : null}
          </button>
        ))}
      </div>

      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-base font-semibold text-zinc-900">
          {copy.title.trim() || "Без заголовка"}
        </h2>
        {copy.body.trim() ? (
          <p className="whitespace-pre-wrap text-sm font-normal text-zinc-700">{copy.body}</p>
        ) : (
          <p className="text-sm text-zinc-400">Без текста</p>
        )}
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
    </div>
  );
}
