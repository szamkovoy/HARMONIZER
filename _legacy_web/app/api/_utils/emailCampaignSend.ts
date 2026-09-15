import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStringRecord } from "./contentLocaleFallback";
import {
  activityMs,
  nextMskHour,
  parseAudienceCap,
  parseWarmupPlan,
  SUCCESS_OR_ACCEPTED_STATUSES,
  TERMINAL_SEND_STATUSES,
  waveSizeAt,
  type WarmupPlan,
} from "./emailCampaignWarmup";
import { resolveExactEmailCopy, type EmailCopySource } from "./emailCopy";
import {
  newEmailTrackId,
  prepareTrackedMarketingEmailHtml,
  registerEmailTrackKey,
} from "./emailFirstPartyTracking";
import {
  fetchAllPostgrestRows,
  parseEmailSegmentQuery,
  resolveCampaignRecipients,
  type CampaignRecipientRow,
} from "./emailSegment";
import { applyEmailPlaceholders } from "./emailTemplate";
import {
  buildSignedUnsubscribeUrl,
  generateUnsubscribeToken,
} from "./emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail, sleep } from "./marketingMail";

export const CAMPAIGN_SEND_DEADLINE_MS = 250_000;
export const CAMPAIGN_SEND_GAP_MS = 500;

type CampaignRow = {
  id: string;
  status: string;
  subject: string;
  html_body: string;
  subject_i18n: unknown;
  html_body_i18n: unknown;
  segment_query: unknown;
  warmup_plan: unknown;
  warmup_wave_index: number;
  next_wave_at: string | null;
  next_wave_size: number | null;
  audience_cap: number | null;
  send_halted_at: string | null;
  sent_count: number;
  error_count: number;
  skipped_locale_count: number;
  recipient_count: number;
  sent_at: string | null;
};

type SendRow = {
  id: string;
  contact_id: string;
  locale: string;
  status: string;
};

function copySourceFromCampaign(campaign: CampaignRow): EmailCopySource {
  return {
    subject: campaign.subject || "",
    htmlBody: campaign.html_body || "",
    subjectI18n: parseStringRecord(campaign.subject_i18n),
    htmlBodyI18n: parseStringRecord(campaign.html_body_i18n),
  };
}

async function loadCampaign(
  db: SupabaseClient,
  id: string,
): Promise<CampaignRow | null> {
  const { data, error } = await db
    .from("email_campaigns")
    .select(
      "id, status, subject, html_body, subject_i18n, html_body_i18n, segment_query, warmup_plan, warmup_wave_index, next_wave_at, next_wave_size, audience_cap, send_halted_at, sent_count, error_count, skipped_locale_count, recipient_count, sent_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as CampaignRow | null) ?? null;
}

async function loadSendStatuses(
  db: SupabaseClient,
  campaignId: string,
): Promise<Map<string, string>> {
  const rows = await fetchAllPostgrestRows<SendRow>(async (from, to) => {
    const { data, error } = await db
      .from("email_campaign_sends")
      .select("id, contact_id, locale, status")
      .eq("campaign_id", campaignId)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as SendRow[];
  });
  const map = new Map<string, string>();
  for (const row of rows) map.set(row.contact_id, row.status);
  return map;
}

async function loadActivityMs(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("users")
      .select("id, last_seen_at, getcourse_last_activity_at")
      .in("id", chunk);
    if (error) throw error;
    for (const u of data ?? []) {
      out.set(
        u.id as string,
        activityMs(
          u.last_seen_at as string | null,
          u.getcourse_last_activity_at as string | null,
        ),
      );
    }
  }
  return out;
}

function sortByActivity(
  rows: CampaignRecipientRow[],
  activityByUser: Map<string, number>,
): CampaignRecipientRow[] {
  return [...rows].sort((a, b) => {
    const am = a.contact.user_id
      ? (activityByUser.get(a.contact.user_id) ?? 0)
      : 0;
    const bm = b.contact.user_id
      ? (activityByUser.get(b.contact.user_id) ?? 0)
      : 0;
    if (bm !== am) return bm - am;
    return a.contact.id < b.contact.id ? -1 : 1;
  });
}

const SKIP_AGAIN = new Set<string>(TERMINAL_SEND_STATUSES);

export async function pickWaveRecipients(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
): Promise<{
  remaining: CampaignRecipientRow[];
  eligibleTotal: number;
  skippedLocale: number;
  noAudience: boolean;
  copyEmpty: boolean;
}> {
  const segment = parseEmailSegmentQuery(campaign.segment_query);
  const resolved = await resolveCampaignRecipients(db, segment, copySource);
  if (resolved.copyEmpty) {
    return {
      remaining: [],
      eligibleTotal: 0,
      skippedLocale: 0,
      noAudience: false,
      copyEmpty: true,
    };
  }
  if (resolved.no_audience) {
    return {
      remaining: [],
      eligibleTotal: 0,
      skippedLocale: 0,
      noAudience: true,
      copyEmpty: false,
    };
  }

  const userIds = resolved.eligible
    .map((r) => r.contact.user_id)
    .filter((id): id is string => Boolean(id));
  const activity = await loadActivityMs(db, userIds);
  let ranked = sortByActivity(resolved.eligible, activity);
  const cap = parseAudienceCap(campaign.audience_cap);
  if (cap != null) ranked = ranked.slice(0, cap);

  const statuses = await loadSendStatuses(db, campaign.id);
  const remaining = ranked.filter((row) => {
    const st = statuses.get(row.contact.id);
    if (!st) return true;
    if (st === "failed") return true;
    if (st === "queued") return false;
    return !SKIP_AGAIN.has(st);
  });

  return {
    remaining,
    eligibleTotal: ranked.length,
    skippedLocale: resolved.skippedLocaleCount,
    noAudience: false,
    copyEmpty: false,
  };
}

async function isHalted(db: SupabaseClient, campaignId: string): Promise<boolean> {
  const { data, error } = await db
    .from("email_campaigns")
    .select("send_halted_at")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.send_halted_at);
}

async function sendOneQueued(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
  sendRow: SendRow,
): Promise<"sent" | "failed" | "skipped"> {
  const { data: contact, error: contactError } = await db
    .from("email_contacts")
    .select(
      "id, email, locale, user_id, unsubscribe_token, marketing_status",
    )
    .eq("id", sendRow.contact_id)
    .maybeSingle();
  if (contactError) throw contactError;
  if (!contact || contact.marketing_status !== "active") {
    await db
      .from("email_campaign_sends")
      .update({ status: "skipped", error_detail: "inactive" })
      .eq("id", sendRow.id);
    return "skipped";
  }

  const exact = resolveExactEmailCopy(contact.locale || sendRow.locale, copySource);
  if (!exact) {
    await db
      .from("email_campaign_sends")
      .update({ status: "skipped", error_detail: "no_locale" })
      .eq("id", sendRow.id);
    return "skipped";
  }

  let token = contact.unsubscribe_token as string | null;
  if (!token) {
    token = generateUnsubscribeToken();
    await db
      .from("email_contacts")
      .update({ unsubscribe_token: token })
      .eq("id", contact.id);
  }

  let displayName = "";
  if (contact.user_id) {
    const { data: u } = await db
      .from("users")
      .select("display_name")
      .eq("id", contact.user_id)
      .maybeSingle();
    displayName = (u?.display_name ?? "").trim();
  }
  const name = displayName || String(contact.email).split("@")[0] || "";
  const unsubscribeUrl = buildSignedUnsubscribeUrl(token);
  const subject = applyEmailPlaceholders(exact.subject, { name, unsubscribeUrl });
  const bodyHtml = applyEmailPlaceholders(exact.htmlBody, { name, unsubscribeUrl });
  const trackId = newEmailTrackId();
  const html = await prepareTrackedMarketingEmailHtml({
    bodyHtml,
    unsubscribeUrl,
    previewText: subject,
    trackId,
  });

  const result = await sendMarketingEmail({
    to: contact.email as string,
    subject,
    html,
    text: htmlToPlaintext(html),
    unsubscribeUrl,
    locale: exact.locale,
    tags: [
      { name: "campaign_id", value: campaign.id },
      { name: "contact_id", value: contact.id as string },
    ],
  });

  if (result.ok) {
    await db
      .from("email_campaign_sends")
      .update({
        status: "sent",
        resend_id: result.resendId,
        locale: exact.locale,
        error_detail: null,
      })
      .eq("id", sendRow.id);
    await registerEmailTrackKey(db, {
      trackId,
      resendId: result.resendId,
      contactId: contact.id as string,
      campaignId: campaign.id,
      sendId: sendRow.id,
    });
    await db
      .from("email_contacts")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("id", contact.id);
    return "sent";
  }

  await db
    .from("email_campaign_sends")
    .update({
      status: "failed",
      error_detail: result.detail.slice(0, 500),
    })
    .eq("id", sendRow.id);
  return "failed";
}

async function enqueueWave(
  db: SupabaseClient,
  campaignId: string,
  slice: CampaignRecipientRow[],
): Promise<number> {
  let n = 0;
  for (const row of slice) {
    const { data: existing } = await db
      .from("email_campaign_sends")
      .select("status")
      .eq("campaign_id", campaignId)
      .eq("contact_id", row.contact.id)
      .maybeSingle();
    if (existing && SKIP_AGAIN.has(existing.status as string)) continue;
    const { error } = await db.from("email_campaign_sends").upsert(
      {
        campaign_id: campaignId,
        contact_id: row.contact.id,
        locale: row.locale,
        status: "queued",
        error_detail: null,
      },
      { onConflict: "campaign_id,contact_id" },
    );
    if (error) continue;
    n += 1;
  }
  return n;
}

async function loadQueued(
  db: SupabaseClient,
  campaignId: string,
): Promise<SendRow[]> {
  const { data, error } = await db
    .from("email_campaign_sends")
    .select("id, contact_id, locale, status")
    .eq("campaign_id", campaignId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(800);
  if (error) throw error;
  return (data ?? []) as SendRow[];
}

async function bumpCounts(
  db: SupabaseClient,
  campaignId: string,
  sentDelta: number,
  errorDelta: number,
): Promise<void> {
  if (!sentDelta && !errorDelta) return;
  const { data, error } = await db
    .from("email_campaigns")
    .select("sent_count, error_count")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  await db
    .from("email_campaigns")
    .update({
      sent_count: Number(data?.sent_count ?? 0) + sentDelta,
      error_count: Number(data?.error_count ?? 0) + errorDelta,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}

function scheduleAfterWave(
  campaign: CampaignRow,
  plan: WarmupPlan,
  now: Date,
): { next_wave_at: string; next_wave_size: number; warmup_wave_index: number } {
  const nextIndex = Number(campaign.warmup_wave_index ?? 0) + 1;
  return {
    warmup_wave_index: nextIndex,
    next_wave_size: waveSizeAt(nextIndex, plan),
    next_wave_at: nextMskHour(now, plan.hour_msk).toISOString(),
  };
}

async function finishWaveOrCampaign(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
): Promise<"paused" | "sent"> {
  const pick = await pickWaveRecipients(db, campaign, copySource);
  const plan = parseWarmupPlan(campaign.warmup_plan);
  const now = new Date();
  if (pick.remaining.length === 0) {
    await db
      .from("email_campaigns")
      .update({
        status: "sent",
        next_wave_at: null,
        next_wave_size: null,
        send_halted_at: null,
        send_lease_until: null,
        recipient_count: pick.eligibleTotal,
        skipped_locale_count: pick.skippedLocale,
        sent_at: campaign.sent_at ?? now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", campaign.id);
    return "sent";
  }
  const sched = scheduleAfterWave(campaign, plan, now);
  await db
    .from("email_campaigns")
    .update({
      status: "paused",
      send_halted_at: null,
      send_lease_until: null,
      recipient_count: pick.eligibleTotal,
      skipped_locale_count: pick.skippedLocale,
      sent_at: campaign.sent_at ?? now.toISOString(),
      ...sched,
      updated_at: now.toISOString(),
    })
    .eq("id", campaign.id);
  return "paused";
}

async function drainQueued(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
  deadline: number,
): Promise<{ sent: number; failed: number; halted: boolean; timedOut: boolean }> {
  let sent = 0;
  let failed = 0;
  let halted = false;
  let timedOut = false;
  while (Date.now() < deadline) {
    if (await isHalted(db, campaign.id)) {
      halted = true;
      break;
    }
    const queued = await loadQueued(db, campaign.id);
    if (queued.length === 0) break;
    const row = queued[0]!;
    const result = await sendOneQueued(db, campaign, copySource, row);
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
    await bumpCounts(
      db,
      campaign.id,
      result === "sent" ? 1 : 0,
      result === "failed" ? 1 : 0,
    );
    if (!campaign.sent_at && result === "sent") {
      campaign.sent_at = new Date().toISOString();
      await db
        .from("email_campaigns")
        .update({ sent_at: campaign.sent_at })
        .eq("id", campaign.id);
    }
    await sleep(CAMPAIGN_SEND_GAP_MS);
  }
  if (!halted && Date.now() >= deadline) {
    const leftover = await loadQueued(db, campaign.id);
    timedOut = leftover.length > 0;
  }
  return { sent, failed, halted, timedOut };
}

export type RunCampaignSendResult = {
  campaign_id: string;
  status: string;
  sent_count: number;
  error_count: number;
  queued_enqueued: number;
  halted: boolean;
  timed_out: boolean;
  detail?: string;
};

async function lockOrSkip(
  db: SupabaseClient,
  campaignId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("try_lock_email_campaign_send", {
    p_id: campaignId,
  });
  if (error) throw error;
  return data === true;
}

async function unlock(db: SupabaseClient, campaignId: string): Promise<void> {
  await db.rpc("unlock_email_campaign_send", { p_id: campaignId });
}

/**
 * Drain queued rows, optionally enqueue the next warmup wave first.
 * `startWave` is admin «отправить волну» / due cron.
 */
export async function runCampaignSend(
  db: SupabaseClient,
  campaignId: string,
  opts: { startWave: boolean; deadlineMs?: number },
): Promise<RunCampaignSendResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? CAMPAIGN_SEND_DEADLINE_MS);
  let campaign = await loadCampaign(db, campaignId);
  if (!campaign) {
    return {
      campaign_id: campaignId,
      status: "missing",
      sent_count: 0,
      error_count: 0,
      queued_enqueued: 0,
      halted: false,
      timed_out: false,
      detail: "Кампания не найдена",
    };
  }
  if (campaign.status === "sent") {
    return {
      campaign_id: campaignId,
      status: "sent",
      sent_count: campaign.sent_count,
      error_count: campaign.error_count,
      queued_enqueued: 0,
      halted: false,
      timed_out: false,
      detail: "Кампания уже завершена",
    };
  }

  if (opts.startWave) {
    await db
      .from("email_campaigns")
      .update({
        send_halted_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
  }

  const locked = await lockOrSkip(db, campaignId);
  if (!locked) {
    return {
      campaign_id: campaignId,
      status: campaign.status,
      sent_count: campaign.sent_count,
      error_count: campaign.error_count,
      queued_enqueued: 0,
      halted: Boolean(campaign.send_halted_at),
      timed_out: false,
      detail: "Уже идёт другой воркер отправки",
    };
  }

  let enqueued = 0;
  try {
    campaign = (await loadCampaign(db, campaignId)) ?? campaign;
    if (campaign.send_halted_at) {
      await db
        .from("email_campaigns")
        .update({ status: "paused", send_lease_until: null })
        .eq("id", campaignId);
      return {
        campaign_id: campaignId,
        status: "paused",
        sent_count: campaign.sent_count,
        error_count: campaign.error_count,
        queued_enqueued: 0,
        halted: true,
        timed_out: false,
      };
    }

    const copySource = copySourceFromCampaign(campaign);
    const queuedNow = await loadQueued(db, campaignId);

    if (opts.startWave && queuedNow.length === 0) {
      await db.rpc("sync_email_contacts_from_users");
      const pick = await pickWaveRecipients(db, campaign, copySource);
      if (pick.copyEmpty) {
        await db
          .from("email_campaigns")
          .update({
            status: "failed",
            send_lease_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);
        return {
          campaign_id: campaignId,
          status: "failed",
          sent_count: 0,
          error_count: 0,
          queued_enqueued: 0,
          halted: false,
          timed_out: false,
          detail: "Письмо пустое — заполните текст и переводы.",
        };
      }
      if (pick.noAudience) {
        await db
          .from("email_campaigns")
          .update({
            status: "failed",
            send_lease_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);
        return {
          campaign_id: campaignId,
          status: "failed",
          sent_count: 0,
          error_count: 0,
          queued_enqueued: 0,
          halted: false,
          timed_out: false,
          detail: "Сегмент без аудитории.",
        };
      }
      const plan = parseWarmupPlan(campaign.warmup_plan);
      const size =
        campaign.next_wave_size && campaign.next_wave_size > 0
          ? campaign.next_wave_size
          : waveSizeAt(campaign.warmup_wave_index ?? 0, plan);
      const slice = pick.remaining.slice(0, size);
      if (slice.length === 0) {
        const fin = await finishWaveOrCampaign(db, campaign, copySource);
        return {
          campaign_id: campaignId,
          status: fin,
          sent_count: campaign.sent_count,
          error_count: campaign.error_count,
          queued_enqueued: 0,
          halted: false,
          timed_out: false,
        };
      }
      enqueued = await enqueueWave(db, campaignId, slice);
      await db
        .from("email_campaigns")
        .update({
          status: "sending",
          send_halted_at: null,
          recipient_count: pick.eligibleTotal,
          skipped_locale_count: pick.skippedLocale,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    } else {
      await db
        .from("email_campaigns")
        .update({
          status: "sending",
          send_halted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
    }

    campaign = (await loadCampaign(db, campaignId)) ?? campaign;
    const drain = await drainQueued(db, campaign, copySource, deadline);

    if (drain.halted) {
      await db
        .from("email_campaigns")
        .update({
          status: "paused",
          send_lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      return {
        campaign_id: campaignId,
        status: "paused",
        sent_count: campaign.sent_count + drain.sent,
        error_count: campaign.error_count + drain.failed,
        queued_enqueued: enqueued,
        halted: true,
        timed_out: false,
      };
    }

    const leftover = await loadQueued(db, campaignId);
    if (leftover.length > 0 || drain.timedOut) {
      await db
        .from("email_campaigns")
        .update({
          status: "sending",
          send_lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      return {
        campaign_id: campaignId,
        status: "sending",
        sent_count: campaign.sent_count + drain.sent,
        error_count: campaign.error_count + drain.failed,
        queued_enqueued: enqueued,
        halted: false,
        timed_out: true,
      };
    }

    campaign = (await loadCampaign(db, campaignId)) ?? campaign;
    const fin = await finishWaveOrCampaign(db, campaign, copySource);
    const latest = await loadCampaign(db, campaignId);
    return {
      campaign_id: campaignId,
      status: fin,
      sent_count: latest?.sent_count ?? campaign.sent_count + drain.sent,
      error_count: latest?.error_count ?? campaign.error_count + drain.failed,
      queued_enqueued: enqueued,
      halted: false,
      timed_out: false,
    };
  } finally {
    await unlock(db, campaignId).catch(() => undefined);
  }
}

export async function haltCampaignSend(
  db: SupabaseClient,
  campaignId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const campaign = await loadCampaign(db, campaignId);
  if (!campaign) return { ok: false, error: "Кампания не найдена" };
  if (campaign.status === "sent") {
    return { ok: false, error: "Кампания уже завершена" };
  }
  await db
    .from("email_campaigns")
    .update({
      send_halted_at: new Date().toISOString(),
      status: campaign.status === "draft" ? "draft" : "paused",
      next_wave_at: null,
      send_lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
  return { ok: true, status: "paused" };
}

export async function runDueCampaignSends(
  db: SupabaseClient,
): Promise<{ ran: RunCampaignSendResult[] }> {
  const nowIso = new Date().toISOString();
  const { data: sending, error: sendingError } = await db
    .from("email_campaigns")
    .select("id")
    .eq("status", "sending")
    .is("send_halted_at", null)
    .limit(5);
  if (sendingError) throw sendingError;
  const { data: due, error: dueError } = await db
    .from("email_campaigns")
    .select("id")
    .eq("status", "paused")
    .is("send_halted_at", null)
    .lte("next_wave_at", nowIso)
    .limit(5);
  if (dueError) throw dueError;

  const ids = [...new Set([
    ...(sending ?? []).map((r) => r.id as string),
    ...(due ?? []).map((r) => r.id as string),
  ])];
  const ran: RunCampaignSendResult[] = [];
  for (const id of ids) {
    const row = await loadCampaign(db, id);
    if (!row) continue;
    const startWave = row.status === "paused";
    ran.push(await runCampaignSend(db, id, { startWave }));
  }
  return { ran };
}

export async function campaignSendProgress(
  db: SupabaseClient,
  campaign: {
    id: string;
    status: string;
    warmup_plan: unknown;
    warmup_wave_index: number | null;
    next_wave_at: string | null;
    next_wave_size: number | null;
    audience_cap: number | null;
    send_halted_at: string | null;
    sent_count: number;
    recipient_count: number;
  },
): Promise<{
  queued: number;
  accepted: number;
  failed: number;
  remaining_estimate: number | null;
  next_wave_size: number;
  next_wave_at: string | null;
  halted: boolean;
}> {
  const { count: queued } = await db
    .from("email_campaign_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "queued");
  const { count: accepted } = await db
    .from("email_campaign_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .in("status", [...SUCCESS_OR_ACCEPTED_STATUSES]);
  const { count: failed } = await db
    .from("email_campaign_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .eq("status", "failed");
  const plan = parseWarmupPlan(campaign.warmup_plan);
  const nextSize =
    campaign.next_wave_size && campaign.next_wave_size > 0
      ? campaign.next_wave_size
      : waveSizeAt(campaign.warmup_wave_index ?? 0, plan);
  const remaining =
    campaign.recipient_count > 0
      ? Math.max(0, campaign.recipient_count - (accepted ?? 0))
      : null;
  return {
    queued: queued ?? 0,
    accepted: accepted ?? 0,
    failed: failed ?? 0,
    remaining_estimate: remaining,
    next_wave_size: nextSize,
    next_wave_at: campaign.next_wave_at,
    halted: Boolean(campaign.send_halted_at),
  };
}
