import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { normalizeWidgetConfig } from "../../../../../lib/paymentWidget/config";

export const runtime = "nodejs";

const SELECT =
  "id, title, catalog_id, config, active, created_at, updated_at, catalog:payment_catalog(id, tier, title, amount, currency, product_kind)";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data, error } = await db.from("payment_widgets").select(SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Not found" }, { status: 404 });
    return json({ item: { ...data, config: normalizeWidgetConfig(data.config) } });
  } catch (error) {
    return errorResponse(error);
  }
}

type PatchBody = { title?: string; catalog_id?: string | null; config?: unknown; active?: boolean };

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as PatchBody | null;
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return json({ error: "Укажите название" }, { status: 400 });
      patch.title = title.slice(0, 200);
    }
    if (body.catalog_id !== undefined) patch.catalog_id = body.catalog_id || null;
    if (body.config !== undefined) patch.config = normalizeWidgetConfig(body.config);
    if (body.active !== undefined) patch.active = Boolean(body.active);

    const db = createServiceSupabase();
    const { data, error } = await db.from("payment_widgets").update(patch).eq("id", id).select(SELECT).maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Not found" }, { status: 404 });
    return json({ item: { ...data, config: normalizeWidgetConfig(data.config) } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { error } = await db.from("payment_widgets").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
