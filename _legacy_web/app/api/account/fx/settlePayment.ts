import { createServiceSupabase } from "../../_utils/supabase";
import { computePaymentNets, normalizeFxCurrency } from "./convert";
import { gatewayFeeRate } from "./gatewayFees";
import { loadQuoteBook } from "./providers";
import type { FxCurrency, PaymentNets } from "./types";

type Db = ReturnType<typeof createServiceSupabase>;

export type SettlePaymentInput = {
  contractId: string;
  eventType: "payment.success" | "subscription.recurring.payment.success";
  /** Gross paid amount from webhook; falls back to contract.amount. */
  amount?: number | null;
  currency?: string | null;
  paidAt?: string | Date | null;
  userId?: string | null;
  provider?: string | null;
};

export type SettlePaymentResult = {
  nets: PaymentNets;
  currency: FxCurrency;
  amount: number;
  inserted: boolean;
};

/**
 * Compute net RUB/EUR/USD for a successful charge, persist a settlement row
 * (idempotent), and mirror nets onto `payment_contracts`.
 */
export async function settlePayment(
  db: Db,
  input: SettlePaymentInput,
): Promise<SettlePaymentResult | null> {
  const { data: contract, error: contractError } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,provider,amount,currency")
    .eq("contract_id", input.contractId)
    .maybeSingle();
  if (contractError) throw contractError;
  if (!contract) return null;

  const currency =
    normalizeFxCurrency(input.currency) ?? normalizeFxCurrency(contract.currency);
  const amountRaw =
    input.amount != null && Number.isFinite(Number(input.amount))
      ? Number(input.amount)
      : Number(contract.amount);
  if (!currency || !Number.isFinite(amountRaw) || amountRaw <= 0) {
    console.warn("[fx] settle skipped: missing amount/currency", {
      contractId: input.contractId,
      amount: input.amount ?? contract.amount,
      currency: input.currency ?? contract.currency,
    });
    return null;
  }

  const provider = input.provider ?? contract.provider ?? "lavatop";
  const feeRate = gatewayFeeRate(provider);
  const book = await loadQuoteBook(db);
  const nets = computePaymentNets(amountRaw, currency, feeRate, book);

  const paidAtDate = input.paidAt ? new Date(input.paidAt) : new Date();
  const paidAtIso = Number.isNaN(paidAtDate.getTime())
    ? new Date().toISOString()
    : paidAtDate.toISOString();

  const settlementRow = {
    contract_id: contract.contract_id,
    provider,
    user_id: input.userId ?? contract.user_id,
    event_type: input.eventType,
    amount: amountRaw,
    currency,
    fee_rate: feeRate,
    net_amount_rub: nets.net_amount_rub,
    net_amount_eur: nets.net_amount_eur,
    net_amount_usd: nets.net_amount_usd,
    fx_source: nets.fx_source,
    paid_at: paidAtIso,
  };

  let inserted = true;
  const { error: insertError } = await db.from("payment_settlements").insert(settlementRow);
  if (insertError) {
    // Unique violation → idempotent retry of the same webhook.
    const code = (insertError as { code?: string }).code;
    if (code === "23505") {
      inserted = false;
    } else {
      throw insertError;
    }
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await db
    .from("payment_contracts")
    .update({
      amount: amountRaw,
      currency,
      fee_rate: feeRate,
      net_amount_rub: nets.net_amount_rub,
      net_amount_eur: nets.net_amount_eur,
      net_amount_usd: nets.net_amount_usd,
      fx_source: nets.fx_source,
      updated_at: nowIso,
    })
    .eq("contract_id", contract.contract_id);
  if (updateError) throw updateError;

  return { nets, currency, amount: amountRaw, inserted };
}
