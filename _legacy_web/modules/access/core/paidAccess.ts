/**
 * Единственный источник правила «есть ли у пользователя платный доступ»
 * по сырым полям строки `public.users`. Используется и мобильным клиентом,
 * и сервером `_legacy_web` (import "@/modules/access/core/paidAccess") —
 * см. open_questions «Условие premium ИЛИ (free И trial) дублируется».
 *
 * Модель после миграции 20260708010000_admin_panel_tier_foundation:
 *   paid  = membership_tier ∈ {oracle, practitioner, master}
 *           И (membership_expires_at пуст ИЛИ в будущем);
 *   trial = trial_expires_at в будущем (полный доступ уровня master);
 *   free  = всё остальное, включая истёкший платный грант.
 *
 * Legacy-значение "premium" поддерживается на переходный период (маппится
 * в oracle), пока все строки БД не нормализованы миграцией.
 */

import type { ProductTier } from "./tiers";

export type MembershipRow = {
  membership_tier?: string | null;
  trial_expires_at?: string | null;
  membership_expires_at?: string | null;
} | null | undefined;

const PAID_TIERS: readonly ProductTier[] = ["oracle", "practitioner", "master"];

function membershipExpired(row: MembershipRow, now: Date): boolean {
  if (!row?.membership_expires_at) return false;
  return new Date(row.membership_expires_at).getTime() <= now.getTime();
}

/** Оплаченный (не trial) тариф из строки БД с учётом срока действия; null если его нет. */
export function paidTierFromRow(row: MembershipRow, now: Date = new Date()): ProductTier | null {
  const raw = typeof row?.membership_tier === "string" ? row.membership_tier.trim().toLowerCase() : "";
  const tier: ProductTier | null =
    raw === "premium" ? "oracle" : (PAID_TIERS as readonly string[]).includes(raw) ? (raw as ProductTier) : null;
  if (!tier) return null;
  return membershipExpired(row, now) ? null : tier;
}

/** Активен ли пробный период (полный доступ уровня master). */
export function hasActiveTrial(row: MembershipRow, now: Date = new Date()): boolean {
  if (!row?.trial_expires_at) return false;
  return new Date(row.trial_expires_at).getTime() > now.getTime();
}

/** «Премиум-доступ» в широком смысле: оплаченный тариф ИЛИ активный trial. */
export function hasEffectivePremium(row: MembershipRow, now: Date = new Date()): boolean {
  return paidTierFromRow(row, now) !== null || hasActiveTrial(row, now);
}

/** Базовый тариф из строки БД (без учёта trial): paid-тариф или free. */
export function baseTierFromRow(row: MembershipRow, now: Date = new Date()): ProductTier {
  return paidTierFromRow(row, now) ?? "free";
}

/** Режим доступа для кэша/загрузки дневного контента (см. useDayContent / globalContentClient). */
export function accessModeFromRow(row: MembershipRow, now: Date = new Date()): "premium" | "trial" | "free" {
  if (paidTierFromRow(row, now)) return "premium";
  return hasActiveTrial(row, now) ? "trial" : "free";
}
