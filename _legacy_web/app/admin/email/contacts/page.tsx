"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

const STATUS_LABELS: Record<string, string> = {
  active: "Получает письма",
  unsubscribed: "Отписался",
  suppressed: "Не доставляется",
  complained: "Пометил как спам",
};

type ContactRow = {
  id: string;
  email: string;
  marketing_status: string;
  user_id: string | null;
  display_name: string | null;
  locale: string | null;
  updated_at: string | null;
};

function ContactsList() {
  const searchParams = useSearchParams();
  const status = (searchParams.get("status") ?? "").trim();
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status || !STATUS_LABELS[status]) {
      setError("Не указан статус подписки");
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContacts(null);
    setError(null);
    void (async () => {
      try {
        const data = await adminFetch<{ contacts: ContactRow[] }>(
          `/api/admin/email/contacts?status=${encodeURIComponent(status)}`,
        );
        if (!cancelled) setContacts(data.contacts);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить");
          setContacts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const title = STATUS_LABELS[status] ?? status;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-start gap-3">
        <Link
          href="/admin/email/deliverability"
          className="mt-1 rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="Назад"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">{title}</h1>
          <p className="text-sm text-zinc-500">
            Контакты со статусом маркетинговой подписки
            {contacts ? ` · ${contacts.length}` : ""}
          </p>
        </div>
      </div>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {contacts === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      ) : null}
      {contacts?.length === 0 && !error ? (
        <p className="text-sm text-zinc-500">Никого нет.</p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {contacts?.map((c) => {
          const href = c.user_id ? `/admin/users/${c.user_id}` : null;
          const inner = (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {c.display_name?.trim() || c.email}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                  {c.display_name ? <span className="truncate">{c.email}</span> : null}
                  {c.locale ? <span>{c.locale}</span> : null}
                  {c.updated_at ? (
                    <span>обновлён {formatAdminDateTime(c.updated_at)}</span>
                  ) : null}
                  {!c.user_id ? <span>без аккаунта в приложении</span> : null}
                </div>
              </div>
              {href ? (
                <ChevronRight size={16} className="shrink-0 text-zinc-600" />
              ) : null}
            </>
          );
          if (href) {
            return (
              <Link
                key={c.id}
                href={href}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition-colors hover:border-zinc-300"
              >
                {inner}
              </Link>
            );
          }
          return (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3"
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EmailContactsPage() {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      }
    >
      <ContactsList />
    </Suspense>
  );
}
