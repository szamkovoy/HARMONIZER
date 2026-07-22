import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Каталог SKU ЮKassa (и задел под другие provider). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("payment_catalog")
      .select(
        "id, provider, tier, currency, amount, title, description, product_kind, active, updated_at",
      )
      .order("provider", { ascending: true })
      .order("tier", { ascending: true });
    if (error) throw error;
    return json({ items: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}
