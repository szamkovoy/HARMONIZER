import { hasEffectivePremium, type MembershipRow } from "@/modules/access/core/paidAccess";

/** Row fields needed to mirror client `hasEffectivePremium` / `accessModeFromRow`. */
export type UserModelAccessRow = MembershipRow;

/**
 * Платный LLM-доступ: оплаченный тариф (oracle/practitioner/master, с учётом
 * membership_expires_at) ИЛИ активный trial. Правило — общее с клиентом,
 * живёт в `modules/access/core/paidAccess.ts`.
 */
export function hasPremiumLlmAccess(user: UserModelAccessRow): boolean {
  return hasEffectivePremium(user);
}

/**
 * Поверхностные ответы ассистента (greeting, responder stream, коррекции текста):
 * для платного/триала — всегда tier `premium` → `AI_MODEL_PREMIUM` из env.
 * Оркестратор (JSON) остаётся на hint из БД (обычно standard).
 * Резолв id модели и резерв при 503/429 — в `getModelByHint` (`_legacy_web/app/api/_utils/gemini.ts`), не здесь.
 */
export function dialogSurfaceModelHint(
  promptHint: string | null | undefined,
  user: UserModelAccessRow,
): string {
  if (hasPremiumLlmAccess(user)) return "premium";
  return promptHint?.trim() || "standard";
}
