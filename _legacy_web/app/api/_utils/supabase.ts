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
  const user = await requireUser(req);
  return user.id;
}

/** JWT → id + email. Prefer this over auth.admin.getUserById (flaky with sb_secret keys). */
export async function requireUser(req: Request): Promise<{ id: string; email: string | null }> {
  const token = bearerToken(req);
  if (!token) throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  // Anon first; if apikey/JWT signing keys рассинхронились — service-role getUser
  // (тот же Auth /user, другой apikey). Не путать с admin.getUserById.
  const anon = await createAnonSupabase().auth.getUser(token);
  if (!anon.error && anon.data.user) {
    return {
      id: anon.data.user.id,
      email: anon.data.user.email?.trim() || null,
    };
  }

  const viaService = await createServiceSupabase().auth.getUser(token);
  if (!viaService.error && viaService.data.user) {
    return {
      id: viaService.data.user.id,
      email: viaService.data.user.email?.trim() || null,
    };
  }

  throw new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
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
  const message = extractErrorMessage(error);
  console.error("[api]", message, error);
  return json({ error: message }, { status: 500 });
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; error_description?: unknown; details?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error_description === "string" && record.error_description.trim()) {
      return record.error_description;
    }
    if (typeof record.details === "string" && record.details.trim()) return record.details;
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Internal server error";
}
