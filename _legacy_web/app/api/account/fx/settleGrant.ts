import { createServiceSupabase } from "../../_utils/supabase";
import { computePaymentNets, normalizeFxCurrency } from "./convert";
import { loadQuoteBook } from "./providers";
import type { FxCurrency, PaymentNets } from "./types";

type Db = ReturnType<typeof createServiceSupabase>;

/**
 * Convert a manual grant to RUB/EUR/USD nets with **zero** gateway fee.
 */
export async function settleGrantPayment(
  db: Db,
  input: {
    paymentId: string;
    amount: number;
    currency: string;
  },
): Promise<PaymentNets | null> {
  const currency = normalizeFxCurrency(input.currency);
  if (!currency || !Number.isFinite(input.amount) || input.amount < 0) return null;

  const book = await loadQuoteBook(db);
  const nets = computePaymentNets(input.amount, currency as FxCurrency, 0, book);

  const { error } = await db
    .from("payments")
    .update({
      net_amount_rub: nets.net_amount_rub,
      net_amount_eur: nets.net_amount_eur,
      net_amount_usd: nets.net_amount_usd,
      fx_source: nets.fx_source,
    })
    .eq("id", input.paymentId);
  if (error) throw error;
  return nets;
}
