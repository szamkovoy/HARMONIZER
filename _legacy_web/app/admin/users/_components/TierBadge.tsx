import { TIER_LABELS_RU, type ProductTier } from "@/modules/access/core/tiers";

export const TIER_LABELS: Record<string, string> = TIER_LABELS_RU;

const TIER_BADGE: Record<string, string> = {
  free: "bg-white/5 text-zinc-400",
  oracle: "bg-sky-500/15 text-sky-300",
  practitioner: "bg-violet-500/15 text-violet-300",
  master: "bg-amber-500/15 text-amber-300",
};

export function TierBadge({ tier }: { tier: string }) {
  const label = TIER_LABELS[tier as ProductTier] ?? tier;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_BADGE[tier] ?? TIER_BADGE.free}`}>
      {label}
    </span>
  );
}
