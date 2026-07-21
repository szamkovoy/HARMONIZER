import {
  aggregateSettlementNets,
  parseDisplayCurrency,
} from "../../../account/fx";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type PeriodDays = 7 | 30 | 90;
type Grain = "day" | "week";

function parsePeriod(raw: string | null): PeriodDays {
  const n = Number(raw ?? 30);
  if (n === 7 || n === 90) return n;
  return 30;
}

function parseGrain(raw: string | null): Grain {
  return raw === "week" ? "week" : "day";
}

/** Статистика оплат: Lava net (payment_settlements) + ручные гранты (payments). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const grain = parseGrain(url.searchParams.get("grain"));
    const displayCurrency = parseDisplayCurrency(url.searchParams.get("currency"));
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const db = createServiceSupabase();

    const [lavaRes, grantsRes] = await Promise.all([
      db
        .from("payment_settlements")
        .select("paid_at, provider, net_amount_rub, net_amount_eur, net_amount_usd, contract_id")
        .eq("provider", "lavatop")
        .gte("paid_at", since)
        .order("paid_at", { ascending: true }),
      db
        .from("payments")
        .select("amount, currency, tier, source, created_at")
        .eq("source", "manual")
        .gte("created_at", since)
        .order("created_at", { ascending: true }),
    ]);
    if (lavaRes.error) throw lavaRes.error;
    if (grantsRes.error) throw grantsRes.error;

    const rawSettlements = lavaRes.data ?? [];
    const contractIds = [...new Set(rawSettlements.map((r) => r.contract_id as string))];
    const tierByContract = new Map<string, string>();
    if (contractIds.length > 0) {
      const tiersRes = await db
        .from("payment_contracts")
        .select("contract_id, tier")
        .in("contract_id", contractIds);
      if (tiersRes.error) throw tiersRes.error;
      for (const row of tiersRes.data ?? []) {
        tierByContract.set(row.contract_id as string, row.tier as string);
      }
    }

    const settlementRows = rawSettlements.map((row) => ({
      paid_at: row.paid_at as string,
      provider: row.provider as string,
      net_amount_rub: row.net_amount_rub as number,
      net_amount_eur: row.net_amount_eur as number,
      net_amount_usd: row.net_amount_usd as number,
      tier: tierByContract.get(row.contract_id as string) ?? null,
    }));
    const netAgg = aggregateSettlementNets(settlementRows, displayCurrency, grain);
    const grantRows = grantsRes.data ?? [];

    let grantsSum = 0;
    for (const row of grantRows) {
      grantsSum += Number(row.amount) || 0;
    }

    const byTier: Record<string, { count: number; sum: number }> = {};
    for (const row of netAgg.by_tier) {
      byTier[row.tier] = { count: row.count, sum: row.sum };
    }

    const dailySeries = [...netAgg.by_day]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((item) => ({ date: item.bucket, count: item.count, sum: item.sum }));

    return json({
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      grain,
      display_currency: displayCurrency,
      lava: {
        count: netAgg.count,
        by_currency: {
          [displayCurrency]: { count: netAgg.count, sum: netAgg.total },
        },
        by_tier: byTier,
        daily_series: dailySeries,
        primary_currency: displayCurrency,
        primary_sum: netAgg.total,
        net: true,
      },
      grants_manual: {
        count: grantRows.length,
        sum: grantsSum,
        currency: grantRows[0]?.currency ?? "RUB",
      },
      count: netAgg.count,
      total_amount: netAgg.total,
      currency: displayCurrency,
      by_tier: byTier,
      by_source: {
        lavatop: { count: netAgg.count, sum: netAgg.total },
        manual: { count: grantRows.length, sum: grantsSum },
      },
      daily_series: dailySeries,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
