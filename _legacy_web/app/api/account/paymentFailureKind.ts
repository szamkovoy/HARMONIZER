/**
 * Чем закончился неоплаченный счёт: человек ушёл с формы сам или платёж отклонён.
 * Ушедшему не пишем «оплата не прошла» и не будим админа; на странице возврата
 * показываем «Оплата не завершена».
 */
export type PaymentFailureKind = "abandoned" | "declined_3ds" | "declined";

/** ЮKassa: срок формы истёк без оплаты. Lava: покупатель нажал «отмена». */
export function isAbandonedFailure(reason: string | null | undefined): boolean {
  const value = (reason ?? "").trim();
  if (!value) return false;
  if (value.startsWith("Cancelled by customer")) return true;
  return value === "expired_on_confirmation" || value.endsWith(":expired_on_confirmation");
}

export function paymentFailureKind(reason: string | null | undefined): PaymentFailureKind {
  if (isAbandonedFailure(reason)) return "abandoned";
  if (/3[\s-]?d[\s_-]?secure/i.test(reason ?? "")) return "declined_3ds";
  return "declined";
}
