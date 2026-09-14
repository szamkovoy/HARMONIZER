/**
 * Automation drip runner (B2 + C1/C2).
 * Enrolls by trigger; sends due steps via marketingMail.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { parseStringRecord } from "./contentLocaleFallback";
import { resolveExactEmailCopy } from "./emailCopy";
import {
  newEmailTrackId,
  prepareTrackedMarketingEmailHtml,
  registerEmailTrackKey,
} from "./emailFirstPartyTracking";
import { applyEmailPlaceholders } from "./emailTemplate";
import {
  buildSignedUnsubscribeUrl,
  generateUnsubscribeToken,
} from "./emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail, sleep } from "./marketingMail";

const C1_DAYS = 3;
const C2_DAYS = 14;
const PAID_TIERS = new Set(["oracle", "master", "practitioner"]);
export const SEND_RETRY_DELAY_MS = 5 * 60_000;
export const SEND_MAX_ATTEMPTS = 5;

export function isAfterActivation(
  firedAtMs: number,
  activatedAt: string | null | undefined,
): boolean {
  if (!activatedAt) return false;
  const activatedMs = new Date(activatedAt).getTime();
  return Number.isFinite(firedAtMs) && Number.isFinite(activatedMs) && firedAtMs >= activatedMs;
}

/** Remaining wait until the next letter is frozen for the pause duration. */
export function shiftedNextStepIso(
  nextStepAtIso: string,
  pausedAtIso: string,
  resumedAtMs: number,
): string {
  const nextMs = Date.parse(nextStepAtIso);
  const pausedMs = Date.parse(pausedAtIso);
  if (!Number.isFinite(nextMs) || !Number.isFinite(pausedMs)) return nextStepAtIso;
  const pauseMs = Math.max(0, resumedAtMs - pausedMs);
  return new Date(nextMs + pauseMs).toISOString();
}

export async function shiftEnrollmentsAfterPause(
  db: SupabaseClient,
  automationId: string,
  pausedAt: string,
  resumedAt: Date,
): Promise<number> {
  const { data, error } = await db.rpc("shift_email_automation_enrollments_after_pause", {
    p_automation_id: automationId,
    p_paused_at: pausedAt,
    p_resumed_at: resumedAt.toISOString(),
  });
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

type Automation = {
  id: string;
  key: string;
  trigger_type: string;
  is_active: boolean;
  activated_at: string | null;
};

type Step = {
  id: string;
  automation_id: string;
  position: number;
  delay_hours: number;
  subject: string;
  subject_i18n: Record<string, string> | null;
  html_body: string;
  html_body_i18n: Record<string, string> | null;
  blocks_i18n?: unknown;
};

type Enrollment = {
  id: string;
  automation_id: string;
  contact_id: string;
  current_position: number;
  next_step_at: string | null;
  status: string;
  cycle_key: string | null;
};

function isCurrentlyPaid(u: {
  membership_tier: string;
  membership_expires_at: string | null;
}): boolean {
  if (!PAID_TIERS.has(u.membership_tier)) return false;
  if (!u.membership_expires_at) return true;
  return new Date(u.membership_expires_at).getTime() > Date.now();
}

function nameFromContact(
  displayName: string | null | undefined,
  email: string,
): string {
  const n = (displayName ?? "").trim();
  if (n) return n;
  const local = email.split("@")[0]?.trim();
  return local || "";
}

async function loadActiveAutomation(
  db: SupabaseClient,
  triggerType: string,
): Promise<Automation | null> {
  const { data, error } = await db
    .from("email_automations")
    .select("id, key, trigger_type, is_active, activated_at")
    .eq("trigger_type", triggerType)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Automation | null;
}

async function firstStepDelayHours(
  db: SupabaseClient,
  automationId: string,
): Promise<number | null> {
  const { data } = await db
    .from("email_automation_steps")
    .select("delay_hours")
    .eq("automation_id", automationId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return Math.max(0, Number(data.delay_hours) || 0);
}

async function hasActiveEnrollment(
  db: SupabaseClient,
  automationId: string,
  contactId: string,
): Promise<boolean> {
  const { data } = await db
    .from("email_automation_enrollments")
    .select("id")
    .eq("automation_id", automationId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function lastCompletedEnrollment(
  db: SupabaseClient,
  automationId: string,
  contactId: string,
): Promise<{ id: string; updated_at: string; cycle_key: string | null } | null> {
  const { data } = await db
    .from("email_automation_enrollments")
    .select("id, updated_at, cycle_key")
    .eq("automation_id", automationId)
    .eq("contact_id", contactId)
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function insertEnrollment(
  db: SupabaseClient,
  row: {
    automation_id: string;
    contact_id: string;
    next_step_at: string;
    cycle_key?: string | null;
  },
): Promise<string | null> {
  const { data, error } = await db
    .from("email_automation_enrollments")
    .insert({
      automation_id: row.automation_id,
      contact_id: row.contact_id,
      current_position: 0,
      next_step_at: row.next_step_at,
      status: "active",
      cycle_key: row.cycle_key ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // concurrent active unique
    if (error.code === "23505") return null;
    throw error;
  }
  return data?.id ?? null;
}

type WelcomeCandidate = {
  user_id: string;
  onboarded_at: string;
  skip_email_automations: boolean;
};

async function loadWelcomeCandidates(
  db: SupabaseClient,
  automationId: string,
  since: string,
  userId?: string,
): Promise<WelcomeCandidate[]> {
  // Read-only RPC (STABLE) → GET, so the Supabase gateway-timeout retry applies.
  // GET serializes `null` as the string "null" → omit p_user_id (SQL default null) instead.
  const { data, error } = await db.rpc(
    "email_automation_welcome_candidates",
    {
      p_automation_id: automationId,
      p_since: since,
      ...(userId ? { p_user_id: userId } : {}),
    },
    { get: true },
  );
  if (error) throw error;
  return (data ?? []) as WelcomeCandidate[];
}

async function upsertContactForUser(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db.rpc("sync_email_contact_for_user", { p_user_id: userId });
  if (error) throw error;
}

async function enrollWelcomeRows(
  db: SupabaseClient,
  automation: Automation,
  rows: WelcomeCandidate[],
): Promise<{ enrolled: number; enrollmentIds: string[] }> {
  const delayH = await firstStepDelayHours(db, automation.id);
  if (delayH == null) return { enrolled: 0, enrollmentIds: [] };

  let enrolled = 0;
  const enrollmentIds: string[] = [];

  for (const row of rows) {
    if (row.skip_email_automations) continue;
    if (!isAfterActivation(new Date(row.onboarded_at).getTime(), automation.activated_at)) {
      continue;
    }
    await upsertContactForUser(db, row.user_id);
    const { data: contact } = await db
      .from("email_contacts")
      .select("id, marketing_status")
      .eq("user_id", row.user_id)
      .eq("marketing_status", "active")
      .maybeSingle();
    if (!contact) continue;
    if (await hasActiveEnrollment(db, automation.id, contact.id)) continue;
    const nextAt = new Date(Date.now() + delayH * 3600_000).toISOString();
    const enrollmentId = await insertEnrollment(db, {
      automation_id: automation.id,
      contact_id: contact.id,
      next_step_at: nextAt,
      cycle_key: row.onboarded_at,
    });
    if (!enrollmentId) continue;
    enrolled += 1;
    enrollmentIds.push(enrollmentId);
  }
  return { enrolled, enrollmentIds };
}

/**
 * Welcome after Harmonizer onboarding (`users.onboarded_at`), not bare OTP.
 * Only events at/after `activated_at` (deactivate = pause; reactivate does not backfill).
 */
export async function enrollAccountRegistered(db: SupabaseClient): Promise<number> {
  const automation = await loadActiveAutomation(db, "account_registered");
  if (!automation?.activated_at) return 0;
  const rows = await loadWelcomeCandidates(db, automation.id, automation.activated_at);
  const result = await enrollWelcomeRows(db, automation, rows);
  return result.enrolled;
}

/** Immediate welcome enroll + due send for one user (DB trigger / catch-up). */
export async function enrollWelcomeForUser(
  db: SupabaseClient,
  userId: string,
): Promise<{ enrolled: number; sent: number; skipped: string | null }> {
  const automation = await loadActiveAutomation(db, "account_registered");
  if (!automation?.activated_at) {
    return { enrolled: 0, sent: 0, skipped: "inactive" };
  }
  const rows = await loadWelcomeCandidates(
    db,
    automation.id,
    automation.activated_at,
    userId,
  );
  if (!rows.length) return { enrolled: 0, sent: 0, skipped: "not_candidate" };
  const result = await enrollWelcomeRows(db, automation, rows);
  let sent = 0;
  for (const enrollmentId of result.enrollmentIds) {
    const due = await processDueAutomationSteps(db, { enrollmentId });
    sent += due.sent;
  }
  return { enrolled: result.enrolled, sent, skipped: null };
}

/** C1: paid Harmonizer ended ≥3d ago; re-fire on later expiry cycles.
 * Trigger instant = periodEnd + 3d; must be ≥ activated_at (pause does not backfill).
 */
export async function enrollSubscriptionExpired(db: SupabaseClient): Promise<number> {
  const automation = await loadActiveAutomation(db, "subscription_expired");
  if (!automation?.activated_at) return 0;
  const delayH = await firstStepDelayHours(db, automation.id);
  if (delayH == null) return 0;

  const activationMs = new Date(automation.activated_at).getTime();
  const cutoff = Date.now() - C1_DAYS * 86400_000;
  const periodEndMin = activationMs - C1_DAYS * 86400_000;
  const cutoffIso = new Date(cutoff).toISOString();
  const periodEndMinIso = new Date(periodEndMin).toISOString();

  const userIds = new Set<string>();
  const { data: expiredUsers, error: expiredError } = await db
    .from("users")
    .select("id")
    .eq("skip_email_automations", false)
    .not("membership_expires_at", "is", null)
    .lte("membership_expires_at", cutoffIso)
    .gte("membership_expires_at", periodEndMinIso)
    .limit(500);
  if (expiredError) throw expiredError;
  for (const row of expiredUsers ?? []) userIds.add(row.id);

  const { data: contracts, error: contractError } = await db
    .from("payment_contracts")
    .select("user_id, current_period_end")
    .in("tier", ["oracle", "master"])
    .eq("product_kind", "subscription")
    .not("current_period_end", "is", null)
    .lte("current_period_end", cutoffIso)
    .gte("current_period_end", periodEndMinIso)
    .limit(500);
  if (contractError) throw contractError;
  for (const row of contracts ?? []) {
    if (row.user_id) userIds.add(row.user_id);
  }

  const { data: payments, error: paymentError } = await db
    .from("payments")
    .select("user_id, paid_until")
    .in("tier", ["oracle", "master", "practitioner"])
    .not("paid_until", "is", null)
    .lte("paid_until", cutoffIso)
    .gte("paid_until", periodEndMinIso)
    .limit(500);
  if (paymentError) throw paymentError;
  for (const row of payments ?? []) {
    if (row.user_id) userIds.add(row.user_id);
  }

  let enrolled = 0;
  const nextAt = new Date(Date.now() + delayH * 3600_000).toISOString();

  for (const userId of userIds) {
    await upsertContactForUser(db, userId);
    const { data: contact } = await db
      .from("email_contacts")
      .select("id, user_id, marketing_status")
      .eq("user_id", userId)
      .eq("marketing_status", "active")
      .maybeSingle();
    if (!contact) continue;
    if (await hasActiveEnrollment(db, automation.id, contact.id)) continue;

    const { data: user } = await db
      .from("users")
      .select("id, membership_tier, membership_expires_at, skip_email_automations")
      .eq("id", userId)
      .maybeSingle();
    if (!user || user.skip_email_automations) continue;
    if (isCurrentlyPaid(user)) continue;

    const periodEndMs = await subscriptionPeriodEndMs(db, userId, user.membership_expires_at);
    if (!periodEndMs || periodEndMs > cutoff) continue;
    const fireMs = periodEndMs + C1_DAYS * 86400_000;
    if (!isAfterActivation(fireMs, automation.activated_at)) continue;

    const cycleKey = new Date(periodEndMs).toISOString();
    const last = await lastCompletedEnrollment(db, automation.id, contact.id);
    if (last?.cycle_key && last.cycle_key === cycleKey) continue;
    if (last?.cycle_key && new Date(last.cycle_key).getTime() >= periodEndMs) continue;

    const enrollmentId = await insertEnrollment(db, {
      automation_id: automation.id,
      contact_id: contact.id,
      next_step_at: nextAt,
      cycle_key: cycleKey,
    });
    if (enrollmentId) enrolled += 1;
  }
  return enrolled;
}

async function subscriptionPeriodEndMs(
  db: SupabaseClient,
  userId: string,
  membershipExpiresAt?: string | null,
): Promise<number> {
  let periodEndMs = 0;
  const { data: contracts } = await db
    .from("payment_contracts")
    .select("current_period_end, tier, product_kind, status")
    .eq("user_id", userId)
    .in("tier", ["oracle", "master"])
    .eq("product_kind", "subscription");
  for (const pc of contracts ?? []) {
    if (!pc.current_period_end) continue;
    const t = new Date(pc.current_period_end).getTime();
    if (Number.isFinite(t) && t > periodEndMs) periodEndMs = t;
  }
  const { data: payments } = await db
    .from("payments")
    .select("paid_until, tier")
    .eq("user_id", userId)
    .in("tier", ["oracle", "master", "practitioner"]);
  for (const p of payments ?? []) {
    if (!p.paid_until) continue;
    const t = new Date(p.paid_until).getTime();
    if (Number.isFinite(t) && t > periodEndMs) periodEndMs = t;
  }
  if (membershipExpiresAt) {
    const t = new Date(membershipExpiresAt).getTime();
    if (Number.isFinite(t) && t > periodEndMs && t <= Date.now()) periodEndMs = t;
  }
  return periodEndMs;
}

/** C2: inactive ≥14d; re-fire after return then leave again.
 * Trigger instant = last_seen (or created) + 14d; must be ≥ activated_at.
 */
export async function enrollInactive(db: SupabaseClient): Promise<number> {
  const automation = await loadActiveAutomation(db, "inactive");
  if (!automation?.activated_at) return 0;
  const delayH = await firstStepDelayHours(db, automation.id);
  if (delayH == null) return 0;

  const cutoff = Date.now() - C2_DAYS * 86400_000;
  const lastSeenMin = new Date(automation.activated_at).getTime() - C2_DAYS * 86400_000;
  const cutoffIso = new Date(cutoff).toISOString();
  const lastSeenMinIso = new Date(lastSeenMin).toISOString();

  const { data: quietSeen, error: seenError } = await db
    .from("users")
    .select("id, last_seen_at, created_at, skip_email_automations")
    .eq("skip_email_automations", false)
    .not("last_seen_at", "is", null)
    .lte("last_seen_at", cutoffIso)
    .gte("last_seen_at", lastSeenMinIso)
    .limit(500);
  if (seenError) throw seenError;

  const { data: quietNever, error: neverError } = await db
    .from("users")
    .select("id, last_seen_at, created_at, skip_email_automations")
    .eq("skip_email_automations", false)
    .is("last_seen_at", null)
    .lte("created_at", cutoffIso)
    .gte("created_at", lastSeenMinIso)
    .limit(500);
  if (neverError) throw neverError;

  const quiet = [...(quietSeen ?? []), ...(quietNever ?? [])];

  let enrolled = 0;
  const nextAt = new Date(Date.now() + delayH * 3600_000).toISOString();

  for (const user of quiet ?? []) {
    const lastSeenMs = user.last_seen_at ? new Date(user.last_seen_at).getTime() : null;
    const createdMs = user.created_at ? new Date(user.created_at).getTime() : 0;
    const inactiveAnchorMs = lastSeenMs ?? createdMs;
    const fireMs = inactiveAnchorMs + C2_DAYS * 86400_000;
    if (!isAfterActivation(fireMs, automation.activated_at)) continue;
    const inactive =
      lastSeenMs == null
        ? createdMs > 0 && createdMs <= cutoff
        : lastSeenMs <= cutoff;
    if (!inactive) continue;

    await upsertContactForUser(db, user.id);
    const { data: contact } = await db
      .from("email_contacts")
      .select("id, user_id, marketing_status")
      .eq("user_id", user.id)
      .eq("marketing_status", "active")
      .maybeSingle();
    if (!contact) continue;
    if (await hasActiveEnrollment(db, automation.id, contact.id)) continue;

    const last = await lastCompletedEnrollment(db, automation.id, contact.id);
    if (last) {
      if (lastSeenMs == null) continue;
      const completedAt = new Date(last.updated_at).getTime();
      if (lastSeenMs <= completedAt) continue;
      if (lastSeenMs > cutoff) continue;
    }

    const cycleKey = lastSeenMs
      ? new Date(lastSeenMs).toISOString()
      : `never:${user.created_at ?? contact.id}`;

    const ok = await insertEnrollment(db, {
      automation_id: automation.id,
      contact_id: contact.id,
      next_step_at: nextAt,
      cycle_key: cycleKey,
    });
    if (ok) enrolled += 1;
  }
  return enrolled;
}

/**
 * Stop all active automation drips for a user about to be wiped.
 * Contact rows survive (user_id → null); without this, due-sends would continue.
 */
export async function cancelActiveEmailAutomationsForUser(
  db: SupabaseClient,
  params: { userId: string; email: string },
): Promise<number> {
  const normalized = params.email.trim().toLowerCase();
  const contactIds = new Set<string>();

  const { data: byUser, error: byUserError } = await db
    .from("email_contacts")
    .select("id")
    .eq("user_id", params.userId);
  if (byUserError) throw byUserError;
  for (const row of byUser ?? []) contactIds.add(row.id);

  if (normalized) {
    const { data: byEmail, error: byEmailError } = await db
      .from("email_contacts")
      .select("id")
      .eq("email_normalized", normalized);
    if (byEmailError) throw byEmailError;
    for (const row of byEmail ?? []) contactIds.add(row.id);
  }

  if (!contactIds.size) return 0;

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("email_automation_enrollments")
    .update({ status: "cancelled", updated_at: nowIso })
    .in("contact_id", [...contactIds])
    .eq("status", "active")
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Cancel active enrollment for a contact (user card «Отменить цепочку»). */
export async function cancelEnrollmentForContact(
  db: SupabaseClient,
  params: { enrollmentId: string; contactId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await db
    .from("email_automation_enrollments")
    .update({
      status: "cancelled",
      next_step_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.enrollmentId)
    .eq("contact_id", params.contactId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Активная цепочка не найдена" };
  return { ok: true };
}

/** Manual enroll from admin user card (allows re-run even if prior completed). */
export async function enrollContactManual(
  db: SupabaseClient,
  automationId: string,
  contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: automation } = await db
    .from("email_automations")
    .select("id, is_active")
    .eq("id", automationId)
    .maybeSingle();
  if (!automation) return { ok: false, error: "Цепочка не найдена" };

  const { data: contact } = await db
    .from("email_contacts")
    .select("id, user_id, marketing_status")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact || contact.marketing_status !== "active") {
    return { ok: false, error: "Нет активного email-контакта" };
  }
  if (contact.user_id) {
    const { data: user } = await db
      .from("users")
      .select("skip_email_automations")
      .eq("id", contact.user_id)
      .maybeSingle();
    if (user?.skip_email_automations) {
      return { ok: false, error: "У пользователя включён запрет автоцепочек" };
    }
  }

  if (await hasActiveEnrollment(db, automationId, contactId)) {
    return { ok: false, error: "Цепочка уже запущена для этого контакта" };
  }

  const delayH = await firstStepDelayHours(db, automationId);
  if (delayH == null) return { ok: false, error: "В цепочке нет шагов" };

  const nextAt = new Date(Date.now() + delayH * 3600_000).toISOString();
  const ok = await insertEnrollment(db, {
    automation_id: automationId,
    contact_id: contactId,
    next_step_at: nextAt,
    cycle_key: `manual:${Date.now()}`,
  });
  if (!ok) return { ok: false, error: "Не удалось создать enrollment" };
  return { ok: true };
}

export async function processDueAutomationSteps(
  db: SupabaseClient,
  opts?: { enrollmentId?: string },
): Promise<{
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
}> {
  const nowIso = new Date().toISOString();
  let dueQuery = db
    .from("email_automation_enrollments")
    .select("id, automation_id, contact_id, current_position, next_step_at, status, cycle_key")
    .eq("status", "active")
    .lte("next_step_at", nowIso)
    .order("next_step_at", { ascending: true })
    .limit(50);
  if (opts?.enrollmentId) {
    dueQuery = dueQuery.eq("id", opts.enrollmentId);
  } else {
    const { data: activeAutos } = await db
      .from("email_automations")
      .select("id")
      .eq("is_active", true);
    const activeIds = (activeAutos ?? []).map((row) => row.id as string);
    if (!activeIds.length) return { processed: 0, sent: 0, skipped: 0, failed: 0 };
    dueQuery = dueQuery.in("automation_id", activeIds);
  }
  const { data: due, error } = await dueQuery;
  if (error) throw error;
  if (!due?.length) return { processed: 0, sent: 0, skipped: 0, failed: 0 };

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const enrollment of due as Enrollment[]) {
    const { data: automation } = await db
      .from("email_automations")
      .select("id, is_active, trigger_type")
      .eq("id", enrollment.automation_id)
      .maybeSingle();
    if (!automation?.is_active) {
      // Pause: keep enrollment, skip send until the chain is turned on again.
      continue;
    }

    const { data: steps } = await db
      .from("email_automation_steps")
      .select(
        "id, automation_id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n, blocks_i18n",
      )
      .eq("automation_id", enrollment.automation_id)
      .order("position", { ascending: true });
    const ordered = (steps ?? []) as Step[];
    const step = ordered[enrollment.current_position];
    if (!step) {
      await db
        .from("email_automation_enrollments")
        .update({ status: "completed", next_step_at: null, updated_at: nowIso })
        .eq("id", enrollment.id);
      continue;
    }

    const { data: contact } = await db
      .from("email_contacts")
      .select("id, email, locale, user_id, marketing_status, unsubscribe_token")
      .eq("id", enrollment.contact_id)
      .maybeSingle();

    if (!contact || contact.marketing_status !== "active") {
      await db
        .from("email_automation_enrollments")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", enrollment.id);
      skipped += 1;
      continue;
    }

    // Account wipe leaves the contact but clears user_id — stop drips (no orphan sends).
    if (!contact.user_id) {
      await db
        .from("email_automation_enrollments")
        .update({ status: "cancelled", updated_at: nowIso })
        .eq("id", enrollment.id);
      skipped += 1;
      continue;
    }

    let displayName: string | null = null;
    /** Prefer live app locale so mid-chain language switch takes effect immediately. */
    let sendLocale = contact.locale as string | null;
    if (contact.user_id) {
      const { data: user } = await db
        .from("users")
        .select("display_name, skip_email_automations, locale, onboarded_at")
        .eq("id", contact.user_id)
        .maybeSingle();
      if (user?.skip_email_automations) {
        await db
          .from("email_automation_enrollments")
          .update({ status: "cancelled", updated_at: nowIso })
          .eq("id", enrollment.id);
        skipped += 1;
        continue;
      }
      // Welcome drip is Harmonizer registration (wizard done), not OTP-only.
      if (
        automation.trigger_type === "account_registered" &&
        (typeof user?.onboarded_at !== "string" || !user.onboarded_at.trim())
      ) {
        await db
          .from("email_automation_enrollments")
          .update({ status: "cancelled", updated_at: nowIso })
          .eq("id", enrollment.id);
        skipped += 1;
        continue;
      }
      displayName = user?.display_name ?? null;
      const userLocale = typeof user?.locale === "string" ? user.locale.trim() : "";
      if (userLocale) sendLocale = userLocale;
    }

    const copy = resolveExactEmailCopy(sendLocale, {
      subject: step.subject,
      htmlBody: step.html_body,
      subjectI18n: parseStringRecord(step.subject_i18n),
      htmlBodyI18n: parseStringRecord(step.html_body_i18n),
    });

    if (!copy) {
      // No exact translation for current locale — skip this letter, keep the drip schedule.
      await db.from("email_automation_sends").insert({
        enrollment_id: enrollment.id,
        automation_id: enrollment.automation_id,
        step_id: step.id,
        contact_id: contact.id,
        resend_id: null,
        status: "skipped",
        subject: "",
        error_detail: `skipped_locale:${sendLocale || "ru"}`,
      });
      await advanceEnrollment(db, enrollment, ordered, nowIso);
      skipped += 1;
      continue;
    }

    const name = nameFromContact(displayName, contact.email);
    const subject = applyEmailPlaceholders(copy.subject, { name });
    const bodyHtml = applyEmailPlaceholders(copy.htmlBody, { name });

    let token = contact.unsubscribe_token;
    if (!token) {
      token = generateUnsubscribeToken();
      await db
        .from("email_contacts")
        .update({ unsubscribe_token: token })
        .eq("id", contact.id);
    }
    const unsubscribeUrl = buildSignedUnsubscribeUrl(token);
    const trackId = newEmailTrackId();
    const html = await prepareTrackedMarketingEmailHtml({
      bodyHtml,
      unsubscribeUrl,
      previewText: subject,
      trackId,
    });

    const result = await sendMarketingEmail({
      to: contact.email,
      subject,
      html,
      text: htmlToPlaintext(html),
      unsubscribeUrl,
      locale: copy.locale,
      tags: [
        { name: "automation_id", value: enrollment.automation_id },
        { name: "step", value: String(step.position) },
      ],
    });

    await db.from("email_automation_sends").insert({
      enrollment_id: enrollment.id,
      automation_id: enrollment.automation_id,
      step_id: step.id,
      contact_id: contact.id,
      resend_id: result.ok ? result.resendId : null,
      status: result.ok ? "sent" : "failed",
      subject,
      error_detail: result.ok ? null : result.detail,
    });

    if (result.ok) {
      await registerEmailTrackKey(db, {
        trackId,
        resendId: result.resendId,
        contactId: contact.id,
        stepId: step.id,
      });
      sent += 1;
      await db
        .from("email_contacts")
        .update({ last_sent_at: nowIso })
        .eq("id", contact.id);
      const { data: stepRow } = await db
        .from("email_automation_steps")
        .select("sent_count")
        .eq("id", step.id)
        .maybeSingle();
      await db
        .from("email_automation_steps")
        .update({
          sent_count: Number(stepRow?.sent_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", step.id);
    } else {
      failed += 1;
      const { data: stepRow } = await db
        .from("email_automation_steps")
        .select("failed_count")
        .eq("id", step.id)
        .maybeSingle();
      await db
        .from("email_automation_steps")
        .update({
          failed_count: Number(stepRow?.failed_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", step.id);
      const { count: failedAttempts } = await db
        .from("email_automation_sends")
        .select("id", { count: "exact", head: true })
        .eq("enrollment_id", enrollment.id)
        .eq("step_id", step.id)
        .eq("status", "failed");
      if ((failedAttempts ?? 0) < SEND_MAX_ATTEMPTS) {
        await db
          .from("email_automation_enrollments")
          .update({
            next_step_at: new Date(Date.now() + SEND_RETRY_DELAY_MS).toISOString(),
            updated_at: nowIso,
          })
          .eq("id", enrollment.id);
        continue;
      }
    }

    await advanceEnrollment(db, enrollment, ordered, nowIso);
    await sleep(400);
  }

  return { processed: due.length, sent, skipped, failed };
}

async function advanceEnrollment(
  db: SupabaseClient,
  enrollment: Enrollment,
  ordered: Step[],
  nowIso: string,
): Promise<void> {
  const nextPos = enrollment.current_position + 1;
  const nextStep = ordered[nextPos];
  if (!nextStep) {
    await db
      .from("email_automation_enrollments")
      .update({
        status: "completed",
        current_position: nextPos,
        next_step_at: null,
        updated_at: nowIso,
      })
      .eq("id", enrollment.id);
    return;
  }
  const delayMs = Math.max(0, Number(nextStep.delay_hours) || 0) * 3600_000;
  await db
    .from("email_automation_enrollments")
    .update({
      current_position: nextPos,
      next_step_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: nowIso,
    })
    .eq("id", enrollment.id);
}

/** Prefix failures with the phase so `[api] <stage>: <message>` in Vercel logs is actionable. */
async function runStage<T>(stage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
    throw new Error(`${stage}: ${message}`, { cause: error });
  }
}

export async function runEmailAutomations(db: SupabaseClient) {
  const welcome = await runStage("enroll_welcome", () => enrollAccountRegistered(db));
  const expired = await runStage("enroll_subscription_expired", () => enrollSubscriptionExpired(db));
  const inactive = await runStage("enroll_inactive", () => enrollInactive(db));
  const due = await runStage("process_due_steps", () => processDueAutomationSteps(db));
  return {
    enrolled_welcome: welcome,
    enrolled_subscription_expired: expired,
    enrolled_inactive: inactive,
    ...due,
  };
}
