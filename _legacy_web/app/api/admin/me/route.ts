import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Проверка «я админ» для гейта UI. 200 → admin, 401/403 → нет. */
export async function GET(req: Request) {
  try {
    const userId = await requireAdmin(req);
    const { data } = await createServiceSupabase()
      .from("users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    return json({ userId, displayName: data?.display_name ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
