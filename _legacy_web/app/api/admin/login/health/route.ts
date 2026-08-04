import { json } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function supabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return url.replace(/\/$/, "");
}

function anonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return key;
}

/**
 * Лёгкий wake/probe Auth + PostgREST перед повторным входом в админку.
 * Не логинит пользователя — только «будит» цепочку и сообщает статус.
 */
export async function GET(): Promise<Response> {
  const base = supabaseUrl();
  const key = anonKey();
  const headers: Record<string, string> = { apikey: key, Accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const restRes = await fetch(`${base}/rest/v1/user_roles?select=role&limit=1`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const authRes = await fetch(`${base}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: key },
      signal: controller.signal,
    }).catch(() => null);

    const restOk = restRes.ok;
    const authOk = authRes == null ? null : authRes.ok || authRes.status === 404;
    const ok = restOk && authOk !== false;
    return json(
      {
        ok,
        rest: { status: restRes.status, ok: restOk },
        auth: authRes ? { status: authRes.status, ok: Boolean(authOk) } : { status: 0, ok: null },
        hint: ok
          ? "Сервисы отвечают — можно войти снова"
          : "Auth/API всё ещё недоступны. Подождите 10–20 секунд и нажмите кнопку ещё раз. Если не помогает — Restart project в Supabase Dashboard.",
      },
      { status: ok ? 200 : 503 },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return json(
      {
        ok: false,
        error: aborted ? "timeout" : "unreachable",
        hint: "Нет ответа от Supabase. Подождите и нажмите «Восстановить связь», либо Restart project в Dashboard.",
      },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
