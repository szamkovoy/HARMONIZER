/**
 * Aggregate deliverability metrics from email_events / contacts / campaigns.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliverabilityPeriod = 7 | 30 | 90;

export type DayBucket = {
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

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function emptyBucket(date: string): DayBucket {
  return {
    date,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    delayed: 0,
    failed: 0,
    suppressed: 0,
  };
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export async function buildDeliverabilityReport(
  db: SupabaseClient,
  days: DeliverabilityPeriod,
): Promise<{
  period_days: number;
  since: string;
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
    contact_id: string | null;
    user_id: string | null;
    display_name: string | null;
  }[];
  alerts: string[];
}> {
  const sinceDate = new Date(Date.now() - days * 86400_000);
  const since = sinceDate.toISOString();

  const { data: events, error } = await db
    .from("email_events")
    .select("event_type, created_at, payload, campaign_id, contact_id, resend_id")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20000);
  if (error) throw error;

  const seriesMap = new Map<string, DayBucket>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000);
    const key = d.toISOString().slice(0, 10);
    seriesMap.set(key, emptyBucket(key));
  }

  const totals = {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
    delayed: 0,
    failed: 0,
    suppressed_events: 0,
  };

  const problems: {
    created_at: string;
    event_type: string;
    email: string | null;
    bounce_type: string | null;
    bounce_subtype: string | null;
    message: string | null;
    campaign_id: string | null;
    contact_id: string | null;
    user_id: string | null;
    display_name: string | null;
  }[] = [];

  for (const ev of events ?? []) {
    const key = dayKey(ev.created_at);
    let bucket = seriesMap.get(key);
    if (!bucket) {
      bucket = emptyBucket(key);
      seriesMap.set(key, bucket);
    }
    const t = ev.event_type as string;
    const payload = (ev.payload ?? {}) as {
      data?: {
        to?: string[];
        bounce?: { type?: string; subType?: string; message?: string };
        failed?: { reason?: string };
        suppressed?: { message?: string; reason?: string };
        email?: string;
      };
    };
    const email =
      payload.data?.to?.[0]?.toLowerCase() ??
      payload.data?.email?.toLowerCase() ??
      null;

    switch (t) {
      case "email.sent":
        totals.sent += 1;
        bucket.sent += 1;
        break;
      case "email.delivered":
        totals.delivered += 1;
        bucket.delivered += 1;
        break;
      case "email.opened":
        totals.opened += 1;
        bucket.opened += 1;
        break;
      case "email.clicked":
        totals.clicked += 1;
        bucket.clicked += 1;
        break;
      case "email.bounced":
        totals.bounced += 1;
        bucket.bounced += 1;
        problems.push({
          created_at: ev.created_at,
          event_type: t,
          email,
          bounce_type: payload.data?.bounce?.type ?? null,
          bounce_subtype: payload.data?.bounce?.subType ?? null,
          message: payload.data?.bounce?.message ?? null,
          campaign_id: ev.campaign_id,
          contact_id: ev.contact_id,
          user_id: null,
          display_name: null,
        });
        break;
      case "email.complained":
        totals.complained += 1;
        bucket.complained += 1;
        problems.push({
          created_at: ev.created_at,
          event_type: t,
          email,
          bounce_type: null,
          bounce_subtype: null,
          message: "Spam complaint",
          campaign_id: ev.campaign_id,
          contact_id: ev.contact_id,
          user_id: null,
          display_name: null,
        });
        break;
      case "email.delivery_delayed":
        totals.delayed += 1;
        bucket.delayed += 1;
        break;
      case "email.failed":
        totals.failed += 1;
        bucket.failed += 1;
        problems.push({
          created_at: ev.created_at,
          event_type: t,
          email,
          bounce_type: null,
          bounce_subtype: null,
          message: payload.data?.failed?.reason ?? "failed",
          campaign_id: ev.campaign_id,
          contact_id: ev.contact_id,
          user_id: null,
          display_name: null,
        });
        break;
      case "email.suppressed":
      case "suppression.added":
        totals.suppressed_events += 1;
        bucket.suppressed += 1;
        problems.push({
          created_at: ev.created_at,
          event_type: t,
          email,
          bounce_type: null,
          bounce_subtype: null,
          message:
            payload.data?.suppressed?.message ??
            payload.data?.suppressed?.reason ??
            "suppressed",
          campaign_id: ev.campaign_id,
          contact_id: ev.contact_id,
          user_id: null,
          display_name: null,
        });
        break;
      default:
        break;
    }
  }

  problems.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const recentSlice = problems.slice(0, 40);

  // Resolve contact → user for problem list links.
  const contactIds = [
    ...new Set(recentSlice.map((p) => p.contact_id).filter(Boolean) as string[]),
  ];
  const emailsNeedingLookup = [
    ...new Set(
      recentSlice
        .filter((p) => !p.contact_id && p.email)
        .map((p) => p.email as string),
    ),
  ];
  const contactById = new Map<
    string,
    { email: string; user_id: string | null }
  >();
  const contactByEmail = new Map<
    string,
    { id: string; email: string; user_id: string | null }
  >();
  if (contactIds.length) {
    const { data: contacts } = await db
      .from("email_contacts")
      .select("id, email, email_normalized, user_id")
      .in("id", contactIds);
    for (const c of contacts ?? []) {
      contactById.set(c.id, {
        email: c.email_normalized || c.email,
        user_id: c.user_id,
      });
    }
  }
  if (emailsNeedingLookup.length) {
    const { data: contacts } = await db
      .from("email_contacts")
      .select("id, email, email_normalized, user_id")
      .in("email_normalized", emailsNeedingLookup);
    for (const c of contacts ?? []) {
      contactByEmail.set(c.email_normalized || c.email, {
        id: c.id,
        email: c.email_normalized || c.email,
        user_id: c.user_id,
      });
    }
  }
  const userIds = [
    ...new Set(
      [
        ...[...contactById.values()].map((c) => c.user_id),
        ...[...contactByEmail.values()].map((c) => c.user_id),
      ].filter(Boolean) as string[],
    ),
  ];
  const nameByUserId = new Map<string, string>();
  if (userIds.length) {
    const { data: users } = await db
      .from("users")
      .select("id, display_name")
      .in("id", userIds);
    for (const u of users ?? []) {
      const n = (u.display_name ?? "").trim();
      if (n) nameByUserId.set(u.id, n);
    }
  }
  const recent_problems = recentSlice.map((p) => {
    const fromId = p.contact_id ? contactById.get(p.contact_id) : null;
    const fromEmail = !fromId && p.email ? contactByEmail.get(p.email) : null;
    const userId = fromId?.user_id ?? fromEmail?.user_id ?? null;
    const email = fromId?.email ?? fromEmail?.email ?? p.email;
    return {
      ...p,
      email,
      contact_id: p.contact_id ?? fromEmail?.id ?? null,
      user_id: userId,
      display_name: userId ? nameByUserId.get(userId) ?? null : null,
    };
  });

  const { data: statusRows } = await db
    .from("email_contacts")
    .select("marketing_status")
    .limit(20000);
  const contact_status: Record<string, number> = {
    active: 0,
    unsubscribed: 0,
    suppressed: 0,
    complained: 0,
  };
  for (const row of statusRows ?? []) {
    const s = row.marketing_status as string;
    contact_status[s] = (contact_status[s] ?? 0) + 1;
  }

  const alerts: string[] = [];
  const bounceRate = rate(totals.bounced, Math.max(totals.sent, 1));
  const complaintRate = rate(totals.complained, Math.max(totals.delivered, 1));
  if (bounceRate != null && bounceRate >= 5) {
    alerts.push(
      `Много писем «не доставлено»: ${bounceRate}% за ${days}д (лучше держать ниже 2–5%).`,
    );
  }
  if (complaintRate != null && complaintRate >= 0.3) {
    alerts.push(
      `Жалобы «это спам»: ${complaintRate}% от доставленных — проверьте сегменты и частоту.`,
    );
  }
  if (totals.delayed > totals.delivered * 0.2 && totals.delivered > 10) {
    alerts.push(
      "Частые задержки у почтовых провайдеров относительно доставленных — возможны временные сбои у получателей.",
    );
  }
  if (contact_status.suppressed + contact_status.complained > contact_status.active * 0.15) {
    alerts.push(
      "Много контактов «не доставляется» / «спам» — перед массовой рассылкой лучше почистить базу.",
    );
  }
  if (totals.failed > 0 && totals.failed >= Math.max(3, totals.sent * 0.05)) {
    alerts.push(
      `Ошибок отправки: ${totals.failed} за период — проверьте лимиты Resend и корректность адресов.`,
    );
  }

  return {
    period_days: days,
    since,
    totals: {
      ...totals,
      delivery_rate: rate(totals.delivered, Math.max(totals.sent, 1)),
      open_rate: rate(totals.opened, Math.max(totals.delivered, 1)),
      click_rate: rate(totals.clicked, Math.max(totals.delivered, 1)),
      bounce_rate: rate(totals.bounced, Math.max(totals.sent, 1)),
      complaint_rate: rate(totals.complained, Math.max(totals.delivered, 1)),
    },
    series: [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    contact_status,
    recent_problems,
    alerts,
  };
}
