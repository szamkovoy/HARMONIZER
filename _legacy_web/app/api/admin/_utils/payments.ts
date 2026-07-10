import type { SupabaseClient } from "@supabase/supabase-js";
import { isPaidProductTier, isProductTier, PAID_PRODUCT_TIERS, PRODUCT_TIERS } from "@/modules/access/core/tiers";
import { selectActiveMembershipFromPayments } from "./membershipFromPayments";

export const PAID_TIERS = new Set<string>(PAID_PRODUCT_TIERS);
export const ALL_TIERS = new Set<string>(PRODUCT_TIERS);

export { isPaidProductTier, isProductTier };

/**
 * Пересчитывает users.membership_* из леджера payments:
 * среди ещё действующих платежей — максимальный тариф (см. selectActiveMembershipFromPayments);
 * если действующих нет — free.
 */
export async function recomputeUserMembershipFromPayments(db: SupabaseClient, userId: string): Promise<void> {
  const { data: payments, error: paymentsError } = await db
    .from("payments")
    .select("tier, paid_until, created_at")
    .eq("user_id", userId);
  if (paymentsError) throw paymentsError;

  const active = selectActiveMembershipFromPayments(payments ?? []);
  if (!active) {
    const { error } = await db
      .from("users")
      .update({ membership_tier: "free", membership_expires_at: null })
      .eq("id", userId);
    if (error) throw error;
    return;
  }

  const { error } = await db
    .from("users")
    .update({ membership_tier: active.tier, membership_expires_at: active.paid_until })
    .eq("id", userId);
  if (error) throw error;
}
