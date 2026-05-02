import { getAiGlobalContentUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация для сброса дневного контента.");
  return token;
}

/**
 * Тестовый сброс: POST /api/ai/global-content с `{ "devReset": true }`, затем на клиенте — refresh и remount ассистента.
 */
export async function postGlobalContentDevReset(signal?: AbortSignal): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(getAiGlobalContentUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ devReset: true }),
    signal,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
}
