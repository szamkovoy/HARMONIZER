/**
 * Book ownership — Phase B:
 * - Production / preview: GET /api/account/purchases/book → owned.
 * - Development profile: optional EXPO_PUBLIC_BOOK_DEV_UNLOCK=true bypass (never in store).
 */
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

export type BookOwnership = {
  owned: boolean;
  contractId?: string;
  purchasedAt?: string;
};

function isDevelopmentAppEnv(): boolean {
  return (process.env.EXPO_PUBLIC_APP_ENV ?? "").trim().toLowerCase() === "development";
}

function isDevUnlockEnabled(): boolean {
  if (!isDevelopmentAppEnv()) return false;
  const raw = (process.env.EXPO_PUBLIC_BOOK_DEV_UNLOCK ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function fetchBookOwnership(): Promise<BookOwnership> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return { owned: false };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/account/purchases/book`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return { owned: false };
    const data = (await res.json()) as {
      owned?: boolean;
      contractId?: string;
      purchasedAt?: string;
    };
    return {
      owned: data.owned === true,
      contractId: typeof data.contractId === "string" ? data.contractId : undefined,
      purchasedAt: typeof data.purchasedAt === "string" ? data.purchasedAt : undefined,
    };
  } catch {
    return { owned: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveBookAccess(): Promise<boolean> {
  if (isDevUnlockEnabled()) return true;
  const ownership = await fetchBookOwnership();
  return ownership.owned;
}
