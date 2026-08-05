/** Flag on `public.users` for App Store / Play review demo account. */
export function isStoreReviewAccount(
  profile: { store_review_account?: boolean | null } | null | undefined,
): boolean {
  return Boolean(profile?.store_review_account);
}
