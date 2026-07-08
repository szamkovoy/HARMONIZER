export type AdminPaymentRow = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  tier: string;
  paid_until: string | null;
  source: string;
  comment: string | null;
  created_at: string;
  edited_at: string | null;
  display_name?: string;
  email?: string;
};

export type PaymentFormValues = {
  tier: string;
  expiresAt: string;
  amount: string;
  comment: string;
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "вручную",
  store: "покупка",
  promo: "промо",
};

export const EMPTY_PAYMENT_FORM: PaymentFormValues = {
  tier: "oracle",
  expiresAt: "",
  amount: "",
  comment: "",
};
