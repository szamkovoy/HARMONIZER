import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Отметка «обработано» ({ processed: boolean }). */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as { processed?: boolean };
    if (payload.processed === undefined) {
      return json({ error: "Нет полей для обновления" }, { status: 400 });
    }
    const { data, error } = await createServiceSupabase()
      .from("support_messages")
      .update({ processed_at: payload.processed ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id, processed_at")
      .single();
    if (error) throw error;
    return json({ message: data });
  } catch (error) {
    return errorResponse(error);
  }
}
