import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { removeStorageObjects } from "../../_utils/storageCleanup";

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

/** Удаление одного сообщения + вложений. */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data: attachments, error: readError } = await db
      .from("support_message_attachments")
      .select("storage_path")
      .eq("message_id", id);
    if (readError) throw readError;

    const { error } = await db.from("support_messages").delete().eq("id", id);
    if (error) throw error;

    await removeStorageObjects(
      db,
      "support-attachments",
      (attachments ?? []).map((row) => row.storage_path),
    );
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
