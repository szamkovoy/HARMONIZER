import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/**
 * Список/поиск пользователей: ?q=<имя или email>&tier=<free|oracle|practitioner|master>.
 * Идёт через RPC admin_search_users (security definer с join на auth.users),
 * потому что public.users не хранит email.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || null;
    const tier = url.searchParams.get("tier")?.trim() || null;

    const { data, error } = await createServiceSupabase().rpc("admin_search_users", {
      p_query: q,
      p_tier: tier,
      p_limit: 100,
    });
    if (error) throw error;

    return json({ users: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}
