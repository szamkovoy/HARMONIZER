/**
 * Effective access for admin UI (same rules as dashboard / users filter).
 * Paid active membership wins over demo; demo only when no paid window.
 * not_in_harmonizer = onboarded_at IS NULL (list filter only).
 */

export type AccessNowSeg = "trial" | "navigator" | "oracle" | "master";

export type AccessFilterSeg = AccessNowSeg | "not_in_harmonizer";

export const ACCESS_NOW_LABELS_RU: Record<AccessNowSeg, string> = {
  trial: "Демо",
  navigator: "Навигатор",
  oracle: "Наставник",
  master: "Мастер",
};

export const ACCESS_FILTER_LABELS_RU: Record<AccessFilterSeg, string> = {
  ...ACCESS_NOW_LABELS_RU,
  not_in_harmonizer: "Не в гармонизаторе",
};

function paidMembershipActive(row: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  nowMs: number;
}): "oracle" | "master" | null {
  const expires = row.membership_expires_at
    ? new Date(row.membership_expires_at).getTime()
    : null;
  const active = expires == null || expires > row.nowMs;
  if (!active) return null;
  if (row.membership_tier === "master") return "master";
  if (row.membership_tier === "oracle" || row.membership_tier === "practitioner") {
    return "oracle";
  }
  return null;
}

/** Effective access now. Paid > demo > navigator. */
export function accessNowSegment(row: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
  nowMs?: number;
}): AccessNowSeg {
  const now = row.nowMs ?? Date.now();
  const paid = paidMembershipActive({ ...row, nowMs: now });
  if (paid) return paid;
  if (row.trial_expires_at && new Date(row.trial_expires_at).getTime() > now) {
    return "trial";
  }
  return "navigator";
}

export function isActiveTrial(trialExpiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  return Boolean(trialExpiresAt && new Date(trialExpiresAt).getTime() > nowMs);
}

/** Has active paid membership (oracle/master), ignoring trial. */
export function hasActivePaidMembership(row: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  nowMs?: number;
}): boolean {
  return paidMembershipActive({ ...row, nowMs: row.nowMs ?? Date.now() }) !== null;
}

/**
 * Paid access still open, but subscription auto-renew was cancelled
 * (no active contract; has cancelled subscription contract).
 * Navigator / demo / no cancel history → false.
 */
export function isAutoRenewCancelled(opts: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  hasActiveSubscriptionContract: boolean;
  hasCancelledSubscriptionContract: boolean;
  nowMs?: number;
}): boolean {
  if (!hasActivePaidMembership(opts)) return false;
  if (opts.hasActiveSubscriptionContract) return false;
  return opts.hasCancelledSubscriptionContract;
}
