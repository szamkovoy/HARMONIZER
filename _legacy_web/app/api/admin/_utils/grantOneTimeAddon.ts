import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const ONE_TIME_ADDON_TIERS = new Set(["book", "webinar"]);

type GrantParams = {
  userId: string;
  tier: "book" | "webinar";
  amount: number;
  currency: string;
  comment: string | null;
  /** Optional webinar id; if omitted for webinar, nearest future published is used. */
  productRef?: string | null;
};

/**
 * Manual admin grant for one-time addons (book / webinar).
 * Writes `payment_contracts` (what the app checks) — not the membership `payments` ledger
 * (that table only allows oracle/practitioner/master).
 */
export async function grantOneTimeAddon(
  db: SupabaseClient,
  params: GrantParams,
): Promise<{ contractId: string; productRef: string | null }> {
  let productRef = params.productRef?.trim() || null;

  if (params.tier === "webinar" && !productRef) {
    const { data: next, error } = await db
      .from("webinars")
      .select("id")
      .eq("is_published", true)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!next?.id) {
      throw new Error(
        "Нет ближайшего опубликованного вебинара — укажите вебинар или опубликуйте анонс",
      );
    }
    productRef = next.id;
  }

  const contractId = `manual-${params.tier}-${randomUUID()}`;
  const nowIso = new Date().toISOString();
  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: params.userId,
    contract_id: contractId,
    provider: "manual",
    tier: params.tier,
    currency: params.currency,
    amount: params.amount,
    periodicity: "ONE_TIME",
    product_kind: "one_time",
    product_ref: productRef,
    status: "active",
    current_period_end: null,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (insertError) throw insertError;

  if (params.tier === "webinar" && productRef) {
    const { error: regError } = await db.from("webinar_registrations").upsert(
      { webinar_id: productRef, user_id: params.userId },
      { onConflict: "webinar_id,user_id", ignoreDuplicates: true },
    );
    if (regError) throw regError;
  }

  return { contractId, productRef };
}
