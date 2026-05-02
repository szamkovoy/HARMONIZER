/** Row fields needed to mirror client `hasPremiumAccess` / `accessModeFor`. */
export type UserModelAccessRow = {
  membership_tier?: string | null;
  trial_expires_at?: string | null;
};

export function hasPremiumLlmAccess(user: UserModelAccessRow | null | undefined): boolean {
  if (!user) return false;
  if (user.membership_tier === "premium") return true;
  if (user.membership_tier === "free" && user.trial_expires_at) {
    return new Date(user.trial_expires_at).getTime() > Date.now();
  }
  return false;
}

/**
 * Поверхностные ответы ассистента (greeting, responder stream, коррекции текста):
 * для платного/триала — всегда tier `premium` → `AI_MODEL_PREMIUM` из env.
 * Оркестратор (JSON) остаётся на hint из БД (обычно standard).
 */
export function dialogSurfaceModelHint(
  promptHint: string | null | undefined,
  user: UserModelAccessRow | null | undefined,
): string {
  if (hasPremiumLlmAccess(user)) return "premium";
  return promptHint?.trim() || "standard";
}
