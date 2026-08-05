/**
 * Store-review login (App Store / Google Play Notes).
 * Secrets: STORE_REVIEW_EMAIL + STORE_REVIEW_OTP (server only — never EXPO_PUBLIC_*).
 */

export function normalizeStoreReviewEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeStoreReviewOtp(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export function getStoreReviewEmail(): string {
  return normalizeStoreReviewEmail(process.env.STORE_REVIEW_EMAIL ?? "");
}

export function getStoreReviewOtp(): string {
  return normalizeStoreReviewOtp(process.env.STORE_REVIEW_OTP ?? "");
}

export function isStoreReviewEmail(email: string): boolean {
  const allow = getStoreReviewEmail();
  if (!allow) return false;
  return normalizeStoreReviewEmail(email) === allow;
}

/** Constant-time compare for the fixed review OTP (after length check). */
export function otpMatchesStoreReview(code: string): boolean {
  const expected = getStoreReviewOtp();
  if (!expected) return false;
  const actual = normalizeStoreReviewOtp(code);
  if (actual.length !== expected.length) return false;
  let out = 0;
  for (let i = 0; i < actual.length; i++) {
    out |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return out === 0;
}

export function storeReviewSecretsConfigured(): boolean {
  return Boolean(getStoreReviewEmail() && getStoreReviewOtp());
}
