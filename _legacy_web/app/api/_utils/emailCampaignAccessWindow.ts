import type { SupabaseClient } from "@supabase/supabase-js";

/** A master grant shorter than this is the campaign window, not a paid plan. */
export const LONG_TERM_MASTER_HOURS = 48;

export type MailUserAccess = {
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
  app_first_open_at: string | null;
  last_seen_at: string | null;
  onboarded_at: string | null;
};

export type AccessGrantKind = "trial" | "master";

function tierOf(raw: string | null | undefined): string {
  return (raw ?? "free").trim().toLowerCase();
}

export function hasEnteredHarmonizer(user: MailUserAccess): boolean {
  return Boolean(user.app_first_open_at || user.last_seen_at || user.onboarded_at);
}

export function hasActivePaidPlan(user: MailUserAccess, nowMs: number): boolean {
  const tier = tierOf(user.membership_tier);
  if (tier !== "oracle" && tier !== "practitioner" && tier !== "master") return false;
  if (!user.membership_expires_at) return true;
  const exp = Date.parse(user.membership_expires_at);
  return Number.isFinite(exp) && exp > nowMs;
}

/** Paid Master whose term runs past the temporary campaign window. */
export function isLongTermMaster(user: MailUserAccess, nowMs: number): boolean {
  if (tierOf(user.membership_tier) !== "master") return false;
  if (!user.membership_expires_at) return true;
  const exp = Date.parse(user.membership_expires_at);
  if (!Number.isFinite(exp)) return true;
  return exp > nowMs + LONG_TERM_MASTER_HOURS * 60 * 60 * 1000;
}

/**
 * Who receives an access change with this wave.
 * Never-opened contacts stay untouched so the first OTP still grants 24h.
 * A running demo is left on its own clock.
 */
export function accessGrantKind(user: MailUserAccess, nowMs: number): AccessGrantKind | null {
  if (isLongTermMaster(user, nowMs)) return null;
  const tier = tierOf(user.membership_tier);
  if ((tier === "oracle" || tier === "practitioner") && hasActivePaidPlan(user, nowMs)) {
    return "master";
  }
  if (hasActivePaidPlan(user, nowMs)) return null;
  const trialMs = user.trial_expires_at ? Date.parse(user.trial_expires_at) : NaN;
  if (Number.isFinite(trialMs) && trialMs > nowMs) return null;
  if (!hasEnteredHarmonizer(user)) return null;
  return "trial";
}

type GrantRow = {
  user_id: string;
  kind: AccessGrantKind;
  previous_tier: string | null;
  previous_expires_at: string | null;
  previous_trial_expires_at: string | null;
};

async function loadUsers(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, MailUserAccess & { id: string }>> {
  const out = new Map<string, MailUserAccess & { id: string }>();
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
        id: row.id as string,
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

async function alreadyGranted(
  db: SupabaseClient,
  campaignId: string,
  userIds: string[],
): Promise<Set<string>> {
  const granted = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("email_campaign_access_grants")
      .select("user_id")
      .eq("campaign_id", campaignId)
      .in("user_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) granted.add(row.user_id as string);
  }
  return granted;
}

/**
 * Apply this wave's access window once per user.
 * Trial expires on its own. Master is restored from the stored snapshot.
 */
export async function applyCampaignAccessWindow(
  db: SupabaseClient,
  campaignId: string,
  userIds: string[],
  hours: number,
): Promise<{ trial: number; master: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0 || !Number.isFinite(hours) || hours <= 0) {
    return { trial: 0, master: 0 };
  }
  const nowMs = Date.now();
  const revertAt = new Date(nowMs + hours * 60 * 60 * 1000).toISOString();
  const users = await loadUsers(db, unique);
  const prior = await alreadyGranted(db, campaignId, unique);
  const pending: GrantRow[] = [];
  for (const id of unique) {
    if (prior.has(id)) continue;
    const user = users.get(id);
    if (!user) continue;
    const kind = accessGrantKind(user, nowMs);
    if (!kind) continue;
    pending.push({
      user_id: id,
      kind,
      previous_tier: user.membership_tier,
      previous_expires_at: user.membership_expires_at,
      previous_trial_expires_at: user.trial_expires_at,
    });
  }
  if (pending.length === 0) return { trial: 0, master: 0 };

  const { error: insertError } = await db.from("email_campaign_access_grants").insert(
    pending.map((row) => ({
      campaign_id: campaignId,
      user_id: row.user_id,
      kind: row.kind,
      previous_tier: row.previous_tier,
      previous_expires_at: row.previous_expires_at,
      previous_trial_expires_at: row.previous_trial_expires_at,
      revert_at: revertAt,
    })),
  );
  if (insertError) throw insertError;

  let trial = 0;
  let master = 0;
  for (const row of pending) {
    if (row.kind === "trial") {
      const { error } = await db
        .from("users")
        .update({ trial_expires_at: revertAt })
        .eq("id", row.user_id)
        .or(`trial_expires_at.is.null,trial_expires_at.lte.${new Date(nowMs).toISOString()}`);
      if (error) throw error;
      trial += 1;
    } else {
      const { error } = await db
        .from("users")
        .update({
          membership_tier: "master",
          membership_expires_at: revertAt,
        })
        .eq("id", row.user_id)
        .in("membership_tier", ["oracle", "practitioner"]);
      if (error) throw error;
      master += 1;
    }
  }
  return { trial, master };
}

async function boughtMasterSince(
  db: SupabaseClient,
  userId: string,
  sinceIso: string,
): Promise<boolean> {
  const { count: contracts, error: contractError } = await db
    .from("payment_contracts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tier", "master")
    .eq("status", "active")
    .gt("created_at", sinceIso);
  if (contractError) throw contractError;
  if ((contracts ?? 0) > 0) return true;
  const { count: payments, error: paymentError } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tier", "master")
    .gt("created_at", sinceIso);
  if (paymentError) throw paymentError;
  return (payments ?? 0) > 0;
}

/** Restore Наставник snapshots after the temporary Master window. Trial rows expire alone. */
export async function revertDueMasterGrants(db: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("email_campaign_access_grants")
    .select(
      "campaign_id, user_id, previous_tier, previous_expires_at, revert_at, created_at",
    )
    .eq("kind", "master")
    .is("reverted_at", null)
    .lte("revert_at", nowIso)
    .limit(50);
  if (error) throw error;
  let n = 0;
  for (const row of data ?? []) {
    const userId = row.user_id as string;
    const since = (row.created_at as string) ?? nowIso;
    const keepPurchase = await boughtMasterSince(db, userId, since);
    if (!keepPurchase) {
      const { error: updateError } = await db
        .from("users")
        .update({
          membership_tier: (row.previous_tier as string | null) ?? "oracle",
          membership_expires_at: (row.previous_expires_at as string | null) ?? null,
        })
        .eq("id", userId);
      if (updateError) throw updateError;
    }
    const { error: markError } = await db
      .from("email_campaign_access_grants")
      .update({ reverted_at: nowIso })
      .eq("campaign_id", row.campaign_id as string)
      .eq("user_id", userId);
    if (markError) throw markError;
    n += 1;
  }
  return n;
}
