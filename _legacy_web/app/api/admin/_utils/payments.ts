import type { SupabaseClient } from "@supabase/supabase-js";

export const PAID_TIERS = new Set(["oracle", "practitioner", "master"]);
export const ALL_TIERS = new Set(["free", ...PAID_TIERS]);

/** Если правим самую свежую запись леджера — синхронизируем тариф в users. */
export async function syncUserTierFromLatestPayment(db: SupabaseClient, userId: string): Promise<void> {
  const { data: latest, error: latestError } = await db
    .from("payments")
    .select("tier, paid_until, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  if (!latest) {
    const { error } = await db
      .from("users")
      .update({ membership_tier: "free", membership_expires_at: null })
      .eq("id", userId);
    if (error) throw error;
    return;
  }

  const { error } = await db
    .from("users")
    .update({ membership_tier: latest.tier, membership_expires_at: latest.paid_until })
    .eq("id", userId);
  if (error) throw error;
}

export async function isLatestPayment(db: SupabaseClient, userId: string, paymentId: string): Promise<boolean> {
  const { data, error } = await db
    .from("payments")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id === paymentId;
}
