import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { loadCatalogRows, withLavaOffers } from "./catalogItem";

export const runtime = "nodejs";

/** Каталог продуктов: SKU ЮKassa (RUB) + привязанный оффер Lava (цены read-only). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const rows = await loadCatalogRows(db);
    const { items, lavaError } = await withLavaOffers(rows);
    return json({ items, lavaError });
  } catch (error) {
    return errorResponse(error);
  }
}
