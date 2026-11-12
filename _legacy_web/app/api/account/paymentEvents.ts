/**
 * Журнал payment_events. Ошибка записи не должна ломать оплату или вебхук.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PaymentEventInput = {
  provider: string;
  eventType: string;
  contractId?: string | null;
  parentContractId?: string | null;
  buyerEmail?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  errorMessage?: string | null;
  raw?: unknown;
  handledResult?: unknown;
  httpStatus?: number | null;
};

function jsonValue(value: unknown): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { unserializable: true };
  }
}

export async function logPaymentEvent(db: SupabaseClient, input: PaymentEventInput): Promise<void> {
  try {
    const { error } = await db.from("payment_events").insert({
      provider: input.provider,
      event_type: input.eventType,
      contract_id: input.contractId ?? null,
      parent_contract_id: input.parentContractId ?? null,
      buyer_email: input.buyerEmail ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      status: input.status ?? null,
      error_message: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
      raw: jsonValue(input.raw),
      handled_result: jsonValue(input.handledResult),
      http_status: input.httpStatus ?? null,
    });
    if (error) console.error("[payment-events]", error.message ?? error);
  } catch (err) {
    console.error("[payment-events]", err);
  }
}
