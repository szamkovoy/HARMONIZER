/**
 * Book ownership — GET /api/account/purchases/book.
 *
 * Only HTTP 200 `{ owned: false }` means the account has no book.
 * Network, timeout, and 401/5xx are `unavailable`: the purchase may still
 * be active (admin grant or cabinet). Callers must not show the paywall then.
 */
import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken, getSupabaseSessionSnapshot } from "@/services/supabase";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

import type { BookAccessState } from "./bookAccessDecision";
import type { BookLocale } from "./bookIds";
import { loadReadingProgress } from "./readingProgress";

const BOOK_LOCALES: readonly BookLocale[] = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];

export type { BookAccessState, BookOpenDecision } from "./bookAccessDecision";
export { classifyBookOwnershipHttp, decideBookOpen } from "./bookAccessDecision";

function ownedFlagKey(userId: string): string {
  return `bookOwned.${userId}`;
}

async function rememberBookOwned(userId: string): Promise<void> {
  await writeAccountFlag(ownedFlagKey(userId), "1");
}

async function forgetBookOwned(userId: string): Promise<void> {
  await writeAccountFlag(ownedFlagKey(userId), "");
}

/** Prior confirmed purchase, or a reading progress file from an earlier open. */
export async function hasOfflineBookGrant(userId: string): Promise<boolean> {
  const flag = await readAccountFlag(ownedFlagKey(userId));
  if (flag?.trim()) return true;
  for (const locale of BOOK_LOCALES) {
    const progress = await loadReadingProgress(userId, locale);
    if (progress) return true;
  }
  return false;
}

async function fetchBookOwnershipOnce(): Promise<BookAccessState> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return { state: "unavailable" };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/account/purchases/book`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    // 401/5xx/timeout are not "no purchase" — a grant can still be active.
    if (res.status !== 200) {
      throw Object.assign(new Error(`book ownership HTTP ${res.status}`), { status: res.status });
    }
    const data = (await res.json()) as {
      owned?: boolean;
      contractId?: string;
      purchasedAt?: string;
    };
    if (data.owned !== true) return { state: "absent" };
    return {
      state: "owned",
      contractId: typeof data.contractId === "string" ? data.contractId : undefined,
      purchasedAt: typeof data.purchasedAt === "string" ? data.purchasedAt : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchBookOwnership(): Promise<BookAccessState> {
  try {
    return await withTransientNetworkRetry(fetchBookOwnershipOnce, {
      attempts: 3,
      delaysMs: [400, 900],
    });
  } catch {
    return { state: "unavailable" };
  }
}

export async function resolveBookAccess(): Promise<BookAccessState> {
  const session = await getSupabaseSessionSnapshot({ allowExpired: true });
  const userId = session?.user?.id ?? null;
  const access = await fetchBookOwnership();
  if (userId && access.state === "owned") await rememberBookOwned(userId);
  if (userId && access.state === "absent") await forgetBookOwned(userId);
  return access;
}
