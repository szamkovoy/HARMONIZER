import type { SupabaseClient } from "@supabase/supabase-js";

import { findLavaOffer, type LavaOffer, type LavaProduct } from "../../account/lava";

export const CATALOG_SELECT =
  "id, provider, tier, currency, amount, title, description, product_kind, active, updated_at, lava_offer_id, webinar_credits, webinar_window_days, letter_subject_i18n, letter_body_i18n, sort_order";

export type LavaOfferSummary = {
  offerId: string;
  offerName: string;
  productId: string;
  productTitle: string;
  prices: { currency: string; amount: number; periodicity: string }[];
};

export function summarizeLavaOffer(product: LavaProduct, offer: LavaOffer): LavaOfferSummary {
  return {
    offerId: offer.id,
    offerName: offer.name,
    productId: product.id,
    productTitle: product.title,
    prices: offer.prices.map((p) => ({
      currency: p.currency,
      amount: Number(p.amount),
      periodicity: p.periodicity,
    })),
  };
}

type CatalogRow = Record<string, unknown> & { lava_offer_id?: string | null };

/** Attach the Lava offer (title + prices) to catalog rows; Lava errors leave `lava: null`. */
export async function withLavaOffers<T extends CatalogRow>(
  rows: T[],
): Promise<{ items: (T & { lava: LavaOfferSummary | null })[]; lavaError: string | null }> {
  let lavaError: string | null = null;
  const items = await Promise.all(
    rows.map(async (row) => {
      if (!row.lava_offer_id || lavaError) return { ...row, lava: null };
      try {
        const found = await findLavaOffer(row.lava_offer_id);
        return { ...row, lava: found ? summarizeLavaOffer(found.product, found.offer) : null };
      } catch (err) {
        lavaError = err instanceof Error ? err.message : String(err);
        return { ...row, lava: null };
      }
    }),
  );
  return { items, lavaError };
}

export async function loadCatalogRows(db: SupabaseClient) {
  const { data, error } = await db
    .from("payment_catalog")
    .select(CATALOG_SELECT)
    .order("sort_order", { ascending: true })
    .order("tier", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CatalogRow[];
}
