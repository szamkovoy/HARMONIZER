import { errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { listLavaProducts } from "../../account/lava";
import { summarizeLavaOffer } from "../payment-catalog/catalogItem";

export const runtime = "nodejs";

/** Все офферы автора в Lava (для привязки к продукту каталога). ?fresh=1 — мимо кэша. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    const products = await listLavaProducts({ fresh });
    const offers = products.flatMap((product) =>
      product.offers.map((offer) => summarizeLavaOffer(product, offer)),
    );
    return json({ offers });
  } catch (error) {
    return errorResponse(error);
  }
}
