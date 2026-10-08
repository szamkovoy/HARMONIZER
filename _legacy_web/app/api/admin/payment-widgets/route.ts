import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { normalizeWidgetConfig } from "../../../../lib/paymentWidget/config";

export const runtime = "nodejs";

const WIDGET_SELECT =
  "id, title, catalog_id, config, active, created_at, updated_at, catalog:payment_catalog(id, tier, title, amount, currency, product_kind)";

/** Виджеты оплаты для лендингов. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("payment_widgets")
      .select(WIDGET_SELECT)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return json({ items: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

type CreateBody = { title?: string; catalog_id?: string | null; config?: unknown; copy_from?: string };

/** Создать виджет; copy_from — копия существующего (конфиг и продукт). */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = ((await req.json().catch(() => null)) ?? {}) as CreateBody;
    const db = createServiceSupabase();

    let title = (body.title ?? "").trim();
    let catalogId = body.catalog_id ?? null;
    let config: unknown = body.config ?? {};
    if (body.copy_from) {
      const { data: src, error } = await db
        .from("payment_widgets")
        .select("title, catalog_id, config")
        .eq("id", body.copy_from)
        .maybeSingle();
      if (error) throw error;
      if (!src) return json({ error: "Виджет для копирования не найден" }, { status: 404 });
      title = title || `${src.title} (копия)`;
      catalogId = src.catalog_id;
      config = src.config;
    }
    if (!title) return json({ error: "Укажите название" }, { status: 400 });

    const { data, error } = await db
      .from("payment_widgets")
      .insert({ title: title.slice(0, 200), catalog_id: catalogId, config: normalizeWidgetConfig(config) })
      .select(WIDGET_SELECT)
      .single();
    if (error) throw error;
    return json({ item: data });
  } catch (error) {
    return errorResponse(error);
  }
}
