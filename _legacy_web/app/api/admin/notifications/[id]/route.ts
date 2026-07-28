import { asContentLocale } from "../../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { parseSegment, segmentLabel } from "../segment";
import { sendExistingNotification } from "../sendNotification";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

function cleanI18nMap(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "ru") continue;
    const locale = asContentLocale(key);
    const text = typeof value === "string" ? value.trim() : "";
    if (locale && text) out[locale] = text;
  }
  return out;
}

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

type PatchPayload = {
  title?: string;
  body?: string;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  link_url?: string | null;
  segment?: string;
};

/** Update draft content (refuses if already sent). */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) return json({ error: "id обязателен" }, { status: 400 });

    const db = createServiceSupabase();
    const { data: existing, error: readError } = await db
      .from("notifications")
      .select("id, sent_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return json({ error: "Уведомление не найдено" }, { status: 404 });
    if (existing.sent_at) {
      return json({ error: "Отправленное уведомление нельзя редактировать" }, { status: 409 });
    }

    const payload = (await req.json()) as PatchPayload;
    const patch: Record<string, unknown> = {};
    if (typeof payload.title === "string") patch.title = payload.title.trim();
    if (typeof payload.body === "string") patch.body = payload.body;
    if (payload.title_i18n !== undefined) patch.title_i18n = cleanI18nMap(payload.title_i18n);
    if (payload.body_i18n !== undefined) patch.body_i18n = cleanI18nMap(payload.body_i18n);
    if (payload.link_url !== undefined) {
      patch.link_url = payload.link_url?.trim() || null;
    }
    if (typeof payload.segment === "string" && payload.segment.trim()) {
      const segmentRaw = payload.segment.trim();
      const segment = parseSegment(segmentRaw);
      patch.segment = segmentRaw;
      patch.segment_label = await segmentLabel(db, segment);
    }

    const { data: notification, error } = await db
      .from("notifications")
      .update(patch)
      .eq("id", id)
      .select(
        "id, title, body, title_i18n, body_i18n, link_url, segment, segment_label, recipient_count, push_sent_count, push_error_count, sent_at, created_at",
      )
      .single();
    if (error) throw error;
    return json({ notification });
  } catch (error) {
    return errorResponse(error);
  }
}

async function deleteNotification(id: string) {
  const db = createServiceSupabase();
  const { data, error } = await db.from("notifications").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) return json({ error: "Уведомление не найдено" }, { status: 404 });
  return json({ ok: true });
}

/** Удаляет рассылку; notification_deliveries снимаются cascade. */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) return json({ error: "id обязателен" }, { status: 400 });
    return await deleteNotification(id);
  } catch (error) {
    return errorResponse(error);
  }
}

type PostBody = { action?: string };

/**
 * POST actions: delete | send
 * (delete also available via DELETE; POST kept for proxies.)
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    if (!id?.trim()) return json({ error: "id обязателен" }, { status: 400 });

    let action = "delete";
    try {
      const body = (await req.json()) as PostBody;
      if (body?.action) action = body.action;
    } catch {
      /* bodyless → delete (legacy) */
    }

    if (action === "delete") {
      return await deleteNotification(id);
    }

    if (action === "send") {
      const db = createServiceSupabase();
      try {
        const result = await sendExistingNotification(db, id);
        return json(result);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status && error instanceof Error) {
          return json(
            {
              error: error.message,
              skipped_no_locale_copy: (
                error as Error & { skipped_no_locale_copy?: number }
              ).skipped_no_locale_copy,
            },
            { status },
          );
        }
        throw error;
      }
    }

    return json({ error: `Неизвестное действие: ${action}` }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
