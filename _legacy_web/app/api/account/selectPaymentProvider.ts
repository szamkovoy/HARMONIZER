/**
 * Выбор платёжного шлюза по валюте и env (kill-switch без деплоя кода).
 *
 * USD/EUR → всегда Lava.top.
 * RUB → ЮKassa только если оба флага включены; иначе Lava.
 *
 * YOOKASSA_RECURRING_ENABLED — задел: при true первый платёж ЮKassa
 * сохраняет payment_method (см. yookassa.ts). Сейчас менеджер магазина
 * автоплатежи не включил — флаг остаётся false, доступ = 30 дней grant.
 */

export type PaymentProviderId = "lavatop" | "yookassa";

export function selectPaymentProvider(currency: string): PaymentProviderId {
  const cur = currency.trim().toUpperCase();
  if (cur !== "RUB") return "lavatop";

  if (process.env.YOOKASSA_ENABLED?.trim() !== "true") return "lavatop";

  const forRub = (process.env.PAYMENT_GATEWAY_FOR_RUB ?? "lavatop").trim().toLowerCase();
  if (forRub !== "yookassa") return "lavatop";

  return "yookassa";
}

export function isYookassaRecurringEnabled(): boolean {
  return process.env.YOOKASSA_RECURRING_ENABLED?.trim() === "true";
}
