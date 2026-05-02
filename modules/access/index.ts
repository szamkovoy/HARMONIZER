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
export { PRODUCT_TIERS, TIER_LABELS, TIER_ORDER, tierAtLeast } from "@/modules/access/core/tiers";
export type { ProductTier } from "@/modules/access/core/tiers";
export { DevTierSwitch } from "@/modules/access/ui/DevTierSwitch";
export { UpgradeDialog } from "@/modules/access/ui/UpgradeDialog";
