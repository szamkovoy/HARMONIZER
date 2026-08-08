import type { SupabaseClient } from "@supabase/supabase-js";

import { isAutoRenewCancelled } from "../../../admin/_lib/accessNow";

type UserForFlag = {
  id: string;
  membership_tier: string | null;
  membership_expires_at: string | null;
};

type SubFlags = {
  hasActive: boolean;
  hasCancelled: boolean;
  /** Preferred contract: active first, else latest cancelled with cancelled_at. */
  current_period_end: string | null;
  subscription_status: "active" | "cancelled" | null;
};

/** Batch-enrich users with subscription flags + paid period end for list UI. */
export async function enrichUsersAutoRenewCancelled<T extends UserForFlag>(
  db: SupabaseClient,
  users: T[],
): Promise<
  (T & {
    auto_renew_cancelled: boolean;
    current_period_end: string | null;
    subscription_status: "active" | "cancelled" | null;
  })[]
> {
  if (users.length === 0) return [];

  const ids = users.map((u) => u.id);
  const { data, error } = await db
    .from("payment_contracts")
    .select("user_id, status, cancelled_at, current_period_end, created_at")
    .in("user_id", ids)
    .eq("product_kind", "subscription")
    .in("status", ["active", "cancelled"])
    .order("created_at", { ascending: false });
  if (error) throw error;

  const byUser = new Map<string, SubFlags>();
  for (const row of data ?? []) {
    const uid = row.user_id as string | null;
    if (!uid) continue;
    const entry = byUser.get(uid) ?? {
      hasActive: false,
      hasCancelled: false,
      current_period_end: null,
      subscription_status: null,
    };
    if (row.status === "active") {
      entry.hasActive = true;
      if (entry.subscription_status !== "active") {
        entry.subscription_status = "active";
        entry.current_period_end =
          typeof row.current_period_end === "string" ? row.current_period_end : null;
      }
    }
    if (row.status === "cancelled" && row.cancelled_at) {
      entry.hasCancelled = true;
      if (entry.subscription_status == null) {
        entry.subscription_status = "cancelled";
        entry.current_period_end =
          typeof row.current_period_end === "string" ? row.current_period_end : null;
      }
    }
    byUser.set(uid, entry);
  }

  return users.map((u) => {
    const flags = byUser.get(u.id) ?? {
      hasActive: false,
      hasCancelled: false,
      current_period_end: null,
      subscription_status: null,
    };
    return {
      ...u,
      auto_renew_cancelled: isAutoRenewCancelled({
        membership_tier: u.membership_tier,
        membership_expires_at: u.membership_expires_at,
        hasActiveSubscriptionContract: flags.hasActive,
        hasCancelledSubscriptionContract: flags.hasCancelled,
      }),
      current_period_end: flags.current_period_end,
      subscription_status: flags.subscription_status,
    };
  });
}
