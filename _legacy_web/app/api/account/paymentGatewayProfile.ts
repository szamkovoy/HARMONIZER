/**
 * Независимые профили платёжных шлюзов (как EMAIL_OTP / EMAIL_MARKETING).
 *
 * Env на шлюз:
 *   PAYMENT_LAVATOP_ENABLED=true|false
 *   PAYMENT_LAVATOP_REGION=INT          (или ISO страны в будущем)
 *   PAYMENT_YOOKASSA_ENABLED=true|false
 *   PAYMENT_YOOKASSA_REGION=RU
 *
 * Выбор:
 *   1) enabled gateway с REGION === billingCountry (не INT)
 *   2) иначе enabled gateway с REGION=INT
 *   3) иначе fail-closed (payment_gateway_unavailable)
 *
 * Credentials ЮKassa (не флаги маршрутизации): YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY,
 * YOOKASSA_RETURN_URL, опц. YOOKASSA_WEBHOOK_SECRET.
 *
 * Автоплатежи ЮKassa: для подписок всегда запрашиваем save_payment_method;
 * если магазин ещё не разрешил recurring — create падает обратно в обычный платёж
 * (см. yookassa.ts). Отдельного kill-switch нет (в отличие от Lava — подписки там
 * на стороне провайдера).
 */

export type PaymentProviderId = "lavatop" | "yookassa";

export type PaymentGatewayResolution =
  | { ok: true; provider: PaymentProviderId; matchedRegion: string }
  | { ok: false; error: "payment_gateway_unavailable" };

type GatewayDef = {
  id: PaymentProviderId;
  enabled: boolean;
  /** RU | INT | future ISO-3166 alpha-2 */
  region: string;
};

function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw == null) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function normalizeRegion(raw: string | undefined, fallback: string): string {
  const r = (raw ?? fallback).trim().toUpperCase();
  return r || fallback;
}

function loadGateways(): GatewayDef[] {
  return [
    {
      id: "lavatop",
      enabled: envFlag("PAYMENT_LAVATOP_ENABLED"),
      region: normalizeRegion(process.env.PAYMENT_LAVATOP_REGION, "INT"),
    },
    {
      id: "yookassa",
      enabled: envFlag("PAYMENT_YOOKASSA_ENABLED"),
      region: normalizeRegion(process.env.PAYMENT_YOOKASSA_REGION, "RU"),
    },
  ];
}

/** ISO country for gateway match; RUB without country ⇒ RU; else XX (only INT matches). */
export function normalizeBillingCountry(
  country: string | null | undefined,
  currency?: string | null,
): string {
  const c = country?.trim().toUpperCase() ?? "";
  if (/^[A-Z]{2}$/.test(c)) return c;
  if ((currency ?? "").trim().toUpperCase() === "RUB") return "RU";
  return "XX";
}

export function resolvePaymentGateway(params: {
  country?: string | null;
  currency?: string | null;
}): PaymentGatewayResolution {
  const country = normalizeBillingCountry(params.country, params.currency);
  const enabled = loadGateways().filter((g) => g.enabled);

  const countrySpecific = enabled.find((g) => g.region !== "INT" && g.region === country);
  if (countrySpecific) {
    return { ok: true, provider: countrySpecific.id, matchedRegion: countrySpecific.region };
  }

  const international = enabled.find((g) => g.region === "INT");
  if (international) {
    return { ok: true, provider: international.id, matchedRegion: "INT" };
  }

  return { ok: false, error: "payment_gateway_unavailable" };
}

/**
 * @deprecated Prefer resolvePaymentGateway. Returns lavatop on fail-closed
 * only for accidental legacy callers — checkout/overview must use resolve*.
 */
export function selectPaymentProvider(
  currency: string,
  country?: string | null,
): PaymentProviderId {
  const resolved = resolvePaymentGateway({ currency, country });
  if (!resolved.ok) return "lavatop";
  return resolved.provider;
}
