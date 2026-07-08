import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Модерация: скрыть/показать комментарий ({ is_hidden }). */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as { is_hidden?: boolean };
    if (payload.is_hidden === undefined) {
      return json({ error: "Нет полей для обновления" }, { status: 400 });
    }
    const { data, error } = await createServiceSupabase()
      .from("comments")
      .update({ is_hidden: payload.is_hidden })
      .eq("id", id)
      .select("id, is_hidden")
      .single();
    if (error) throw error;
    return json({ comment: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const { error } = await createServiceSupabase().from("comments").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
