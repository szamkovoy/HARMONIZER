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
 * Legacy (если новых PAYMENT_*_ENABLED нет):
 *   YOOKASSA_ENABLED + PAYMENT_GATEWAY_FOR_RUB=yookassa → yookassa region RU;
 *   Lava всегда enabled INT.
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

function envFlag(name: string): boolean | null {
  const raw = process.env[name];
  if (raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  return v === "true" || v === "1" || v === "yes";
}

function normalizeRegion(raw: string | undefined, fallback: string): string {
  const r = (raw ?? fallback).trim().toUpperCase();
  return r || fallback;
}

function loadGateways(): GatewayDef[] {
  const lavaFlag = envFlag("PAYMENT_LAVATOP_ENABLED");
  const yooFlag = envFlag("PAYMENT_YOOKASSA_ENABLED");
  const usingNewModel = lavaFlag != null || yooFlag != null;

  if (usingNewModel) {
    return [
      {
        id: "lavatop",
        enabled: lavaFlag === true,
        region: normalizeRegion(process.env.PAYMENT_LAVATOP_REGION, "INT"),
      },
      {
        id: "yookassa",
        enabled: yooFlag === true,
        region: normalizeRegion(process.env.PAYMENT_YOOKASSA_REGION, "RU"),
      },
    ];
  }

  // Legacy one-release compat.
  const legacyYoo =
    process.env.YOOKASSA_ENABLED?.trim() === "true" &&
    (process.env.PAYMENT_GATEWAY_FOR_RUB ?? "lavatop").trim().toLowerCase() === "yookassa";

  return [
    { id: "lavatop", enabled: true, region: "INT" },
    { id: "yookassa", enabled: legacyYoo, region: "RU" },
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

export function isYookassaRecurringEnabled(): boolean {
  return process.env.YOOKASSA_RECURRING_ENABLED?.trim() === "true";
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
