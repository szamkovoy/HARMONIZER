/**
 * Тариф на 30 дней разовой оплатой, без автопродления.
 * Продаётся, когда банк не пропускает оформление подписки (3‑D Secure).
 * В payment_contracts это one_time с tier oracle|master и product_ref TIER_PASS_REF.
 */
import { TIER_ORDER } from "../../../modules/access/core/tiers";

export const TIER_PASS_DAYS = 30;
export const TIER_PASS_REF = "pass_30d";

export type PassTier = "oracle" | "master";

export function isPassTier(tier: string | null | undefined): tier is PassTier {
  return tier === "oracle" || tier === "master";
}

export function isTierPassContract(contract: {
  product_kind?: string | null;
  tier?: string | null;
}): boolean {
  return contract.product_kind === "one_time" && isPassTier(contract.tier);
}

/** Имя оффера в payment_offers: отдельный разовый продукт Lava. */
export function lavaPassOfferName(tier: PassTier): string {
  return `${tier}_30d`;
}

/**
 * Конец оплаченного периода. Тот же тариф, ещё действующий, продлевается с его
 * конца; иначе 30 дней считаются от оплаты.
 */
export function tierPassPeriodEnd(params: {
  tier: PassTier;
  paidAt: Date;
  currentTier?: string | null;
  currentExpiresAt?: string | null;
}): Date {
  const paidMs = params.paidAt.getTime();
  let baseMs = paidMs;
  if (params.currentTier === params.tier && params.currentExpiresAt) {
    const currentMs = new Date(params.currentExpiresAt).getTime();
    if (Number.isFinite(currentMs) && currentMs > paidMs) baseMs = currentMs;
  }
  return new Date(baseMs + TIER_PASS_DAYS * 24 * 60 * 60 * 1000);
}

/** Есть ли уже доступ выше покупаемого тарифа (тогда 30 дней ниже не продаём). */
export function hasHigherPaidAccess(params: {
  tier: PassTier;
  currentTier?: string | null;
  currentExpiresAt?: string | null;
  now?: Date;
}): boolean {
  const current = params.currentTier as keyof typeof TIER_ORDER | null | undefined;
  if (!current || !(current in TIER_ORDER) || current === "free") return false;
  if (!params.currentExpiresAt) return false;
  const expiresMs = new Date(params.currentExpiresAt).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= (params.now ?? new Date()).getTime()) return false;
  return TIER_ORDER[current] > TIER_ORDER[params.tier];
}
