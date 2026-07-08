export type ProductTier = "free" | "oracle" | "practitioner" | "master";

export type EffectiveAccessLabel = ProductTier | "master_trial";

export const PRODUCT_TIERS: ProductTier[] = ["free", "oracle", "practitioner", "master"];

export const TIER_LABELS: Record<ProductTier, string> = {
  free: "Free",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

export const TIER_ORDER: Record<ProductTier, number> = {
  free: 0,
  oracle: 1,
  practitioner: 2,
  master: 3,
};

export function tierAtLeast(tier: ProductTier, minimum: ProductTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[minimum];
}
