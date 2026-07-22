import type { SupabaseClient } from "@supabase/supabase-js";

export type CatalogTier = "oracle" | "master" | "webinar" | "book";

export type PaymentCatalogRow = {
  provider: string;
  tier: CatalogTier;
  currency: "RUB" | "USD" | "EUR";
  amount: number;
  title: string;
  description: string | null;
  product_kind: "subscription" | "one_time";
};

/**
 * Цена/title из `payment_catalog` (ЮKassa RUB). Бросает, если SKU нет / inactive.
 */
export async function resolveCatalogOffer(
  db: SupabaseClient,
  params: { provider: string; tier: CatalogTier; currency: string },
): Promise<PaymentCatalogRow> {
  const currency = params.currency.trim().toUpperCase();
  const { data, error } = await db
    .from("payment_catalog")
    .select("provider,tier,currency,amount,title,description,product_kind")
    .eq("provider", params.provider)
    .eq("tier", params.tier)
    .eq("currency", currency)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      `payment_catalog miss: provider=${params.provider} tier=${params.tier} currency=${currency}`,
    );
  }
  return {
    provider: data.provider,
    tier: data.tier as CatalogTier,
    currency: data.currency as PaymentCatalogRow["currency"],
    amount: Number(data.amount),
    title: data.title,
    description: data.description ?? null,
    product_kind: data.product_kind as PaymentCatalogRow["product_kind"],
  };
}

/** Цена для overview; null если SKU не сконфигурирован. */
export async function resolveCatalogPrice(
  db: SupabaseClient,
  params: { provider: string; tier: CatalogTier; currency: string },
): Promise<{ amount: number; currency: "RUB" | "USD" | "EUR" } | null> {
  try {
    const row = await resolveCatalogOffer(db, params);
    if (!Number.isFinite(row.amount) || row.amount <= 0) return null;
    return { amount: row.amount, currency: row.currency };
  } catch {
    return null;
  }
}
