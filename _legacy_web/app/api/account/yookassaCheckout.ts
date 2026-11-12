import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { nextPeriodEnd } from "./lava";
import { resolveCatalogOffer } from "./paymentCatalog";
import { createYookassaPayment } from "./yookassa";

/** Контракт pending + платёж ЮKassa (redirect). Кабинет и страница «Оплата не удалась». */
export async function createYookassaCheckout(
  db: SupabaseClient,
  params: {
    userId: string;
    email: string;
    currency: "RUB" | "USD" | "EUR";
    tier: "oracle" | "master" | "webinar" | "book";
    kind: "subscription" | "one_time";
    productKind: "subscription" | "one_time";
    productRef: string | null;
    periodicity: "MONTHLY" | "ONE_TIME";
    webinarId?: string;
    /** Без него — YOOKASSA_RETURN_URL (кабинет `?paid=1`). */
    returnUrlFor?: (contractId: string) => string;
  },
): Promise<{ paymentUrl: string; contractId: string }> {
  if (params.currency !== "RUB") {
    throw new Error("YooKassa checkout requires RUB");
  }

  const offer = await resolveCatalogOffer(db, {
    provider: "yookassa",
    tier: params.tier,
    currency: "RUB",
  });

  const contractId = randomUUID();
  const description =
    offer.description?.trim() || offer.title || `Harmonizer ${params.tier}`;

  const insertRow: Record<string, unknown> = {
    user_id: params.userId,
    buyer_email: params.email,
    contract_id: contractId,
    provider: "yookassa",
    tier: params.tier,
    currency: "RUB",
    amount: offer.amount,
    periodicity: params.periodicity,
    product_kind: params.productKind,
    product_ref: params.productRef,
    status: "pending",
  };
  if (params.productKind === "subscription") {
    insertRow.current_period_end = nextPeriodEnd().toISOString();
  }

  const { error: insertError } = await db.from("payment_contracts").insert(insertRow);
  if (insertError) throw insertError;

  try {
    const { payment, confirmationUrl } = await createYookassaPayment({
      contractId,
      userId: params.userId,
      amount: offer.amount,
      currency: "RUB",
      description,
      tier: params.tier,
      kind: params.kind,
      webinarId: params.webinarId ?? null,
      cardOnly: params.kind === "subscription",
      returnUrl: params.returnUrlFor?.(contractId) ?? null,
    });

    const { error: updateError } = await db
      .from("payment_contracts")
      .update({
        provider_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq("contract_id", contractId);
    if (updateError) throw updateError;

    return { paymentUrl: confirmationUrl, contractId };
  } catch (err) {
    await db
      .from("payment_contracts")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("contract_id", contractId)
      .eq("status", "pending");
    throw err;
  }
}
