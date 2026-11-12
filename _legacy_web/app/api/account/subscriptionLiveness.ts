/**
 * Единое правило «подписка действует»: status=active и конец оплаченного
 * периода + 48 ч грейса ещё не прошёл. Контракт без продления (Lava
 * subscription-failed, ЮKassa без сохранённого метода) перестаёт считаться
 * действующим сам, даже если строка ещё не переведена в cancelled.
 * SQL-зеркало: restore_membership_from_ledger / lapse_stale_subscriptions.
 */
export const SUBSCRIPTION_GRACE_MS = 48 * 60 * 60 * 1000;

export type LivenessRow = { status?: string | null; current_period_end?: string | null };

export function subscriptionIsLive(row: LivenessRow, now: Date = new Date()): boolean {
  if (row.status !== "active") return false;
  if (!row.current_period_end) return true;
  const endMs = new Date(row.current_period_end).getTime();
  if (!Number.isFinite(endMs)) return true;
  return endMs + SUBSCRIPTION_GRACE_MS > now.getTime();
}

/** Что кабинет показывает как «подписку»: действующую или отменённую с ещё не истёкшим периодом. */
export function subscriptionIsVisible(row: LivenessRow, now: Date = new Date()): boolean {
  if (row.status === "active") return subscriptionIsLive(row, now);
  if (row.status !== "cancelled" || !row.current_period_end) return false;
  const endMs = new Date(row.current_period_end).getTime();
  return Number.isFinite(endMs) && endMs > now.getTime();
}
