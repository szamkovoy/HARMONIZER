import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function deleteNotification(req: Request, ctx: RouteContext) {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!id?.trim()) return json({ error: "id обязателен" }, { status: 400 });

  const db = createServiceSupabase();
  const { data, error } = await db.from("notifications").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) return json({ error: "Уведомление не найдено" }, { status: 404 });
  return json({ ok: true });
}

/** Удаляет рассылку; notification_deliveries снимаются cascade. */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    return await deleteNotification(req, ctx);
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Тот же delete через POST — запасной путь, если DELETE режется прокси
 * или bodyless DELETE с Content-Type ломает запрос.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    return await deleteNotification(req, ctx);
  } catch (error) {
    return errorResponse(error);
  }
}
