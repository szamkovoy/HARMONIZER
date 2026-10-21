import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Active one-time book purchase (`payment_contracts`).
 * Shared by cabinet overview, purchases/book, and book/* routes.
 */
export async function hasActiveBookPurchase(
  db: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id")
    .eq("user_id", userId)
    .eq("product_kind", "one_time")
    .eq("tier", "book")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return !!row?.contract_id;
}

export type ActiveBookPurchaseRow = {
  contractId: string;
  purchasedAt: string;
};

export async function getActiveBookPurchase(
  db: SupabaseClient,
  userId: string,
): Promise<ActiveBookPurchaseRow | null> {
  const { data, error } = await db
    .from("payment_contracts")
    .select("contract_id,created_at")
    .eq("user_id", userId)
    .eq("product_kind", "one_time")
    .eq("tier", "book")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row?.contract_id) return null;
  return {
    contractId: row.contract_id,
    purchasedAt: row.created_at,
  };
}
