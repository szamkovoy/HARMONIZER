export const TIER_LABELS: Record<string, string> = {
  free: "Бесплатный",
  oracle: "Оракул",
  practitioner: "Практик",
  master: "Мастер",
};

const TIER_BADGE: Record<string, string> = {
  free: "bg-white/5 text-zinc-400",
  oracle: "bg-sky-500/15 text-sky-300",
  practitioner: "bg-violet-500/15 text-violet-300",
  master: "bg-amber-500/15 text-amber-300",
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIER_BADGE[tier] ?? TIER_BADGE.free}`}>
      {TIER_LABELS[tier] ?? tier}
    </span>
  );
}
