import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Duplicate campaign as a new draft. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data: source, error } = await db
      .from("email_campaigns")
      .select("name, subject, html_body, subject_i18n, html_body_i18n, blocks_i18n, segment_query")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!source) return json({ error: "Кампания не найдена" }, { status: 404 });

    const { data, error: insertError } = await db
      .from("email_campaigns")
      .insert({
        status: "draft",
        name: source.name ? `${source.name} (копия)` : "Копия рассылки",
        subject: source.subject,
        html_body: source.html_body,
        subject_i18n: source.subject_i18n ?? {},
        html_body_i18n: source.html_body_i18n ?? {},
        blocks_i18n: source.blocks_i18n ?? {},
        segment_query: source.segment_query ?? {},
      })
      .select("*")
      .single();
    if (insertError) throw insertError;
    return json({ campaign: data });
  } catch (error) {
    return errorResponse(error);
  }
}
