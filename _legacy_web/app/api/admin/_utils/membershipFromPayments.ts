import { isPaidProductTier, TIER_ORDER, type PaidProductTier } from "@/modules/access/core/tiers";

export type PaymentMembershipRow = {
  tier: string;
  paid_until: string | null;
  created_at: string;
};

export type ActiveMembership = {
  tier: PaidProductTier;
  paid_until: string | null;
};

function isActivePayment(paidUntil: string | null, nowMs: number): boolean {
  if (paidUntil == null) return true;
  const untilMs = Date.parse(paidUntil);
  if (Number.isNaN(untilMs)) return false;
  return untilMs > nowMs;
}

function paidUntilRank(paidUntil: string | null): number {
  // null = бессрочно → «дальше всех»
  if (paidUntil == null) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(paidUntil);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Среди ещё действующих платежей выбирает победителя:
 * 1) максимальный тариф по TIER_ORDER;
 * 2) при равенстве — более поздний paid_until (null побеждает);
 * 3) при полном равенстве — более свежий created_at.
 * Нет действующих → null (пользователь должен стать free).
 */
export function selectActiveMembershipFromPayments(
  payments: readonly PaymentMembershipRow[],
  now: Date = new Date(),
): ActiveMembership | null {
  const nowMs = now.getTime();
  let winner: (PaymentMembershipRow & { tier: PaidProductTier }) | null = null;

  for (const payment of payments) {
    if (!isPaidProductTier(payment.tier)) continue;
    if (!isActivePayment(payment.paid_until, nowMs)) continue;

    if (!winner) {
      winner = { ...payment, tier: payment.tier };
      continue;
    }

    const tierDelta = TIER_ORDER[payment.tier] - TIER_ORDER[winner.tier];
    if (tierDelta > 0) {
      winner = { ...payment, tier: payment.tier };
      continue;
    }
    if (tierDelta < 0) continue;

    const untilDelta = paidUntilRank(payment.paid_until) - paidUntilRank(winner.paid_until);
    if (untilDelta > 0) {
      winner = { ...payment, tier: payment.tier };
      continue;
    }
    if (untilDelta < 0) continue;

    if (Date.parse(payment.created_at) > Date.parse(winner.created_at)) {
      winner = { ...payment, tier: payment.tier };
    }
  }

  return winner ? { tier: winner.tier, paid_until: winner.paid_until } : null;
}
