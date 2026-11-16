import type { SupabaseClient } from "@supabase/supabase-js";

import { nextPeriodEnd } from "./lava";

/** periodKey is the period charged, not the mutable period on a webhook retry. */
export function renewalPeriodEnd(paidAt: string, periodKey?: string | null): string {
  const paidMs = Date.parse(paidAt);
  if (!Number.isFinite(paidMs)) throw new Error("Invalid renewal payment timestamp");
  const periodMs = periodKey ? Date.parse(periodKey) : NaN;
  if (periodKey && !Number.isFinite(periodMs)) throw new Error("Invalid renewal periodKey");
  return nextPeriodEnd(new Date(Number.isFinite(periodMs) ? Math.max(periodMs, paidMs) : paidMs)).toISOString();
}

/** Contract and membership commit together; cancelled subscriptions stay cancelled. */
export async function applySubscriptionRenewal(
  db: SupabaseClient,
  params: { contractId: string; paidAt: string; periodKey?: string | null },
): Promise<{ status: string; current_period_end: string } | null> {
  const { data, error } = await db.rpc("apply_subscription_renewal", {
    p_contract_id: params.contractId,
    p_period_end: renewalPeriodEnd(params.paidAt, params.periodKey),
  });
  if (error) throw error;
  return data;
}
