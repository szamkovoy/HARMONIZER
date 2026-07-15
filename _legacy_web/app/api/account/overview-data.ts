import type { SupabaseClient } from "@supabase/supabase-js";

import { baseTierFromRow, hasActiveTrial } from "../../../modules/access/core/paidAccess";
import { VISIBLE_PAID_PRODUCT_TIERS, TIER_ORDER, type ProductTier } from "../../../modules/access/core/tiers";

/**
 * Данные для страницы Личного кабинета. Страница на WordPress локализует
 * названия уровней сама (по locale) — сервер отдаёт только машинные значения.
 */
export type AccountOverview = {
  userId: string;
  displayName: string | null;
  email: string | null;
  registeredAt: string | null;
  locale: string;
  /** Действующий базовый уровень: free | oracle | master (practitioner => oracle). */
  tier: Exclude<ProductTier, "practitioner">;
  trialActive: boolean;
  trialExpiresAt: string | null;
  membershipExpiresAt: string | null;
  /** Уровни выше текущего, которые сайт может предложить подключить. */
  upgradeTiers: ProductTier[];
};

export async function buildAccountOverview(db: SupabaseClient, userId: string): Promise<AccountOverview> {
  const { data: row, error } = await db
    .from("users")
    .select("display_name,created_at,locale,membership_tier,membership_expires_at,trial_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Response(JSON.stringify({ error: "User not found" }), { status: 404 });

  let email: string | null = null;
  const { data: authData } = await db.auth.admin.getUserById(userId);
  if (authData?.user?.email) email = authData.user.email;

  const baseTier = baseTierFromRow(row);
  // practitioner — скрытый legacy-уровень: наружу показываем как «Наставник» (oracle).
  const visibleTier = baseTier === "practitioner" ? "oracle" : baseTier;

  return {
    userId,
    displayName: row.display_name ?? null,
    email,
    registeredAt: row.created_at ?? null,
    locale: typeof row.locale === "string" && row.locale ? row.locale : "ru",
    tier: visibleTier,
    trialActive: hasActiveTrial(row),
    trialExpiresAt: row.trial_expires_at ?? null,
    membershipExpiresAt: row.membership_expires_at ?? null,
    upgradeTiers: VISIBLE_PAID_PRODUCT_TIERS.filter((tier) => TIER_ORDER[tier] > TIER_ORDER[baseTier]),
  };
}
