/**
 * Pure book-gate decisions. Kept out of `bookAccess.ts` so tests do not load
 * the filesystem / Supabase clients.
 *
 * `absent` is the only answer that means “this account has no book”.
 * `unavailable` is a failed check (network, timeout, 401, 5xx).
 */
export type BookAccessState =
  | { state: "owned"; contractId?: string; purchasedAt?: string }
  | { state: "absent" }
  | { state: "unavailable" };

export type BookOpenDecision = "open" | "gate" | "retry";

export function classifyBookOwnershipHttp(
  status: number,
  owned: boolean | undefined,
): BookAccessState["state"] {
  if (status === 200) return owned === true ? "owned" : "absent";
  return "unavailable";
}

/**
 * A failed check opens the book only when this device already confirmed
 * the purchase or has local reading progress. Otherwise ask to retry —
 * never the paywall.
 */
export function decideBookOpen(access: BookAccessState, offlineGrant: boolean): BookOpenDecision {
  if (access.state === "owned") return "open";
  if (access.state === "absent") return "gate";
  return offlineGrant ? "open" : "retry";
}
