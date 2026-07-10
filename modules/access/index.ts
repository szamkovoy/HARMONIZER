export {
  AccessProvider,
  accessModeForTier,
  canUseFeature,
  getEffectiveAccess,
  requiredTierFor,
  useAccess,
} from "@/modules/access/core/access";
export type { AccessContextValue, EffectiveAccess } from "@/modules/access/core/access";
export type { FeatureKey } from "@/modules/access/core/features";
export { FEATURE_REQUIRED_TIER, TIER_FEATURES } from "@/modules/access/core/features";
export {
  PAID_PRODUCT_TIERS,
  PRODUCT_TIERS,
  TIER_LABELS,
  TIER_LABELS_RU,
  TIER_ORDER,
  isPaidProductTier,
  isProductTier,
  tierAtLeast,
} from "@/modules/access/core/tiers";
export type { PaidProductTier, ProductTier } from "@/modules/access/core/tiers";
export { DevTierSwitch } from "@/modules/access/ui/DevTierSwitch";
export { UpgradeDialog } from "@/modules/access/ui/UpgradeDialog";
