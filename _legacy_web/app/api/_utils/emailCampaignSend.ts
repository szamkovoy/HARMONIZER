import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStringRecord } from "./contentLocaleFallback";
import {
  activityMs,
  currentWaveNeed,
  nextMskHour,
  parseAudienceCap,
  parseWarmupPlan,
  serializeWarmupPlan,
  SUCCESS_OR_ACCEPTED_STATUSES,
  waveSizeAt,
  type WarmupPlan,
} from "./emailCampaignWarmup";
import { resolveCampaignEmailCopy, type EmailCopySource } from "./emailCopy";
import { prepareTrackedMarketingEmailHtml } from "./emailFirstPartyTracking";
import {
  fetchAllPostgrestRows,
  parseEmailSegmentQuery,
  resolveCampaignRecipients,
  type CampaignRecipientRow,
} from "./emailSegment";
import { applyEmailPlaceholders } from "./emailTemplate";
import { buildSignedUnsubscribeUrl } from "./emailUnsubscribe";
import {
  htmlToPlaintext,
  MARKETING_BATCH_MAX,
  sendMarketingEmailBatch,
  sleep,
  type MarketingBatchItem,
} from "./marketingMail";
import {
  applyCampaignAccessWindow,
  isLongTermMaster,
  revertDueMasterGrants,
  type MailUserAccess,
} from "./emailCampaignAccessWindow";

export const CAMPAIGN_SEND_DEADLINE_MS = 250_000;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

/** Letters per provider request (Resend batch max is 100). */
export const CAMPAIGN_BATCH_SIZE = envInt("CAMPAIGN_BATCH_SIZE", 100, 1, MARKETING_BATCH_MAX);
/**
 * Pause between batches inside one run. With the 250 s run and the 5-minute
 * cron that is two batches per tick → ~200 letters / 5 min → 14 000 in ~6 h.
 * Nano compute stalled after ~4 h at the old continuous 23 letters/min.
 */
export const CAMPAIGN_BATCH_GAP_MS = envInt("CAMPAIGN_BATCH_GAP_MS", 120_000, 0, 240_000);
/** A trivial query slower than this means the database is struggling: skip the tick. */
export const CAMPAIGN_DB_SLOW_MS = envInt("CAMPAIGN_DB_SLOW_MS", 1_500, 200, 20_000);
/** Consecutive slow ticks before the campaign pauses itself. */
export const CAMPAIGN_SLOW_STRIKES_TO_HALT = 3;
/** A 'sending' batch older than this belongs to a dead worker and is retried with the same key. */
export const CAMPAIGN_STALE_BATCH_MINUTES = 15;

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
  send_slow_strikes: number | null;
  send_halt_reason: string | null;
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
      "id, status, subject, html_body, subject_i18n, html_body_i18n, segment_query, warmup_plan, warmup_wave_index, next_wave_at, next_wave_size, audience_cap, send_halted_at, send_slow_strikes, send_halt_reason, sent_count, error_count, skipped_locale_count, recipient_count, sent_at",
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
  const plan = parseWarmupPlan(campaign.warmup_plan);
  if (plan.exclude_long_term_master || (plan.access_window_hours ?? 0) > 0) {
    const access = await loadMailAccess(db, userIds);
    const nowMs = Date.now();
    ranked = ranked.filter((row) => {
      const user = row.contact.user_id ? access.get(row.contact.user_id) : undefined;
      if (!user) return true;
      return !isLongTermMaster(user, nowMs);
    });
  }
  const cap = parseAudienceCap(campaign.audience_cap);
  if (cap != null) ranked = ranked.slice(0, cap);

  const statuses = await loadSendStatuses(db, campaign.id);
  const remaining = ranked.filter((row) => {
    const st = statuses.get(row.contact.id);
    // Any existing row (incl. failed) is done for wave picking: enqueueWave ignores
    // duplicates, so counting it as remaining re-resolves the segment every tick forever.
    return !st;
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

type ClaimedRow = {
  send_id: string;
  contact_id: string;
  send_locale: string;
  batch_key: string;
  email: string;
  contact_locale: string | null;
  unsubscribe_token: string;
  marketing_status: string;
  display_name: string | null;
};

type BatchResultRow = {
  send_id: string;
  status: "sent" | "failed" | "skipped" | "queued";
  resend_id?: string | null;
  locale?: string | null;
  error_detail?: string | null;
  track_id?: string | null;
};

/**
 * Trivial read timed against the same PostgREST path the batch will use.
 * Slow answer → the project is struggling → this tick sends nothing.
 */
async function measureDbLatencyMs(db: SupabaseClient): Promise<number | null> {
  const started = Date.now();
  const { error } = await db.from("email_campaigns").select("id").limit(1);
  if (error) return null;
  return Date.now() - started;
}

async function claimBatch(
  db: SupabaseClient,
  campaignId: string,
): Promise<ClaimedRow[]> {
  const { data, error } = await db.rpc("claim_email_campaign_batch", {
    p_campaign_id: campaignId,
    p_limit: CAMPAIGN_BATCH_SIZE,
    p_stale_minutes: CAMPAIGN_STALE_BATCH_MINUTES,
  });
  if (error) throw error;
  return (data ?? []) as ClaimedRow[];
}

async function finalizeBatch(
  db: SupabaseClient,
  campaignId: string,
  results: BatchResultRow[],
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data, error } = await db.rpc("finalize_email_campaign_batch", {
    p_campaign_id: campaignId,
    p_results: results,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

/**
 * One batch: claim ≤100 rows (1 RPC), one provider request, finalize (1 RPC).
 * `rateLimited` → rows go back to queued; `unknown` → rows stay 'sending' and
 * are retried with the same idempotency key after CAMPAIGN_STALE_BATCH_MINUTES.
 */
async function sendOneBatch(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  rateLimited: boolean;
  unknown: boolean;
}> {
  const rows = await claimBatch(db, campaign.id);
  if (rows.length === 0) {
    return { claimed: 0, sent: 0, failed: 0, rateLimited: false, unknown: false };
  }
  const batchKey = rows[0]!.batch_key;

  const results: BatchResultRow[] = [];
  const items: MarketingBatchItem[] = [];
  const itemRow: { row: ClaimedRow; locale: string; trackId: string }[] = [];

  for (const row of rows) {
    if (row.marketing_status !== "active") {
      results.push({ send_id: row.send_id, status: "skipped", error_detail: "inactive" });
      continue;
    }
    const exact = resolveCampaignEmailCopy(row.contact_locale || row.send_locale, copySource);
    if (!exact) {
      results.push({ send_id: row.send_id, status: "skipped", error_detail: "no_locale" });
      continue;
    }
    const name = (row.display_name ?? "").trim() || row.email.split("@")[0] || "";
    const unsubscribeUrl = buildSignedUnsubscribeUrl(row.unsubscribe_token);
    const subject = applyEmailPlaceholders(exact.subject, { name, unsubscribeUrl });
    const bodyHtml = applyEmailPlaceholders(exact.htmlBody, { name, unsubscribeUrl });
    // Stable across stale-batch retries so Resend Idempotency-Key sees the same body.
    const trackId = row.send_id;
    const html = await prepareTrackedMarketingEmailHtml({
      bodyHtml,
      unsubscribeUrl,
      previewText: subject,
      trackId,
    });
    items.push({
      key: row.send_id,
      to: row.email,
      subject,
      html,
      text: htmlToPlaintext(html),
      unsubscribeUrl,
      locale: exact.locale,
    });
    itemRow.push({ row, locale: exact.locale, trackId });
  }

  if (items.length > 0) {
    const batch = await sendMarketingEmailBatch(items, { idempotencyKey: batchKey });
    if (!batch.ok && batch.sent === "unknown") {
      console.error("[email-campaign-send] batch outcome unknown", campaign.id, batchKey, batch.detail);
      // Leave rows in 'sending'; claim_email_campaign_batch retries them with the same key.
      if (results.length) await finalizeBatch(db, campaign.id, results);
      return { claimed: rows.length, sent: 0, failed: 0, rateLimited: false, unknown: true };
    }
    if (
      !batch.ok &&
      /invalid_idempotent_request|idempotency key has been used/i.test(batch.detail)
    ) {
      // Original POST already reached Resend; a retry with a different pixel URL
      // cannot fetch the ids. Count as sent so we never double-send this batch.
      console.warn("[email-campaign-send] idempotent replay", campaign.id, batchKey);
      for (const { row, locale, trackId } of itemRow) {
        results.push({
          send_id: row.send_id,
          status: "sent",
          locale,
          track_id: trackId,
          error_detail: "resend_idempotent_replay",
        });
      }
      const fin = await finalizeBatch(db, campaign.id, results);
      return { claimed: rows.length, sent: fin.sent, failed: fin.failed, rateLimited: false, unknown: false };
    }
    if (!batch.ok) {
      for (const { row } of itemRow) {
        results.push({
          send_id: row.send_id,
          status: batch.rateLimited ? "queued" : "failed",
          error_detail: batch.detail,
        });
      }
      const fin = await finalizeBatch(db, campaign.id, results);
      return { claimed: rows.length, sent: 0, failed: fin.failed, rateLimited: batch.rateLimited, unknown: false };
    }
    batch.results.forEach((r, i) => {
      const { row, locale, trackId } = itemRow[i]!;
      if (r.ok) {
        results.push({ send_id: row.send_id, status: "sent", resend_id: r.resendId, locale, track_id: trackId });
      } else {
        results.push({ send_id: row.send_id, status: "failed", locale, error_detail: r.detail });
      }
    });
  }

  const fin = await finalizeBatch(db, campaign.id, results);
  return { claimed: rows.length, sent: fin.sent, failed: fin.failed, rateLimited: false, unknown: false };
}

async function enqueueWave(
  db: SupabaseClient,
  campaignId: string,
  slice: CampaignRecipientRow[],
): Promise<number> {
  const CHUNK = 200;
  let n = 0;
  for (let i = 0; i < slice.length; i += CHUNK) {
    const chunk = slice.slice(i, i + CHUNK);
    const rows = chunk.map((row) => ({
      campaign_id: campaignId,
      contact_id: row.contact.id,
      locale: row.locale,
      status: "queued" as const,
      error_detail: null,
    }));
    const { data, error } = await db
      .from("email_campaign_sends")
      .upsert(rows, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    n += data?.length ?? 0;
  }
  return n;
}

/** Rows still to go: queued + claimed-but-unfinished. One HEAD count, no payload. */
async function countPending(db: SupabaseClient, campaignId: string): Promise<number> {
  const { count, error } = await db
    .from("email_campaign_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "sending"]);
  if (error) throw error;
  return count ?? 0;
}

function scheduleAfterWave(
  campaign: CampaignRow,
  plan: WarmupPlan,
  now: Date,
): {
  next_wave_at: string;
  next_wave_size: number;
  warmup_wave_index: number;
  consumedPin: boolean;
} {
  const nextIndex = Number(campaign.warmup_wave_index ?? 0) + 1;
  const pinnedMs = plan.pinned_next_wave_at ? Date.parse(plan.pinned_next_wave_at) : NaN;
  const consumedPin = Number.isFinite(pinnedMs);
  const nextAt = consumedPin
    ? pinnedMs > now.getTime()
      ? new Date(pinnedMs)
      : now
    : nextMskHour(now, plan.hour_msk);
  return {
    warmup_wave_index: nextIndex,
    next_wave_size: waveSizeAt(nextIndex, plan),
    next_wave_at: nextAt.toISOString(),
    consumedPin,
  };
}

async function loadMailAccess(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, MailUserAccess>> {
  const out = new Map<string, MailUserAccess>();
  const CHUNK = 200;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("users")
      .select(
        "id, membership_tier, membership_expires_at, trial_expires_at, app_first_open_at, last_seen_at, onboarded_at",
      )
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      out.set(row.id as string, {
        membership_tier: (row.membership_tier as string | null) ?? null,
        membership_expires_at: (row.membership_expires_at as string | null) ?? null,
        trial_expires_at: (row.trial_expires_at as string | null) ?? null,
        app_first_open_at: (row.app_first_open_at as string | null) ?? null,
        last_seen_at: (row.last_seen_at as string | null) ?? null,
        onboarded_at: (row.onboarded_at as string | null) ?? null,
      });
    }
  }
  return out;
}

async function finishWaveOrCampaign(
  db: SupabaseClient,
  campaign: CampaignRow,
  copySource: EmailCopySource,
): Promise<"paused" | "sent"> {
  const pick = await pickWaveRecipients(db, campaign, copySource);
  const plan = parseWarmupPlan(campaign.warmup_plan);
  const now = new Date();
  const latest = (await loadCampaign(db, campaign.id)) ?? campaign;
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
        sent_at: latest.sent_at ?? now.toISOString(),
        warmup_plan: serializeWarmupPlan({
          ...plan,
          wave_base_sent: latest.sent_count,
        }),
        updated_at: now.toISOString(),
      })
      .eq("id", campaign.id);
    return "sent";
  }
  const sched = scheduleAfterWave(latest, plan, now);
  const { consumedPin, ...waveSched } = sched;
  await db
    .from("email_campaigns")
    .update({
      status: "paused",
      send_halted_at: null,
      send_lease_until: null,
      recipient_count: pick.eligibleTotal,
      skipped_locale_count: pick.skippedLocale,
      sent_at: latest.sent_at ?? now.toISOString(),
      warmup_plan: serializeWarmupPlan({
        ...plan,
        wave_base_sent: latest.sent_count,
        pinned_next_wave_at: consumedPin ? undefined : plan.pinned_next_wave_at,
      }),
      ...waveSched,
      updated_at: now.toISOString(),
    })
    .eq("id", campaign.id);
  return "paused";
}

/**
 * Batches until the deadline. Pauses CAMPAIGN_BATCH_GAP_MS between batches so
 * one 250 s run sends about two batches; cron continues 5 minutes later.
 */
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
  let first = true;
  while (Date.now() < deadline) {
    if (!first) {
      // Gap belongs before the next batch; do not start one we cannot finish.
      if (Date.now() + CAMPAIGN_BATCH_GAP_MS + 30_000 >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(CAMPAIGN_BATCH_GAP_MS);
    }
    first = false;
    if (await isHalted(db, campaign.id)) {
      halted = true;
      break;
    }
    const batch = await sendOneBatch(db, campaign, copySource);
    sent += batch.sent;
    failed += batch.failed;
    if (batch.claimed === 0) break;
    if (batch.rateLimited || batch.unknown) {
      timedOut = true;
      break;
    }
  }
  if (!halted && !timedOut && Date.now() >= deadline) {
    timedOut = (await countPending(db, campaign.id)) > 0;
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
    const queuedNow = await countPending(db, campaignId);
    const plan = parseWarmupPlan(campaign.warmup_plan);
    const progress = currentWaveNeed({
      sentCount: campaign.sent_count,
      queuedCount: queuedNow,
      nextWaveSize: campaign.next_wave_size,
      waveIndex: campaign.warmup_wave_index ?? 0,
      plan,
    });
    const shouldFill = progress.need > 0 && (opts.startWave || queuedNow === 0);
    let exhausted = false;

    if (shouldFill) {
      if (opts.startWave && queuedNow === 0 && progress.acceptedThisWave === 0) {
        await db.rpc("sync_email_contacts_from_users");
      }
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
      exhausted = pick.remaining.length === 0;
      let wavePlan = plan;
      let waveSize = campaign.next_wave_size;
      if (
        wavePlan.split_half &&
        (campaign.warmup_wave_index ?? 0) === 0 &&
        !(waveSize && waveSize > 0)
      ) {
        const half = Math.ceil(pick.remaining.length / 2);
        const rest = Math.max(0, pick.remaining.length - half);
        wavePlan = {
          ...wavePlan,
          sizes: [Math.max(half, 1), Math.max(rest, 1)],
          repeat_last: false,
        };
        waveSize = half;
        await db
          .from("email_campaigns")
          .update({
            next_wave_size: half,
            warmup_plan: serializeWarmupPlan(wavePlan),
            updated_at: new Date().toISOString(),
          })
          .eq("id", campaignId);
      }
      const fillNeed = currentWaveNeed({
        sentCount: campaign.sent_count,
        queuedCount: queuedNow,
        nextWaveSize: waveSize,
        waveIndex: campaign.warmup_wave_index ?? 0,
        plan: wavePlan,
      }).need;
      const slice = pick.remaining.slice(0, fillNeed);
      if (slice.length === 0 && queuedNow === 0) {
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
      if (slice.length > 0) {
        const windowHours = wavePlan.access_window_hours ?? 0;
        if (windowHours > 0) {
          await applyCampaignAccessWindow(
            db,
            campaignId,
            slice
              .map((row) => row.contact.user_id)
              .filter((id): id is string => Boolean(id)),
            windowHours,
          );
        }
        enqueued = await enqueueWave(db, campaignId, slice);
        if (enqueued === 0 && queuedNow === 0) exhausted = true;
      }
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

    // Health brake: a slow trivial query means Nano is already struggling.
    // Skip this tick instead of adding a batch; three slow ticks in a row pause
    // the campaign with a visible reason (admin «Отправить» resumes it).
    const latencyMs = await measureDbLatencyMs(db);
    if (latencyMs === null || latencyMs > CAMPAIGN_DB_SLOW_MS) {
      const strikes = (campaign.send_slow_strikes ?? 0) + 1;
      const halt = strikes >= CAMPAIGN_SLOW_STRIKES_TO_HALT;
      console.warn(
        "[email-campaign-send] db slow",
        campaignId,
        latencyMs === null ? "probe failed" : `${latencyMs} ms`,
        `strike ${strikes}/${CAMPAIGN_SLOW_STRIKES_TO_HALT}`,
      );
      await db
        .from("email_campaigns")
        .update({
          send_slow_strikes: strikes,
          ...(halt
            ? {
                status: "paused",
                send_halted_at: new Date().toISOString(),
                send_halt_reason: `База отвечала медленно ${strikes} раза подряд (${
                  latencyMs === null ? "нет ответа" : `${latencyMs} мс`
                }). Нажмите «Отправить», чтобы продолжить.`,
              }
            : {}),
          send_lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignId);
      return {
        campaign_id: campaignId,
        status: halt ? "paused" : "sending",
        sent_count: campaign.sent_count,
        error_count: campaign.error_count,
        queued_enqueued: enqueued,
        halted: halt,
        timed_out: !halt,
        detail: halt ? "Остановлено: база перегружена" : "Пропуск: база отвечает медленно",
      };
    }
    if (campaign.send_slow_strikes || campaign.send_halt_reason) {
      await db
        .from("email_campaigns")
        .update({ send_slow_strikes: 0, send_halt_reason: null })
        .eq("id", campaignId);
    }

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

    const leftover = await countPending(db, campaignId);
    campaign = (await loadCampaign(db, campaignId)) ?? campaign;
    const after = currentWaveNeed({
      sentCount: campaign.sent_count,
      queuedCount: leftover,
      nextWaveSize: campaign.next_wave_size,
      waveIndex: campaign.warmup_wave_index ?? 0,
      plan: parseWarmupPlan(campaign.warmup_plan),
    });
    if (leftover > 0 || drain.timedOut || (!exhausted && after.need > 0)) {
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
        sent_count: campaign.sent_count,
        error_count: campaign.error_count,
        queued_enqueued: enqueued,
        halted: false,
        timed_out: true,
      };
    }

    const fin = await finishWaveOrCampaign(db, campaign, copySource);
    const latest = await loadCampaign(db, campaignId);
    return {
      campaign_id: campaignId,
      status: fin,
      sent_count: latest?.sent_count ?? campaign.sent_count,
      error_count: latest?.error_count ?? campaign.error_count,
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
  await revertDueMasterGrants(db);
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
    .in("status", ["queued", "sending"]);
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
