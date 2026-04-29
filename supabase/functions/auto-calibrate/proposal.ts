export const PROPOSAL_TTL_DAYS = 14;
export const FALLBACK_TTL_DAYS = 30;
export const REJECTED_COOLDOWN_DAYS = 30;

export interface AutoCalibrationProposal {
  status: "pending" | "accepted" | "rejected" | "expired" | string;
  createdAt?: string;
  suggestedAt?: string;
  expiresAt?: string;
  digestId?: string;
  respondedAt?: string;
}

function proposalCreatedAt(proposal: AutoCalibrationProposal): string | undefined {
  return proposal.createdAt ?? proposal.suggestedAt;
}

export function isPendingProposal(proposal?: AutoCalibrationProposal | null): boolean {
  if (!proposal) return false;
  if (proposal.status !== "pending") return false;

  const now = new Date();

  if (proposal.expiresAt) {
    return new Date(proposal.expiresAt) > now;
  }

  const created = proposalCreatedAt(proposal);
  if (created) {
    const fallbackExpiry = new Date(created);
    fallbackExpiry.setUTCDate(fallbackExpiry.getUTCDate() + FALLBACK_TTL_DAYS);
    return fallbackExpiry > now;
  }

  console.warn("[auto-calibrate] Found proposal without expiresAt or createdAt/suggestedAt, ignoring", proposal);
  return false;
}

export function isRejectedRecently(proposal?: AutoCalibrationProposal | null): boolean {
  if (!proposal) return false;
  if (proposal.status !== "rejected") return false;

  const respondedAt = proposal.respondedAt ?? proposalCreatedAt(proposal);
  if (!respondedAt) return false;

  const cooldownEnd = new Date(respondedAt);
  cooldownEnd.setUTCDate(cooldownEnd.getUTCDate() + REJECTED_COOLDOWN_DAYS);

  return cooldownEnd > new Date();
}
