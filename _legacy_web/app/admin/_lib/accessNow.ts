/**
 * Effective access for admin UI (same rules as dashboard / users filter).
 * Demo = active trial_expires_at; not a DB membership_tier value.
 */

export type AccessNowSeg = "trial" | "navigator" | "oracle" | "master";

export const ACCESS_NOW_LABELS_RU: Record<AccessNowSeg, string> = {
  trial: "Демо",
  navigator: "Навигатор",
  oracle: "Наставник",
  master: "Мастер",
};

export function accessNowSegment(row: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
  nowMs?: number;
}): AccessNowSeg {
  const now = row.nowMs ?? Date.now();
  if (row.trial_expires_at && new Date(row.trial_expires_at).getTime() > now) {
    return "trial";
  }
  const expires = row.membership_expires_at
    ? new Date(row.membership_expires_at).getTime()
    : null;
  const active = expires == null || expires > now;
  if (!active) return "navigator";
  if (row.membership_tier === "master") return "master";
  if (row.membership_tier === "oracle" || row.membership_tier === "practitioner") {
    return "oracle";
  }
  return "navigator";
}

export function isActiveTrial(trialExpiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  return Boolean(trialExpiresAt && new Date(trialExpiresAt).getTime() > nowMs);
}
