import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** Удаляет рассылку; notification_deliveries снимаются cascade. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    if (!id) return json({ error: "id обязателен" }, { status: 400 });

    const db = createServiceSupabase();
    const { error } = await db.from("notifications").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
