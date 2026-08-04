export type AdminPaymentRow = {
  id: string;
  kind?: "grant" | "gateway";
  editable?: boolean;
  user_id: string | null;
  amount: number;
  currency: string;
  tier: string;
  paid_until: string | null;
  source: string;
  provider?: string;
  comment: string | null;
  created_at: string;
  edited_at: string | null;
  display_name?: string;
  email?: string;
  contract_id?: string | null;
  status?: string | null;
  refundable?: boolean;
};

export type PaymentFormValues = {
  tier: string;
  expiresAt: string;
  amount: string;
  currency: "RUB" | "EUR" | "USD";
  comment: string;
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "вручную",
  store: "покупка",
  promo: "промо",
  lavatop: "Lava.top",
  yookassa: "ЮКасса",
};

export const CURRENCY_OPTIONS = ["RUB", "EUR", "USD"] as const;

export const EMPTY_PAYMENT_FORM: PaymentFormValues = {
  tier: "oracle",
  expiresAt: "",
  amount: "",
  currency: "RUB",
  comment: "",
};
