import { accessModeForTier, type ProductTier } from "@/modules/access";
import type { AccessMode } from "@/services/globalContentClient";

/**
 * Single source of truth for dayContentCache accessMode/accessTier keys.
 *
 * Home (`useDayContent` + index overrides) uses `accessModeForTier(access.tier)`
 * which collapses trial/paid product tiers to `"premium"`. Profile ensure MUST
 * use the same mapping — writing `"trial"` makes Home miss the warmed entry and
 * triggers a second monologue + stale-language flash.
 */
export function resolveDayContentAccessKeys(accessTier: ProductTier): {
  accessMode: AccessMode;
  accessTier: ProductTier;
} {
  return {
    accessMode: accessModeForTier(accessTier),
    accessTier,
  };
}
