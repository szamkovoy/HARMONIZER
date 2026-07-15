import { createServiceSupabase, errorResponse, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Streams a support attachment through the admin API (Bearer auth).
 * Private-bucket signed URLs often open blank from the browser; this path is reliable.
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) {
      return new Response(JSON.stringify({ error: "id обязателен" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const db = createServiceSupabase();
    const { data: row, error } = await db
      .from("support_message_attachments")
      .select("storage_path, mime_type")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!row?.storage_path) {
      return new Response(JSON.stringify({ error: "Файл не найден" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const { data: file, error: downloadError } = await db.storage
      .from("support-attachments")
      .download(row.storage_path);
    if (downloadError || !file) {
      return new Response(
        JSON.stringify({ error: downloadError?.message ?? "Не удалось скачать файл" }),
        {
          status: 502,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        },
      );
    }

    const filename = row.storage_path.split("/").pop() || "attachment";
    const bytes = await file.arrayBuffer();
    // RN Blob uploads previously created 0-byte objects (metadata ok, body empty).
    if (bytes.byteLength === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Файл в хранилище пустой — скорее всего не загрузился с устройства. Попросите пользователя отправить скриншот ещё раз.",
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        },
      );
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": row.mime_type || file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
