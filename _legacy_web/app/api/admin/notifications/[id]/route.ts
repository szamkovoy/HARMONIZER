import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** One notification + delivery counts for admin detail. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) return json({ error: "id обязателен" }, { status: 400 });

    const db = createServiceSupabase();
    const { data: notification, error } = await db
      .from("notifications")
      .select(
        "id, title, body, title_i18n, body_i18n, link_url, segment, segment_label, recipient_count, push_sent_count, push_error_count, sent_at, created_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!notification) return json({ error: "Уведомление не найдено" }, { status: 404 });

    const { count, error: countError } = await db
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", id);
    if (countError) throw countError;

    return json({
      notification,
      delivery_count: count ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

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
