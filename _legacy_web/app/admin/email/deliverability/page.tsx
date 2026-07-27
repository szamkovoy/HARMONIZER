"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldOff,
  ShieldCheck,
} from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { formatAdminDateTime } from "../../_lib/adminDates";

type DayBucket = {
  date: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  delayed: number;
  failed: number;
  suppressed: number;
};

type Report = {
  period_days: number;
  totals: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    delayed: number;
    failed: number;
    suppressed_events: number;
    delivery_rate: number | null;
    open_rate: number | null;
    click_rate: number | null;
    bounce_rate: number | null;
    complaint_rate: number | null;
  };
  series: DayBucket[];
  contact_status: Record<string, number>;
  recent_problems: {
    created_at: string;
    event_type: string;
    email: string | null;
    bounce_type: string | null;
    bounce_subtype: string | null;
    message: string | null;
    campaign_id: string | null;
    user_id: string | null;
    display_name: string | null;
  }[];
  alerts: string[];
  resend: {
    suppressions: {
      id: string;
      email: string;
      origin: string;
      created_at: string;
    }[];
    suppressions_error: string | null;
    suppressions_count: number;
  };
};

const PERIODS = [7, 30, 90] as const;

const CONTACT_LABELS: Record<string, string> = {
  active: "Получает письма",
  unsubscribed: "Отписался",
  suppressed: "Не доставляется",
  complained: "Пометил как спам",
};

const EVENT_LABELS: Record<string, string> = {
  "email.bounced": "Не доставлено (отказ сервера)",
  "email.complained": "Жалоба «это спам»",
  "email.failed": "Ошибка отправки",
  "email.suppressed": "Заблокировано списком запрета",
  "suppression.added": "Добавлен в список запрета",
  "suppression.removed": "Убран из списка запрета",
};

const ORIGIN_LABELS: Record<string, string> = {
  bounce: "отказ доставки",
  complaint: "жалоба на спам",
  manual: "вручную",
};

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v}%`;
}

function isRestrictedKeyError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return /restricted_api_key|only send emails/i.test(msg);
}

function friendlyResendError(msg: string | null | undefined): string | null {
  if (!msg) return null;
  if (isRestrictedKeyError(msg)) {
    return "Ключ Resend сейчас только для отправки писем. Список запрета и проверка домена недоступны, пока не сделаете ключ с полным доступом (Full access) в Resend → API Keys и обновите RESEND_ZAMKOVOI_RU_API_KEY на Vercel.";
  }
  return msg;
}

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        warn ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-zinc-400">{hint}</div> : null}
    </div>
  );
}

function MiniBars({ series }: { series: DayBucket[] }) {
  const max = Math.max(
    1,
    ...series.map((d) => Math.max(d.sent, d.delivered, d.bounced)),
  );
  return (
    <div className="flex h-28 items-end gap-0.5">
      {series.map((d) => (
        <div
          key={d.date}
          className="flex flex-1 flex-col items-center gap-0.5"
          title={`${d.date}: доставлено ${d.delivered}, отказов ${d.bounced}`}
        >
          <div className="flex w-full flex-1 items-end gap-px">
            <div
              className="flex-1 rounded-t bg-emerald-500/80"
              style={{
                height: `${(d.delivered / max) * 100}%`,
                minHeight: d.delivered ? 2 : 0,
              }}
            />
            <div
              className="flex-1 rounded-t bg-rose-400/80"
              style={{
                height: `${(d.bounced / max) * 100}%`,
                minHeight: d.bounced ? 2 : 0,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminEmailDeliverabilityPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [originFilter, setOriginFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminFetch<Report>(
        `/api/admin/email/deliverability?days=${days}`,
      );
      setReport(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    body: Record<string, unknown>,
    okMsg: string,
  ): Promise<boolean> {
    setBusy(true);
    setInfo(null);
    try {
      await adminFetch("/api/admin/email/deliverability", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setInfo(okMsg);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка действия");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const t = report?.totals;
  const filteredSuppressions =
    report?.resend.suppressions.filter((s) =>
      originFilter === "all" ? true : s.origin === originFilter,
    ) ?? [];

  const resendApiBlocked = isRestrictedKeyError(report?.resend.suppressions_error);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link href="/admin/email" className="mt-1 text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold text-zinc-900">Доставляемость</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-zinc-200 bg-white p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  days === p ? "bg-emerald-600 text-white" : "text-zinc-600"
                }`}
              >
                {p}д
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RefreshCw size={16} />
            )}
            Обновить
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

      {loading && !report ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Считаю метрики…
        </div>
      ) : null}

      {report && t ? (
        <>
          {report.alerts.length > 0 ? (
            <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle size={16} /> На что обратить внимание
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                {report.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {resendApiBlocked ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Список запрета Resend недоступен</p>
              <p className="mt-1 text-amber-900/90">
                {friendlyResendError(report.resend.suppressions_error)}
              </p>
              <p className="mt-2 text-xs text-amber-800/80">
                Локальные статусы контактов и метрики по письмам работают и без этого.
                Автопометка при отказе/спаме тоже работает через webhook.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Отправлено" value={String(t.sent)} hint="сколько писем ушло" />
            <Kpi
              label="Доставлено"
              value={String(t.delivered)}
              hint={pct(t.delivery_rate)}
            />
            <Kpi
              label="Открыто"
              value={String(t.opened)}
              hint={`${pct(t.open_rate)} от доставленных`}
            />
            <Kpi
              label="Клики"
              value={String(t.clicked)}
              hint={`${pct(t.click_rate)} от доставленных`}
            />
            <Kpi
              label="Отказ доставки"
              value={String(t.bounced)}
              hint={`${pct(t.bounce_rate)} от отправленных`}
              warn={(t.bounce_rate ?? 0) >= 5}
            />
            <Kpi
              label="Жалоба «спам»"
              value={String(t.complained)}
              hint={`${pct(t.complaint_rate)} от доставленных`}
              warn={(t.complaint_rate ?? 0) >= 0.3}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 lg:col-span-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
                <Activity size={16} className="text-emerald-600" />
                По дням: зелёный — доставлено, красный — отказ
              </div>
              <MiniBars series={report.series} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-zinc-600 sm:grid-cols-3 lg:grid-cols-5">
                <span>Открыто: {t.opened}</span>
                <span>Клики: {t.clicked}</span>
                <span title="Почта получателя временно не приняла; Resend ещё пробует">
                  Задержка: {t.delayed}
                </span>
                <span title="Письмо так и не ушло">Ошибка отправки: {t.failed}</span>
                <span title="Адрес уже в списке запрета Resend">
                  Блок запрета: {t.suppressed_events}
                </span>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-zinc-800">
                Статусы подписки (контакты)
              </h2>
              <p className="text-[11px] text-zinc-400">
                Кому вообще можно слать маркетинговые письма.
              </p>
              <dl className="space-y-1.5 text-sm">
                {(["active", "unsubscribed", "suppressed", "complained"] as const).map(
                  (k) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-zinc-500">{CONTACT_LABELS[k] ?? k}</dt>
                      <dd className="font-medium text-zinc-900">
                        {report.contact_status[k] ?? 0}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
              <p className="text-[11px] text-zinc-400">
                {resendApiBlocked
                  ? "Список запрета Resend недоступен (нужен ключ Full access). Статусы при отказе/спаме всё равно обновляются через webhook."
                  : "Список запрета Resend синхронизируется с контактами раз в сутки (cron). Отказ и «спам» помечают контакт сразу через webhook."}
              </p>
            </section>
          </div>

          {!resendApiBlocked ? (
            <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-800">
                    Список запрета Resend ({report.resend.suppressions_count})
                  </h2>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Адреса, на которые Resend больше не будет слать (ни мы, ни другие
                    проекты на этом ключе). Снять можно только осознанно.
                  </p>
                </div>
                <select
                  value={originFilter}
                  onChange={(e) => setOriginFilter(e.target.value)}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
                >
                  <option value="all">Все причины</option>
                  <option value="bounce">отказ доставки</option>
                  <option value="complaint">жалоба на спам</option>
                  <option value="manual">вручную</option>
                </select>
              </div>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const email = manualEmail.trim().toLowerCase();
                  if (!email) return;
                  void (async () => {
                    const ok = await runAction(
                      { action: "suppress", email },
                      `Адрес запрещён: ${email}`,
                    );
                    if (ok) setManualEmail("");
                  })();
                }}
              >
                <input
                  type="email"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="email@example.com — запретить вручную"
                  className="min-w-[220px] flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={busy || !manualEmail.trim()}
                  className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  <ShieldOff size={12} /> Запретить
                </button>
              </form>
              {filteredSuppressions.length === 0 ? (
                <p className="text-sm text-zinc-400">Список пуст</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-zinc-500">
                      <tr>
                        <th className="py-2 pr-3">Email</th>
                        <th className="py-2 pr-3">Причина</th>
                        <th className="py-2 pr-3">Когда</th>
                        <th className="py-2">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSuppressions.map((s) => (
                        <tr key={s.id} className="border-t border-zinc-100">
                          <td className="py-2 pr-3 font-mono text-xs text-zinc-800">
                            {s.email}
                          </td>
                          <td className="py-2 pr-3 text-zinc-600">
                            {ORIGIN_LABELS[s.origin] ?? s.origin}
                          </td>
                          <td className="py-2 pr-3 text-xs text-zinc-500">
                            {formatAdminDateTime(s.created_at)}
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              disabled={busy}
                              title="Разрешить снова слать на этот адрес"
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Снять запрет для ${s.email}? Письма снова смогут уходить.`,
                                  )
                                ) {
                                  return;
                                }
                                void runAction(
                                  {
                                    action: "unsuppress",
                                    email: s.email,
                                    restore_contact: true,
                                  },
                                  `Запрет снят: ${s.email}`,
                                );
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              <ShieldCheck size={12} /> Разрешить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-800">
              Недавние проблемы
            </h2>
            <p className="text-[11px] text-zinc-400">
              Пользователи, у которых с письмом что-то пошло не так. Статус подписки при
              жёстком отказе / спаме меняется сам — откройте карточку, чтобы посмотреть
              профиль.
            </p>
            {report.recent_problems.length === 0 ? (
              <p className="text-sm text-zinc-400">За период проблем не было</p>
            ) : (
              <ul className="divide-y divide-zinc-100 text-sm">
                {report.recent_problems.map((p, i) => {
                  const label =
                    p.display_name?.trim() ||
                    p.email ||
                    "Без имени";
                  return (
                    <li key={`${p.created_at}-${i}`} className="py-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">
                            {EVENT_LABELS[p.event_type] ?? p.event_type}
                          </span>
                          {p.user_id ? (
                            <Link
                              href={`/admin/users/${p.user_id}`}
                              className="ml-2 font-medium text-emerald-800 hover:underline"
                            >
                              {label}
                            </Link>
                          ) : (
                            <span className="ml-2 font-medium text-zinc-800">{label}</span>
                          )}
                          {p.display_name && p.email ? (
                            <span className="ml-2 font-mono text-[11px] text-zinc-400">
                              {p.email}
                            </span>
                          ) : null}
                          {p.bounce_type ? (
                            <span className="ml-2 text-xs text-rose-700">
                              {p.bounce_type === "Permanent"
                                ? "жёсткий отказ"
                                : p.bounce_type === "Transient"
                                  ? "временный"
                                  : p.bounce_type}
                              {p.bounce_subtype ? ` / ${p.bounce_subtype}` : ""}
                            </span>
                          ) : null}
                          {p.message ? (
                            <p className="mt-1 text-xs text-zinc-500">{p.message}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[11px] text-zinc-400">
                            {formatAdminDateTime(p.created_at)}
                          </span>
                          {p.email && !resendApiBlocked ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void runAction(
                                  { action: "suppress", email: p.email },
                                  `Адрес запрещён: ${p.email}`,
                                )
                              }
                              className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline disabled:opacity-50"
                            >
                              <ShieldOff size={11} /> Запретить
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
