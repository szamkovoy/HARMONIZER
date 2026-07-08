import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { FeatureKey } from "./features";
import { FEATURE_REQUIRED_TIER, TIER_FEATURES } from "./features";
import { baseTierFromRow, hasActiveTrial, type MembershipRow } from "./paidAccess";
import type { ProductTier } from "./tiers";
import { TIER_LABELS, tierAtLeast } from "./tiers";

type ProfileAccess = MembershipRow;

export interface EffectiveAccess {
  tier: ProductTier;
  label: string;
  isTrial: boolean;
  source: "profile" | "trial" | "dev_override";
  devOverride: ProductTier | null;
}

export interface AccessContextValue {
  access: EffectiveAccess;
  canUseFeature: (feature: FeatureKey) => boolean;
  requiredTierFor: (feature: FeatureKey) => ProductTier;
  setDevTierOverride: (tier: ProductTier | null) => void;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function getEffectiveAccess(profile: ProfileAccess, devOverride: ProductTier | null = null): EffectiveAccess {
  if (devOverride) {
    return {
      tier: devOverride,
      label: `${TIER_LABELS[devOverride]} (dev)`,
      isTrial: false,
      source: "dev_override",
      devOverride,
    };
  }

  if (hasActiveTrial(profile)) {
    return {
      tier: "master",
      label: "Пробный доступ",
      isTrial: true,
      source: "trial",
      devOverride: null,
    };
  }

  const tier = baseTierFromRow(profile);
  return {
    tier,
    label: TIER_LABELS[tier],
    isTrial: false,
    source: "profile",
    devOverride: null,
  };
}

export function canUseFeature(tier: ProductTier, feature: FeatureKey): boolean {
  return TIER_FEATURES[tier].includes(feature);
}

export function requiredTierFor(feature: FeatureKey): ProductTier {
  return FEATURE_REQUIRED_TIER[feature];
}

export function accessModeForTier(tier: ProductTier): "free" | "premium" {
  return tierAtLeast(tier, "oracle") ? "premium" : "free";
}

export function AccessProvider({
  profile,
  children,
}: {
  profile: ProfileAccess;
  children: ReactNode;
}) {
  const [devOverride, setDevOverride] = useState<ProductTier | null>(null);
  const access = useMemo(() => getEffectiveAccess(profile, devOverride), [profile, devOverride]);

  const value = useMemo<AccessContextValue>(
    () => ({
      access,
      canUseFeature: (feature) => canUseFeature(access.tier, feature),
      requiredTierFor,
      setDevTierOverride: setDevOverride,
    }),
    [access],
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) {
    throw new Error("useAccess must be used inside AccessProvider.");
  }
  return value;
}
