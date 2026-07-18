/**
 * Клиент последней разовой покупки (ONE_TIME) — книга/вебинар/курс.
 *
 * payment_contracts закрыт для клиента (RLS без политик), поэтому приложение
 * читает последнюю активную разовую покупку через service-role эндпоинт
 * GET /api/account/purchases/last (Bearer JWT Supabase).
 *
 * Используется MembershipEventsBridge: после возврата из Личного кабинета
 * сравниваем createdAt покупки с временем визита (cabinetVisit) и благодарим
 * за покупку, появившуюся после визита.
 */
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

export type LastPurchase = {
  /** tier из payment_contracts для one_time: "book" | "webinar" | ... */
  kind: string;
  productRef: string | null;
  createdAt: string;
  contractId: string;
};

export async function fetchLastPurchase(): Promise<LastPurchase | null> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/account/purchases/last`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { purchase: LastPurchase | null };
    return data.purchase ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
