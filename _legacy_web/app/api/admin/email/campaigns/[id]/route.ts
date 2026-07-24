import { asContentLocale } from "../../../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

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

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data: campaign, error } = await db
      .from("email_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!campaign) return json({ error: "Кампания не найдена" }, { status: 404 });

    const { data: recentEvents } = await db
      .from("email_events")
      .select("id, event_type, created_at, resend_id")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    return json({ campaign, events: recentEvents ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

type PatchPayload = {
  name?: string;
  subject?: string;
  html_body?: string;
  subject_i18n?: Record<string, string>;
  html_body_i18n?: Record<string, string>;
  blocks_i18n?: Record<string, unknown>;
  segment_query?: Record<string, unknown>;
};

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as PatchPayload;
    const db = createServiceSupabase();

    const { data: existing, error: loadError } = await db
      .from("email_campaigns")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!existing) return json({ error: "Кампания не найдена" }, { status: 404 });
    if (existing.status === "sending") {
      return json({ error: "Кампания уже отправляется" }, { status: 409 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof payload.name === "string") patch.name = payload.name.trim();
    if (typeof payload.subject === "string") patch.subject = payload.subject.trim();
    if (typeof payload.html_body === "string") patch.html_body = payload.html_body.trim();
    if (payload.subject_i18n) patch.subject_i18n = cleanI18nMap(payload.subject_i18n);
    if (payload.html_body_i18n) patch.html_body_i18n = cleanI18nMap(payload.html_body_i18n);
    if (payload.blocks_i18n && typeof payload.blocks_i18n === "object") {
      patch.blocks_i18n = payload.blocks_i18n;
    }
    if (payload.segment_query && typeof payload.segment_query === "object") {
      patch.segment_query = payload.segment_query;
    }
    if (existing.status === "sent") {
      return json(
        { error: "Отправленную кампанию нельзя править — скопируйте её" },
        { status: 409 },
      );
    }

    const { data, error } = await db
      .from("email_campaigns")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return json({ campaign: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data: existing } = await db
      .from("email_campaigns")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return json({ error: "Кампания не найдена" }, { status: 404 });
    if (existing.status === "sending") {
      return json({ error: "Нельзя удалить кампанию во время отправки" }, { status: 409 });
    }
    const { error } = await db.from("email_campaigns").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
