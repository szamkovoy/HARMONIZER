"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";

import { isEmailOnlyUser } from "../../_lib/accessNow";
import { adminFetch } from "../../_lib/adminApi";
import { countryNameRu } from "../../_lib/countryNamesRu";
import {
  formatAccessPeriodHeader,
  formatAdminDate,
  formatAdminDateTime,
} from "../../_lib/adminDates";
import { PaymentHistorySection } from "../../payments/_components/PaymentHistorySection";
import {
  AccessEditModal,
  accessEditInitialFromUser,
} from "../_components/AccessEditModal";
import { AccessNowBadge, AutoRenewCancelledNote } from "../_components/TierBadge";
import type { AdminPaymentRow } from "../_types/payments";

type AdminUserCard = {
  id: string;
  email: string;
  display_name: string | null;
  last_name?: string | null;
  phone?: string | null;
  admin_note?: string | null;
  crm_imported_at?: string | null;
  getcourse_last_activity_at?: string | null;
  membership_tier: string;
  membership_expires_at: string | null;
  membership_started_at?: string | null;
  trial_expires_at?: string | null;
  locale: string | null;
  created_at: string | null;
  onboarded_at: string | null;
  last_activity_at: string | null;
  last_seen_at: string | null;
  country_code: string | null;
  city: string | null;
  lat?: number | null;
  lon?: number | null;
  skip_email_automations?: boolean;
  auto_renew_cancelled?: boolean;
};

type CrmProductChip = { slug: string; title: string; sort_order: number };

type ContactInfo = {
  id: string;
  email: string;
  marketing_status: string;
} | null;

type SubscriptionInfo = {
  contract_id: string;
  tier: string;
  currency: string;
  amount: number | null;
  status: string;
  current_period_end: string | null;
  cancelled_at?: string | null;
} | null;

type EmailHist = {
  kind: string;
  subject: string;
  chain_name?: string | null;
  letter_name?: string | null;
  status: string;
  created_at: string;
  campaign_id: string | null;
  automation_id: string | null;
  step_id?: string | null;
};

type ActiveEnrollment = {
  id: string;
  automation_id: string;
  automation_name: string;
  current_position: number;
  steps_total: number;
  next_step_at: string | null;
};

type NotifHist = {
  id: string;
  notification_id: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

const EMAIL_STATUS_RU: Record<string, string> = {
  queued: "в очереди",
  sent: "отправлено",
  delivered: "доставлено",
  opened: "открыто",
  clicked: "клик",
  bounced: "не доставлено",
  complained: "жалоба",
  failed: "ошибка",
  skipped: "пропущено",
};

function emailStatusLabel(status: string): string {
  return EMAIL_STATUS_RU[status] ?? status;
}

function emailStatusClass(status: string): string {
  switch (status) {
    case "clicked":
    case "opened":
    case "delivered":
      return "bg-emerald-50 text-emerald-700";
    case "sent":
    case "queued":
      return "bg-zinc-100 text-zinc-600";
    case "skipped":
      return "bg-amber-50 text-amber-800";
    case "bounced":
    case "complained":
    case "failed":
      return "bg-rose-50 text-rose-700";
    default:
      return "bg-zinc-100 text-zinc-600";
  }
}

type CampaignOpt = { id: string; name: string; subject: string; status: string };
type AutomationOpt = { id: string; name: string; is_active: boolean };

const MARKETING_STATUS_RU: Record<string, string> = {
  active: "Получает письма",
  unsubscribed: "Отписался",
  suppressed: "Не доставляется",
  complained: "Пометил как спам",
};

function formatLocation(user: AdminUserCard): string {
  const country = user.country_code ? countryNameRu(user.country_code) : null;
  const city = user.city?.trim() || null;
  if (country && city) return `${country}, ${city}`;
  if (country) return country;
  if (city) return city;
  return "—";
}

/** Plain Maps URL — no Google Maps API key / billing on profile load. */
function mapsUrl(user: AdminUserCard): string | null {
  const lat = typeof user.lat === "number" ? user.lat : Number(user.lat);
  const lon = typeof user.lon === "number" ? user.lon : Number(user.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  }
  const label = formatLocation(user);
  if (!label || label === "—") return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency || "RUB",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export default function AdminUserCardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<AdminUserCard | null>(null);
  const [contact, setContact] = useState<ContactInfo>(null);
  const [subscription, setSubscription] = useState<SubscriptionInfo>(null);
  const [crmProducts, setCrmProducts] = useState<CrmProductChip[]>([]);
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [emailHistory, setEmailHistory] = useState<EmailHist[]>([]);
  const [emailHistoryTotal, setEmailHistoryTotal] = useState(0);
  const [activeEnrollments, setActiveEnrollments] = useState<ActiveEnrollment[]>([]);
  const [notifications, setNotifications] = useState<NotifHist[]>([]);
  const [notificationsTotal, setNotificationsTotal] = useState(0);
  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [automations, setAutomations] = useState<AutomationOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  const [campaignId, setCampaignId] = useState("");
  const [automationId, setAutomationId] = useState("");
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [accessEditOpen, setAccessEditOpen] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState({ display_name: "", last_name: "" });
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await adminFetch<{
        user: AdminUserCard;
        payments: AdminPaymentRow[];
        contact?: ContactInfo;
        subscription?: SubscriptionInfo;
        crm_products?: CrmProductChip[];
        email_history?: EmailHist[];
        email_history_total?: number;
        active_enrollments?: ActiveEnrollment[];
        notifications?: NotifHist[];
        notifications_total?: number;
      }>(`/api/admin/users/${params.id}`);
      setUser(data.user);
      setContact(data.contact ?? null);
      setSubscription(data.subscription ?? null);
      setCrmProducts(data.crm_products ?? []);
      setPayments(data.payments);
      setEmailHistory(data.email_history ?? []);
      setEmailHistoryTotal(data.email_history_total ?? data.email_history?.length ?? 0);
      setActiveEnrollments(data.active_enrollments ?? []);
      setNotifications(data.notifications ?? []);
      setNotificationsTotal(
        data.notifications_total ?? data.notifications?.length ?? 0,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить пользователя");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [c, a] = await Promise.all([
          adminFetch<{ campaigns: CampaignOpt[] }>(
            "/api/admin/email/campaigns?limit=10",
          ),
          adminFetch<{ automations: AutomationOpt[] }>("/api/admin/email/automations"),
        ]);
        setCampaigns(c.campaigns ?? []);
        setAutomations(a.automations ?? []);
        if (c.campaigns?.[0]) setCampaignId(c.campaigns[0].id);
        if (a.automations?.[0]) setAutomationId(a.automations[0].id);
      } catch {
        /* optional */
      }
    })();
  }, []);

  async function handleDelete() {
    if (!user) return;
    const label = user.display_name?.trim() || user.email;
    const ok = window.confirm(
      `Удалить пользователя «${label}»?\n\nАккаунт и данные профиля будут удалены. Записи об оплатах останутся в отчётах (с email покупателя).`,
    );
    if (!ok) return;
    const again = window.confirm("Подтвердите ещё раз: удаление необратимо.");
    if (!again) return;

    setDeleting(true);
    setError(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      router.replace("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить пользователя");
      setDeleting(false);
    }
  }

  async function toggleSkip(next: boolean) {
    if (!user) return;
    setBusy(true);
    try {
      await adminFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ skip_email_automations: next }),
      });
      setUser({ ...user, skip_email_automations: next });
      setInfo(next ? "Автоцепочки отключены" : "Автоцепочки разрешены");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    if (!user) return;
    setNameSaving(true);
    setNameError(null);
    try {
      const res = await adminFetch<{
        user: { display_name: string | null; last_name: string | null };
      }>(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "set_name",
          display_name: nameDraft.display_name,
          last_name: nameDraft.last_name,
        }),
      });
      setUser({
        ...user,
        display_name: res.user.display_name,
        last_name: res.user.last_name,
      });
      setNameEditOpen(false);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Не удалось сохранить имя");
    } finally {
      setNameSaving(false);
    }
  }

  async function cancelSubscription() {
    if (!user || !subscription) return;
    if (
      !window.confirm(
        "Отменить автопродление? Доступ по тарифу останется до конца оплаченного периода.",
      )
    ) {
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      const res = await adminFetch<{ cancelled: boolean; accessUntil: string | null }>(
        `/api/admin/users/${user.id}/subscription`,
        { method: "DELETE" },
      );
      setInfo(
        res.accessUntil
          ? `Оплата отменена. Доступ до ${formatAdminDateTime(res.accessUntil)}`
          : "Оплата отменена",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить оплату");
    } finally {
      setBusy(false);
    }
  }

  async function launchChain() {
    if (!user || !automationId) return;
    const chainName =
      automations.find((a) => a.id === automationId)?.name ?? "цепочку";
    if (!window.confirm(`Запустить цепочку «${chainName}» для этого пользователя?`)) {
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}/messaging`, {
        method: "POST",
        body: JSON.stringify({ action: "launch_chain", automation_id: automationId }),
      });
      setInfo("Цепочка запущена");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось запустить");
    } finally {
      setBusy(false);
    }
  }

  async function cancelChain(enrollment: ActiveEnrollment) {
    if (!user) return;
    if (
      !window.confirm(
        `Отменить цепочку «${enrollment.automation_name}» для этого пользователя? Дальнейшие письма из неё отправляться не будут.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}/messaging`, {
        method: "POST",
        body: JSON.stringify({
          action: "cancel_chain",
          enrollment_id: enrollment.id,
        }),
      });
      setInfo("Цепочка отменена");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить цепочку");
    } finally {
      setBusy(false);
    }
  }

  function emailHistoryLabel(e: EmailHist): string {
    if (e.kind === "automation") {
      const chain = (e.chain_name || "").trim() || "Цепочка";
      const letter = (e.letter_name || e.subject || "").trim() || "Письмо";
      const base = `${chain} · ${letter}`;
      return e.status === "skipped" ? `${base} · нет языка` : base;
    }
    return (e.subject || "").trim() || "Рассылка";
  }

  async function sendCampaign() {
    if (!user || !campaignId) return;
    const camp = campaigns.find((c) => c.id === campaignId);
    const label = camp?.name || camp?.subject || "рассылку";
    if (!window.confirm(`Отправить письмо «${label}» на ${user.email}?`)) {
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await adminFetch(`/api/admin/users/${user.id}/messaging`, {
        method: "POST",
        body: JSON.stringify({ action: "send_campaign", campaign_id: campaignId }),
      });
      setInfo("Письмо отправлено");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить письмо");
    } finally {
      setBusy(false);
    }
  }

  async function sendPush() {
    if (!user || !pushTitle.trim()) return;
    if (
      !window.confirm(
        `Отправить уведомление «${pushTitle.trim()}» этому пользователю?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await adminFetch("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          title: pushTitle.trim(),
          body: pushBody.trim(),
          segment: `user:${user.id}`,
        }),
      });
      setInfo("Уведомление отправлено");
      setPushTitle("");
      setPushBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить уведомление");
    } finally {
      setBusy(false);
    }
  }

  function emailHref(e: EmailHist): string | null {
    if (e.kind === "campaign" && e.campaign_id) return `/admin/email/${e.campaign_id}`;
    if (e.kind === "automation" && e.automation_id && e.step_id) {
      return `/admin/email/automations/${e.automation_id}/steps/${e.step_id}`;
    }
    if (e.kind === "automation" && e.automation_id) {
      return `/admin/email/automations/${e.automation_id}`;
    }
    return null;
  }

  if (error && !user) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <p className="text-sm text-rose-600">{error}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Загружаю…
        </p>
      </div>
    );
  }

  const marketingLabel = contact?.marketing_status
    ? (MARKETING_STATUS_RU[contact.marketing_status] ?? contact.marketing_status)
    : "—";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <BackLink />

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {info ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {info}
        </p>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-800">Общее</h2>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="text-lg font-bold text-zinc-900">
            {[user.display_name?.trim(), user.last_name?.trim()].filter(Boolean).join(" ") ||
              "Без имени"}
          </h1>
          {isEmailOnlyUser(user) ? (
            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
              Только рассылки
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setNameError(null);
              setNameDraft({
                display_name: user.display_name?.trim() || "",
                last_name: user.last_name?.trim() || "",
              });
              setNameEditOpen(true);
            }}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            изменить
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Телефон" value={user.phone?.trim() || "—"} />
          <InfoRow
            label="Местонахождение"
            value={formatLocation(user)}
            href={mapsUrl(user)}
          />
          <InfoRow label="Язык" value={user.locale ?? "—"} />
          {user.crm_imported_at ? (
            <>
              <InfoRow
                label="Регистрация в Геткурсе"
                value={formatAdminDate(user.created_at)}
              />
              <InfoRow
                label="Последняя активность в Геткурсе"
                value={formatAdminDateTime(user.getcourse_last_activity_at)}
              />
            </>
          ) : (
            <InfoRow label="Регистрация" value={formatAdminDate(user.created_at)} />
          )}
          <InfoRow label="Статус писем" value={marketingLabel} />
          <div className="sm:col-span-2">
            <dt className="text-xs text-zinc-400">Комментарий</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-900">
              {user.admin_note?.trim() || "—"}
            </dd>
          </div>
          {crmProducts.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-zinc-400">Курсы в Геткурсе</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {crmProducts.map((p) => (
                  <span
                    key={p.slug}
                    className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-800"
                  >
                    {p.title}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>

        <label className="mt-4 flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={Boolean(user.skip_email_automations)}
            disabled={busy}
            onChange={(e) => void toggleSkip(e.target.checked)}
          />
          Не отправлять автоцепочки писем (тестовые / модератор)
        </label>

        <div className="mt-4 border-t border-zinc-100 pt-4">
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100 disabled:opacity-50"
          >
            {deleting ? "Удаляю…" : "Удалить пользователя"}
          </button>
        </div>
      </section>

      {user.onboarded_at ? (
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-zinc-800">Гармонизатор</h2>
            <AccessNowBadge
              membershipTier={user.membership_tier}
              membershipExpiresAt={user.membership_expires_at}
              trialExpiresAt={user.trial_expires_at}
            />
            <AutoRenewCancelledNote show={user.auto_renew_cancelled} />
            {(() => {
              const period = formatAccessPeriodHeader({
                membershipTier: user.membership_tier,
                membershipExpiresAt: user.membership_expires_at,
                trialExpiresAt: user.trial_expires_at,
                startedAt: user.membership_started_at,
                createdAt: user.onboarded_at || user.created_at,
                paidPeriodEnd: subscription?.current_period_end,
              });
              return period ? (
                <span className="text-sm text-zinc-600">{period}</span>
              ) : null;
            })()}
            <button
              type="button"
              onClick={() => {
                setAccessError(null);
                setAccessEditOpen(true);
              }}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              изменить
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <InfoRow label="Регистрация" value={formatAdminDate(user.onboarded_at)} />
            <InfoRow
              label="Последняя активность"
              value={formatAdminDateTime(
                user.last_activity_at || user.last_seen_at,
              )}
            />
            {subscription?.status === "active" ? (
              <InfoRow
                label="След. списание"
                value={
                  subscription.current_period_end
                    ? `${formatMoney(subscription.amount, subscription.currency)} · ${formatAdminDateTime(subscription.current_period_end)}`
                    : formatMoney(subscription.amount, subscription.currency)
                }
              />
            ) : null}
          </dl>
          <div className="mt-3">
            <Link
              href={`/admin/users/${user.id}/dialogs`}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Диалоги ассистента (7 дней)
            </Link>
          </div>
          {subscription?.status === "active" ? (
            <div className="mt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => void cancelSubscription()}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                Отменить оплату
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-800">Автоцепочка</h2>
        {activeEnrollments.length > 0 ? (
          <ul className="divide-y divide-zinc-100 text-sm">
            {activeEnrollments.map((en) => {
              const stepHuman = en.current_position + 1;
              const progress =
                en.steps_total > 0
                  ? `шаг ${Math.min(stepHuman, en.steps_total)} из ${en.steps_total}`
                  : `позиция ${en.current_position}`;
              return (
                <li
                  key={en.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/admin/email/automations/${en.automation_id}`}
                      className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline"
                    >
                      {en.automation_name}
                    </Link>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {progress}
                      {en.next_step_at
                        ? ` · следующее: ${formatAdminDateTime(en.next_step_at)}`
                        : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelChain(en)}
                    className="shrink-0 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
                  >
                    Отменить
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-400">Нет активных цепочек</p>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
          <label className="min-w-[200px] flex-1 text-xs text-zinc-500">
            Запустить цепочку
            <select
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              value={automationId}
              onChange={(e) => setAutomationId(e.target.value)}
            >
              {automations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_active ? "" : " (выкл.)"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !automationId}
            onClick={() => void launchChain()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Send size={14} /> Запустить
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Письма</h2>
          {emailHistoryTotal > 10 ? (
            <Link
              href={`/admin/email?user_id=${user.id}`}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Все рассылки ({emailHistoryTotal})
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1 text-xs text-zinc-500">
            Отправить письмо (10 недавних рассылок)
            <select
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              {campaigns.length === 0 ? (
                <option value="">Нет рассылок</option>
              ) : (
                campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.name || c.subject || c.id).slice(0, 60)}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !campaignId}
            onClick={() => void sendCampaign()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Send size={14} /> Отправить письмо
          </button>
        </div>
        <ul className="divide-y divide-zinc-100 text-sm">
          {emailHistory.length === 0 ? (
            <li className="py-2 text-zinc-400">Пока нет отправок</li>
          ) : (
            emailHistory.map((e, i) => {
              const href = emailHref(e);
              const statusText =
                e.status === "skipped" ? "нет языка" : emailStatusLabel(e.status);
              const row = (
                <span className="flex w-full items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate font-normal text-zinc-800">
                    <span className="text-xs text-zinc-400">
                      {e.kind === "automation" ? "цепочка" : "рассылка"} ·{" "}
                    </span>
                    {emailHistoryLabel(e)}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${emailStatusClass(e.status)}`}
                    >
                      {statusText}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatAdminDateTime(e.created_at)}
                    </span>
                  </span>
                </span>
              );
              return (
                <li key={`${e.created_at}-${i}`}>
                  {href ? (
                    <Link
                      href={href}
                      className="block transition-colors hover:bg-zinc-50"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Уведомления</h2>
          {notificationsTotal > 10 ? (
            <Link
              href={`/admin/notifications?user_id=${user.id}`}
              className="text-xs font-medium text-emerald-700 hover:underline"
            >
              Все уведомления ({notificationsTotal})
            </Link>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">
            Заголовок
            <input
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              value={pushTitle}
              onChange={(e) => setPushTitle(e.target.value)}
              placeholder="Заголовок push"
            />
          </label>
          <label className="block text-xs text-zinc-500">
            Текст
            <textarea
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              rows={2}
              value={pushBody}
              onChange={(e) => setPushBody(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !pushTitle.trim()}
            onClick={() => void sendPush()}
            className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Send size={14} /> Отправить уведомление
          </button>
        </div>
        <ul className="divide-y divide-zinc-100 text-sm">
          {notifications.length === 0 ? (
            <li className="py-2 text-zinc-400">Пока нет доставок</li>
          ) : (
            notifications.map((n) => {
              const href = n.notification_id
                ? `/admin/notifications/${n.notification_id}`
                : null;
              const read = Boolean(n.read_at);
              const row = (
                <span className="flex w-full items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate font-normal text-zinc-800">
                    {n.title}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        read
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {read ? "прочитано" : "не прочитано"}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatAdminDateTime(n.created_at)}
                    </span>
                  </span>
                </span>
              );
              return (
                <li key={n.id}>
                  {href ? (
                    <Link
                      href={href}
                      className="block transition-colors hover:bg-zinc-50"
                    >
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })
          )}
        </ul>
      </section>

      <PaymentHistorySection payments={payments} ownerUserId={user.id} onChanged={load} />

      <AccessEditModal
        open={accessEditOpen}
        saving={accessSaving}
        error={accessError}
        initial={accessEditInitialFromUser(user)}
        onClose={() => {
          if (!accessSaving) {
            setAccessEditOpen(false);
            setAccessError(null);
          }
        }}
        onSubmit={async ({ access, startsAtIso, endsAtIso }) => {
          setAccessSaving(true);
          setAccessError(null);
          try {
            await adminFetch(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                action: "set_access",
                access,
                starts_at: startsAtIso,
                ends_at: endsAtIso,
              }),
            });
            setAccessEditOpen(false);
            await load();
          } catch (err) {
            setAccessError(
              err instanceof Error ? err.message : "Не удалось изменить тариф",
            );
          } finally {
            setAccessSaving(false);
          }
        }}
      />

      {nameEditOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-zinc-900">Имя и фамилия</h3>
            <div className="mt-3 flex flex-col gap-3">
              <label className="block text-sm">
                <span className="text-zinc-500">Имя</span>
                <input
                  type="text"
                  value={nameDraft.display_name}
                  onChange={(e) =>
                    setNameDraft((d) => ({ ...d, display_name: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                  autoFocus
                />
              </label>
              <label className="block text-sm">
                <span className="text-zinc-500">Фамилия</span>
                <input
                  type="text"
                  value={nameDraft.last_name}
                  onChange={(e) =>
                    setNameDraft((d) => ({ ...d, last_name: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
              {nameError ? <p className="text-sm text-rose-600">{nameError}</p> : null}
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={nameSaving}
                  onClick={() => {
                    if (!nameSaving) {
                      setNameEditOpen(false);
                      setNameError(null);
                    }
                  }}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Отменить
                </button>
                <button
                  type="button"
                  disabled={nameSaving}
                  onClick={() => void saveName()}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {nameSaving ? "Сохраняю…" : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/users"
      className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"
    >
      <ArrowLeft size={15} /> Все пользователи
    </Link>
  );
}

function InfoRow({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string | null;
}) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-zinc-800 ${mono ? "break-all font-mono text-xs" : ""}`}>
        {href && value !== "—" ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-700 underline-offset-2 hover:underline"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
