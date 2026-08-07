import type { SupabaseClient } from "@supabase/supabase-js";

import { isAutoRenewCancelled } from "../../../admin/_lib/accessNow";

type UserForFlag = {
  id: string;
  membership_tier: string | null;
  membership_expires_at: string | null;
};

/** Batch-enrich users with `auto_renew_cancelled` from payment_contracts. */
export async function enrichUsersAutoRenewCancelled<T extends UserForFlag>(
  db: SupabaseClient,
  users: T[],
): Promise<(T & { auto_renew_cancelled: boolean })[]> {
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const { data, error } = await db
    .from("payment_contracts")
    .select("user_id, status, cancelled_at")
    .in("user_id", ids)
    .eq("product_kind", "subscription")
    .in("status", ["active", "cancelled"]);
  if (error) throw error;

  const byUser = new Map<string, { hasActive: boolean; hasCancelled: boolean }>();
  for (const row of data ?? []) {
    const uid = row.user_id as string | null;
    if (!uid) continue;
    const entry = byUser.get(uid) ?? { hasActive: false, hasCancelled: false };
    if (row.status === "active") entry.hasActive = true;
    if (row.status === "cancelled" && row.cancelled_at) entry.hasCancelled = true;
    byUser.set(uid, entry);
  }

  return users.map((u) => {
    const flags = byUser.get(u.id) ?? { hasActive: false, hasCancelled: false };
    return {
      ...u,
      auto_renew_cancelled: isAutoRenewCancelled({
        membership_tier: u.membership_tier,
        membership_expires_at: u.membership_expires_at,
        hasActiveSubscriptionContract: flags.hasActive,
        hasCancelledSubscriptionContract: flags.hasCancelled,
      }),
    };
  });
}
