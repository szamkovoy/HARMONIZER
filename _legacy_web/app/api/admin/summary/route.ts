import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseWeeks(raw: string | null): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 52) return Math.floor(n);
  return 8;
}

/** Comma-separated test emails from env → text[] for the RPC. */
function readTestEmails(): string[] {
  const raw = process.env.ADMIN_SUMMARY_TEST_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type SummaryReport = {
  generated_at: string;
  weeks: number;
  since: string;
  until: string;
  test_excluded: number;
  payments: {
    by_week: Array<{
      week: string;
      count: number;
      sum_rub: number;
      webinar: number;
      oracle: number;
      master: number;
      book: number;
      other: number;
      yookassa: number;
      lava: number;
      first_time: number;
    }>;
    first_time_payers: number;
    refunds: { count: number; sum_rub: number };
  };
  subscriptions: {
    active: { oracle: number; master: number; manual_grants: number };
    period: {
      new_oracle: number;
      new_master: number;
      renewals: number;
      cancelled: number;
      expired: number;
    };
    months_distribution: Array<{ bucket: string; users: number }>;
  };
  webinars: Array<{
    starts_at: string;
    title: string;
    one_time: number;
    masters: number;
    repeat_buyers: number;
  }>;
  mailings: {
    campaigns: Array<{
      sent_at: string;
      subject: string;
      sent: number;
      delivered: number;
      opened: number;
      clicked: number;
      unsubscribed: number;
      bounced: number;
      complained: number;
    }>;
    automations: { sends: number; sent: number };
  };
  app: {
    registrations_by_week: Array<{ week: string; count: number }>;
    active_7d: number;
    active_30d: number;
    consistent_4w: number;
  };
  mailing_base: {
    total: number;
    active: number;
    unsubscribed: number;
    suppressed: number;
    complained: number;
    opened_90d: number;
    clicked_90d: number;
  };
};

/** GET returns the structured report; POST returns a ready-to-copy Markdown text. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const weeks = parseWeeks(url.searchParams.get("weeks"));
    const db = createServiceSupabase();
    const { data, error } = await db.rpc("admin_summary_report", {
      p_weeks: weeks,
      p_test_emails: readTestEmails(),
    });
    if (error) throw error;
    return json({ report: data as SummaryReport });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const weeks = parseWeeks(url.searchParams.get("weeks"));
    const db = createServiceSupabase();
    const { data, error } = await db.rpc("admin_summary_report", {
      p_weeks: weeks,
      p_test_emails: readTestEmails(),
    });
    if (error) throw error;
    return json({ text: buildMarkdown(data as SummaryReport) });
  } catch (error) {
    return errorResponse(error);
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

/** Week labels are already the Moscow Monday as YYYY-MM-DD. Do not reparse via UTC. */
function fmtWeek(week: string): string {
  return week;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
}

function rub(n: number | undefined | null): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildMarkdown(r: SummaryReport): string {
  const lines: string[] = [];
  const L = lines.push.bind(lines);
  // inline code wrapper — avoids nested backticks inside template literals
  const c = (s: string): string => "`" + s + "`";

  L(`# Сводка HARMONIZER`);
  L(``);
  L(`Сформировано: ${fmtDateTime(r.generated_at)}`);
  L(`Период: ${fmtDate(r.since)} — ${fmtDate(r.until)} (${r.weeks} нед., с понедельника, МСК)`);
  L(`Тестовых аккаунтов исключено: ${r.test_excluded}`);
  L(``);

  // 1. Payments
  L(`## 1. Оплаты по неделям`);
  L(``);
  L(`| Неделя | Оплат | Сумма, ₽ (net) | Вебинар | Наставник | Мастер | Книга | Другое | ЮKassa | Lava | Впервые |`);
  L(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const w of r.payments.by_week) {
    L(`| ${fmtWeek(w.week)} | ${w.count} | ${rub(w.sum_rub)} | ${w.webinar} | ${w.oracle} | ${w.master} | ${w.book} | ${w.other} | ${w.yookassa} | ${w.lava} | ${w.first_time} |`);
  }
  const totalPay = r.payments.by_week.reduce((a, w) => a + w.count, 0);
  const totalRub = r.payments.by_week.reduce((a, w) => a + Number(w.sum_rub ?? 0), 0);
  L(`| **Итого** | **${totalPay}** | **${rub(totalRub)}** | | | | | | | | **${r.payments.first_time_payers}** |`);
  L(``);
  L(`> Возвратов за период: ${r.payments.refunds.count} на сумму ${rub(r.payments.refunds.sum_rub)} ₽. Гранты (${c("payments.source=manual")}) показаны отдельно в разделе 2 и не входят в эту таблицу.`);
  L(``);

  // 2. Subscriptions
  L(`## 2. Подписки`);
  L(``);
  L(`**Активные оплаченные (на момент открытия):** Наставник ${r.subscriptions.active.oracle} · Мастер ${r.subscriptions.active.master} · активны по ручному гранту ${r.subscriptions.active.manual_grants}.`);
  L(``);
  L(`**За период:** новых Наставник ${r.subscriptions.period.new_oracle} · новых Мастер ${r.subscriptions.period.new_master} · продлений ${r.subscriptions.period.renewals} · отменили автоплатёж ${r.subscriptions.period.cancelled} · истёк доступ без продления ${r.subscriptions.period.expired}.`);
  L(``);
  L(`**Сколько месяцев платят нынешние подписчики:**`);
  L(``);
  L(`| Месяцев | Человек |`);
  L(`|---|---|`);
  for (const m of r.subscriptions.months_distribution) {
    L(`| ${m.bucket} | ${m.users} |`);
  }
  L(``);

  // 3. Webinars
  L(`## 3. Вебинары`);
  L(``);
  if (r.webinars.length === 0) {
    L(`За период вебинаров не было.`);
    L(``);
  } else {
    L(`| Дата | Название | Разовых покупок | Активных «Мастеров» на дату | Из разовых — покупали раньше |`);
    L(`|---|---|---|---|---|`);
    for (const w of r.webinars) {
      L(`| ${w.starts_at} | ${w.title} | ${w.one_time} | ${w.masters} | ${w.repeat_buyers} |`);
    }
    L(``);
  }

  // 4. Mailings
  L(`## 4. Рассылки`);
  L(``);
  if (r.mailings.campaigns.length === 0) {
    L(`Отправленных кампаний за период не было.`);
    L(``);
  } else {
    L(`| Дата | Тема | Отправлено | Доставлено | Открыто | Клики | Отписки | Bounce | Жалобы |`);
    L(`|---|---|---|---|---|---|---|---|---|`);
    for (const c of r.mailings.campaigns) {
      L(`| ${c.sent_at} | ${c.subject} | ${c.sent} | ${c.delivered} | ${c.opened} | ${c.clicked} | ${c.unsubscribed} | ${c.bounced} | ${c.complained} |`);
    }
    L(``);
  }
  const a = r.mailings.automations;
  L(`**Цепочки (итог за период):** писем отправлено ${a.sends}, из них принято ${a.sent}.`);
  L(``);

  // 5. App
  L(`## 5. Приложение`);
  L(``);
  L(`**Регистрации в Гармонизаторе по неделям** (по ${c("users.onboarded_at")}):`);
  L(``);
  L(`| Неделя | Регистраций |`);
  L(`|---|---|`);
  for (const w of r.app.registrations_by_week) {
    L(`| ${fmtWeek(w.week)} | ${w.count} |`);
  }
  const totalReg = r.app.registrations_by_week.reduce((a, w) => a + w.count, 0);
  L(`| **Итого** | **${totalReg}** |`);
  L(``);
  L(`**Активные:** за 7 дней ${r.app.active_7d} · за 30 дней ${r.app.active_30d}.`);
  L(``);
  L(`**«Постоянные»** (заходили в 3 из 4 последних недель): ${r.app.consistent_4w}.`);
  L(``);

  // 6. Mailing base
  L(`## 6. База рассылки`);
  L(``);
  const b = r.mailing_base;
  L(`Всего ${b.total} · active ${b.active} · отписались ${b.unsubscribed} · не доставляется ${b.suppressed} · пометили как спам ${b.complained}.`);
  L(`Открывали письма за 90 дней ${b.opened_90d} · кликали за 90 дней ${b.clicked_90d}.`);
  L(``);

  // 7. Definitions
  L(`## 7. Определения`);
  L(``);
  L(`- **Оплаты (раздел 1):** ${c("payment_settlements")} (net, ${c("refunded_at IS NULL")}) join ${c("payment_contracts")}. Неделя — понедельник по МСК, в таблице дата этого понедельника. Категории: Вебинар (${c("webinar")} + ${c("one_time")}), Наставник (${c("oracle")} + ${c("subscription")}), Мастер (${c("master")} + ${c("subscription")}), Книга (${c("tier='book'")}), Другое — всё остальное. Сумма пяти категорий равна числу оплат. «Впервые» в строке недели — люди, чья первая успешная оплата в базе пришлась на эту неделю; в итоге — за весь период.`);
  L(`- **Подписки активные:** ${c("payment_contracts")} ${c("product_kind='subscription', status='active'")}. Гранты — ${c("payments.source='manual'")} с действующим ${c("paid_until")}.`);
  L(`- **Новые:** люди, чей первый успешный settlement подписки этого тарифа попал в период. **Продления:** settlement'ы подписки в периоде, перед которыми у человека уже был успешный settlement подписки того же тарифа. **Отменили** = ${c("cancelled_at")} в периоде (контракт создан в периоде). **Истёк** = ${c("status='cancelled'")} и ${c("current_period_end")} в периоде в прошлом (контракт создан в периоде).`);
  L(`- **Месяцев платит:** число успешных ${c("payment_settlements")} на активном контракте, по ${c("(user_id, tier)")}, бакеты 1 / 2 / 3+.`);
  L(`- **Вебинары:** все с ${c("starts_at")} в периоде и, если есть, один ближайший будущий. Разовая покупка (${c("one_time")}, ${c("tier='webinar'")}, есть settlement, ${c("refunded_at IS NULL")}, ${c("product_ref")} может быть пустым) относится к ближайшему вебинару с ${c("starts_at >= paid_at")}. «Мастеров» = активные подписки Мастер на эту дату плюс ручные гранты ${c("source='manual', tier='master'")}; один человек считается один раз. «Покупали раньше» = есть более ранний webinar-контракт, отнесённый к другому вебинару.`);
  L(`- **Рассылки:** ${c("email_campaigns")} ${c("status='sent'")}, счётчики из колонок кампании. Цепочки — ${c("email_automation_sends")}: сколько писем ушло и сколько из них приняты (${c("status='sent'")}). Открытия и клики цепочек не пишутся.`);
  L(`- **Регистрации:** ${c("users.onboarded_at")} (не ${c("created_at")} — там лежит и CRM-импорт).`);
  L(`- **Активные:** ${c("users.last_seen_at")} за 7/30 дней.`);
  L(`- **«Постоянные»:** ${c("user_event_log")} ${c("kind='app_open'")} в ≥3 из 4 последних недель (сканируются только 4 недели по индексу).`);
  L(`- **База рассылки:** ${c("email_contacts")} (HEAD-count по ${c("marketing_status")}); ${c("last_open_at")}/${c("last_click_at")} за 90 дней.`);
  L(`- **Тестовые:** email из env ${c("ADMIN_SUMMARY_TEST_EMAILS")} → ${c("auth.users.id")}; эти ${c("user_id")} исключены из всех подсчётов. Вывод — без email и имён.`);

  return lines.join("\n");
}
