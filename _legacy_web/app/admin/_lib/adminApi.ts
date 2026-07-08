import { getBrowserSupabase } from "./supabaseBrowser";

/** fetch к /api/admin/* с Bearer-токеном текущей сессии. Бросает Error с текстом сервера. */
export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Сессия не найдена — войдите заново");

  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Ошибка сервера (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}
