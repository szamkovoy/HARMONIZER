import { TIER_LABELS_RU, type ProductTier } from "@/modules/access/core/tiers";

import {
  ACCESS_NOW_LABELS_RU,
  accessNowSegment,
  type AccessNowSeg,
} from "../../_lib/accessNow";

export const TIER_LABELS: Record<string, string> = {
  ...TIER_LABELS_RU,
  webinar: "Вебинар",
  book: "Книга",
};

const TIER_BADGE: Record<string, string> = {
  free: "bg-zinc-100 text-zinc-400",
  oracle: "bg-sky-500/15 text-sky-300",
  practitioner: "bg-violet-500/15 text-violet-300",
  master: "bg-amber-500/15 text-amber-300",
  webinar: "bg-emerald-500/15 text-emerald-700",
  book: "bg-fuchsia-500/15 text-fuchsia-300",
};

const ACCESS_NOW_BADGE: Record<AccessNowSeg, string> = {
  trial: "bg-emerald-500/15 text-emerald-700",
  navigator: "bg-zinc-100 text-zinc-500",
  oracle: "bg-sky-500/15 text-sky-700",
  master: "bg-amber-500/15 text-amber-700",
};

/** Raw product / addon tier (payments history, DB membership_tier). */
export function TierBadge({ tier }: { tier: string }) {
  const label = TIER_LABELS[tier as ProductTier] ?? tier;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_BADGE[tier] ?? TIER_BADGE.free}`}>
      {label}
    </span>
  );
}

/** Effective access now — Демо when trial is active (membership_tier may still be free). */
export function AccessNowBadge({
  membershipTier,
  membershipExpiresAt,
  trialExpiresAt,
}: {
  membershipTier: string | null;
  membershipExpiresAt?: string | null;
  trialExpiresAt?: string | null;
}) {
  const seg = accessNowSegment({
    membership_tier: membershipTier,
    membership_expires_at: membershipExpiresAt ?? null,
    trial_expires_at: trialExpiresAt ?? null,
  });
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ACCESS_NOW_BADGE[seg]}`}
    >
      {ACCESS_NOW_LABELS_RU[seg]}
    </span>
  );
}
