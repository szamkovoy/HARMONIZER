import type { GatewayProvider } from "./types";

/** Default acquiring fees (share of gross). Overridable via env. */
const DEFAULT_FEES: Record<GatewayProvider, number> = {
  lavatop: 0.08,
  yandex: 0.025,
};

export function gatewayFeeRate(provider: string | null | undefined): number {
  const key = (provider ?? "lavatop").toLowerCase();
  if (key === "yandex" || key === "yookassa" || key === "yandex_kassa") {
    const env = Number(process.env.YANDEX_GATEWAY_FEE_RATE);
    return Number.isFinite(env) && env >= 0 && env < 1 ? env : DEFAULT_FEES.yandex;
  }
  const env = Number(process.env.LAVA_GATEWAY_FEE_RATE);
  return Number.isFinite(env) && env >= 0 && env < 1 ? env : DEFAULT_FEES.lavatop;
}

export function amountAfterFee(gross: number, feeRate: number): number {
  if (!Number.isFinite(gross) || gross < 0) return 0;
  if (!Number.isFinite(feeRate) || feeRate <= 0) return gross;
  if (feeRate >= 1) return 0;
  return gross * (1 - feeRate);
}
