import type { FxCurrency } from "./types";

export type SettlementNetRow = {
  provider?: string | null;
  paid_at: string;
  net_amount_rub: number | string | null;
  net_amount_eur: number | string | null;
  net_amount_usd: number | string | null;
  tier?: string | null;
};

export function netFieldForCurrency(
  currency: FxCurrency,
): "net_amount_rub" | "net_amount_eur" | "net_amount_usd" {
  if (currency === "EUR") return "net_amount_eur";
  if (currency === "USD") return "net_amount_usd";
  return "net_amount_rub";
}

export function currencySymbol(currency: FxCurrency): string {
  if (currency === "EUR") return "€";
  if (currency === "USD") return "$";
  return "₽";
}

function bucketKey(iso: string, grain: "day" | "week"): string {
  const day = iso.slice(0, 10);
  if (grain === "day") return day;
  const d = new Date(`${day}T00:00:00.000Z`);
  const dayNum = d.getUTCDay();
  const diff = (dayNum + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

export function aggregateSettlementNets(
  rows: SettlementNetRow[],
  displayCurrency: FxCurrency,
  grain: "day" | "week" = "day",
): {
  total: number;
  count: number;
  by_day: Array<{ bucket: string; currency: string; sum: number; count: number }>;
  by_tier: Array<{ tier: string; sum: number; count: number }>;
} {
  const field = netFieldForCurrency(displayCurrency);
  const byDay = new Map<string, { sum: number; count: number }>();
  const byTier = new Map<string, { sum: number; count: number }>();
  let total = 0;
  let count = 0;

  for (const row of rows) {
    const sum = Number(row[field]) || 0;
    total += sum;
    count += 1;
    const day = bucketKey(row.paid_at, grain);
    const dayAcc = byDay.get(day) ?? { sum: 0, count: 0 };
    dayAcc.sum += sum;
    dayAcc.count += 1;
    byDay.set(day, dayAcc);

    const tier = row.tier ?? "unknown";
    const tierAcc = byTier.get(tier) ?? { sum: 0, count: 0 };
    tierAcc.sum += sum;
    tierAcc.count += 1;
    byTier.set(tier, tierAcc);
  }

  return {
    total,
    count,
    by_day: [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([bucket, v]) => ({
        bucket,
        currency: displayCurrency,
        sum: Math.round(v.sum * 100) / 100,
        count: v.count,
      })),
    by_tier: [...byTier.entries()].map(([tier, v]) => ({
      tier,
      sum: Math.round(v.sum * 100) / 100,
      count: v.count,
    })),
  };
}

export function parseDisplayCurrency(raw: string | null | undefined): FxCurrency {
  const c = (raw ?? "RUB").trim().toUpperCase();
  if (c === "EUR" || c === "USD" || c === "RUB") return c;
  return "RUB";
}
