import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requiredEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env: ${names.join(" or ")}`);
}

export function createAnonSupabase(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function createServiceSupabase(): SupabaseClient {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function requireUserId(req: Request): Promise<string> {
  const token = bearerToken(req);
  if (!token) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const { data, error } = await createAnonSupabase().auth.getUser(token);
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  return data.user.id;
}

/**
 * Гейт админ-панели: валидный JWT + роль admin в public.user_roles.
 * Использовать в КАЖДОМ роуте app/api/admin/*. Возвращает userId админа.
 * Проверка роли идёт через service client (RLS user_roles разрешает читать
 * только свои строки, но нам нужен детерминированный ответ без RLS-нюансов).
 */
export async function requireAdmin(req: Request): Promise<string> {
  const userId = await requireUserId(req);
  const { data, error } = await createServiceSupabase()
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }
  return userId;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("[api]", message);
  return json({ error: message }, { status: 500 });
}
