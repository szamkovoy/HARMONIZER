export type ProductTier = "free" | "oracle" | "practitioner" | "master";

export type PaidProductTier = Exclude<ProductTier, "free">;

export type EffectiveAccessLabel = ProductTier | "master_trial";

export const PRODUCT_TIERS: ProductTier[] = ["free", "oracle", "practitioner", "master"];

/** Платные тарифы (без free). Единственный канон списка для леджера/админки/SQL. */
export const PAID_PRODUCT_TIERS: readonly PaidProductTier[] = ["oracle", "practitioner", "master"];

/**
 * Продуктовые уровни профиля (пользовательские имена):
 *   free → «Навигатор», oracle → «Наставник», master → «Мастер».
 * `practitioner` — скрытый legacy-уровень: в UI не показывается, по матрице
 * фич эквивалентен «Наставнику» (см. features.ts). DB-значения не меняем.
 *
 * Короткие подписи для dev/UI без i18n-каталога.
 * Пользовательские диалоги берут `tier.*` из JSON-каталога;
 * админка — `TIER_LABELS_RU`.
 */
export const TIER_LABELS: Record<ProductTier, string> = {
  free: "Навигатор",
  oracle: "Наставник",
  practitioner: "Наставник (legacy)",
  master: "Мастер",
};

/** Русские названия уровней для админ-панели (единственный RU-канон имён). */
export const TIER_LABELS_RU: Record<ProductTier, string> = {
  free: "Навигатор (бесплатный)",
  oracle: "Наставник",
  practitioner: "Наставник (legacy)",
  master: "Мастер",
};

/**
 * Уровни, доступные для выбора/показа в UI (админка, кабинет).
 * `practitioner` скрыт: существующие строки БД продолжают работать,
 * новые гранты выдаются только на видимые уровни.
 */
export const VISIBLE_PRODUCT_TIERS: readonly ProductTier[] = ["free", "oracle", "master"];
export const VISIBLE_PAID_PRODUCT_TIERS: readonly PaidProductTier[] = ["oracle", "master"];

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
