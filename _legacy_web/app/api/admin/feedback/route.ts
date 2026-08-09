import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { emailsByUserId } from "../_utils/authEmails";
import { removeStorageObjects } from "../_utils/storageCleanup";

export const runtime = "nodejs";

type AttachmentRow = {
  id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  sort_order: number;
};

const DEFAULT_LIMIT = 50;

/** Входящие сообщения поддержки. ?limit=&offset= — свежие сверху; unprocessedCount отдельно. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(100, Math.floor(rawLimit))
        : DEFAULT_LIMIT;
    const rawOffset = Number(url.searchParams.get("offset") ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

    const db = createServiceSupabase();
    const [listRes, totalRes, unprocessedRes] = await Promise.all([
      db
        .from("support_messages")
        .select(
          "id, user_id, body, created_at, processed_at, users(display_name, membership_tier), support_message_attachments(id, storage_path, mime_type, size_bytes, sort_order)",
        )
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1),
      db.from("support_messages").select("id", { count: "exact", head: true }),
      db
        .from("support_messages")
        .select("id", { count: "exact", head: true })
        .is("processed_at", null),
    ]);
    if (listRes.error) throw listRes.error;
    if (totalRes.error) throw totalRes.error;
    if (unprocessedRes.error) throw unprocessedRes.error;

    const data = listRes.data ?? [];
    const emails = await emailsByUserId(db, [...new Set(data.map((m) => m.user_id))]);

    // Attachments: metadata only. Bytes via GET /api/admin/feedback/attachments/[id]
    // (Bearer) — private-bucket signed URLs open blank in the browser.
    const messages = data.map((m) => {
      const user = m.users as { display_name?: string | null; membership_tier?: string | null } | null;
      const rawAttachments = (
        (m as { support_message_attachments?: AttachmentRow[] | null }).support_message_attachments ?? []
      )
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order);

      const attachments = rawAttachments.map((att) => ({
        id: att.id,
        mime_type: att.mime_type,
        size_bytes: att.size_bytes,
        sort_order: att.sort_order,
      }));

      return {
        id: m.id,
        user_id: m.user_id,
        body: m.body,
        created_at: m.created_at,
        processed_at: m.processed_at,
        display_name: user?.display_name?.trim() || "—",
        email: emails.get(m.user_id) ?? "—",
        membership_tier: user?.membership_tier ?? "free",
        attachments,
      };
    });

    return json({
      messages,
      total: totalRes.count ?? 0,
      unprocessedCount: unprocessedRes.count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Массовое удаление сообщений + файлов в Storage. */
export async function DELETE(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as { ids?: string[] };
    const ids = Array.isArray(payload.ids)
      ? [...new Set(payload.ids.filter((id) => typeof id === "string" && id.trim()))]
      : [];
    if (ids.length === 0) return json({ error: "ids обязательны" }, { status: 400 });

    const db = createServiceSupabase();
    const { data: attachments, error: readError } = await db
      .from("support_message_attachments")
      .select("storage_path")
      .in("message_id", ids);
    if (readError) throw readError;

    const { error: deleteError } = await db.from("support_messages").delete().in("id", ids);
    if (deleteError) throw deleteError;

    await removeStorageObjects(
      db,
      "support-attachments",
      (attachments ?? []).map((row) => row.storage_path),
    );

    return json({ ok: true, deleted: ids.length });
  } catch (error) {
    return errorResponse(error);
  }
}
