/**
 * Удаление аккаунта: Bearer JWT → DELETE /api/account/delete.
 * Сервер отменяет подписки у всех платёжных провайдеров, сохраняет
 * платёжный леджер и удаляет auth-пользователя.
 */
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

export async function deleteAccountRemote(): Promise<void> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw new Error("Auth session required");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/account/delete`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
