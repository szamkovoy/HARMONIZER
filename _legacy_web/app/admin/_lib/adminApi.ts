import { getBrowserSupabase } from "./supabaseBrowser";

/** fetch к /api/admin/* с Bearer-токеном текущей сессии. Бросает Error с текстом сервера. */
export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
  opts?: { accessToken?: string },
): Promise<T> {
  let token = opts?.accessToken?.trim();
  if (!token) {
    const supabase = getBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
    // Refresh before admin calls — stale JWT after long edits / delete → "Unauthorized".
    if (token) {
      const expiresAt = data.session?.expires_at;
      const soon = typeof expiresAt === "number" && expiresAt * 1000 < Date.now() + 60_000;
      if (soon) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        token = refreshed.session?.access_token ?? token;
      }
    } else {
      const { data: refreshed } = await supabase.auth.refreshSession();
      token = refreshed.session?.access_token;
    }
  }
  if (!token) throw new Error("Сессия не найдена — войдите заново");

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;

  async function doFetch(accessToken: string) {
    return fetch(path, {
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
  }

  let res = await doFetch(token);
  if (res.status === 401) {
    const { data: refreshed } = await getBrowserSupabase().auth.refreshSession();
    const retryToken = refreshed.session?.access_token;
    if (retryToken && retryToken !== token) {
      res = await doFetch(retryToken);
    }
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Ошибка сервера (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}
