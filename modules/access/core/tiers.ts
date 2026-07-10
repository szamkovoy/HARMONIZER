export type ProductTier = "free" | "oracle" | "practitioner" | "master";

export type PaidProductTier = Exclude<ProductTier, "free">;

export type EffectiveAccessLabel = ProductTier | "master_trial";

export const PRODUCT_TIERS: ProductTier[] = ["free", "oracle", "practitioner", "master"];

/** Платные тарифы (без free). Единственный канон списка для леджера/админки/SQL. */
export const PAID_PRODUCT_TIERS: readonly PaidProductTier[] = ["oracle", "practitioner", "master"];

/**
 * Короткие подписи для dev/UI без i18n-каталога.
 * Пользовательский UpgradeDialog берёт `tier.*` из JSON-каталога;
 * админка — `TIER_LABELS_RU`.
 */
export const TIER_LABELS: Record<ProductTier, string> = {
  free: "Free",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

/** Русские названия тарифов для админ-панели (единственный RU-канон имён). */
export const TIER_LABELS_RU: Record<ProductTier, string> = {
  free: "Бесплатный",
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

export function isPaidProductTier(tier: string): tier is PaidProductTier {
  return (PAID_PRODUCT_TIERS as readonly string[]).includes(tier);
}

export function isProductTier(tier: string): tier is ProductTier {
  return (PRODUCT_TIERS as readonly string[]).includes(tier);
}

export function tierAtLeast(tier: ProductTier, minimum: ProductTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[minimum];
}
