import {
  aggregateSettlementNets,
  netFieldForCurrency,
  parseDisplayCurrency,
  type FxCurrency,
} from "../../../account/fx";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { normalizeGatewayProvider } from "../../_utils/paymentLedger";

export const runtime = "nodejs";

type PeriodDays = 7 | 30 | 90 | "all";
type Grain = "day" | "week";

function parsePeriod(raw: string | null): PeriodDays {
  if (raw === "all") return "all";
  const n = Number(raw ?? 7);
  if (n === 30 || n === 90) return n;
  return 7;
}

function parseGrain(raw: string | null, period: PeriodDays): Grain {
  if (period === "all") return "week";
  return raw === "week" ? "week" : "day";
}

type SettlementLike = {
  paid_at: string;
  provider: string;
  net_amount_rub: number;
  net_amount_eur: number;
  net_amount_usd: number;
  tier: string | null;
};

function providerBucket(raw: string | null | undefined): "lavatop" | "yookassa" | "other" {
  const p = normalizeGatewayProvider(raw);
  if (p === "lavatop") return "lavatop";
  if (p === "yookassa") return "yookassa";
  return "other";
}

function emptyProvider(currency: FxCurrency) {
  return {
    count: 0,
    sum: 0,
    currency,
    by_tier: {} as Record<string, { count: number; sum: number }>,
    daily_series: [] as Array<{ date: string; count: number; sum: number }>,
  };
}

function toProviderStats(rows: SettlementLike[], currency: FxCurrency, grain: Grain) {
  const agg = aggregateSettlementNets(rows, currency, grain);
  const byTier: Record<string, { count: number; sum: number }> = {};
  for (const row of agg.by_tier) byTier[row.tier] = { count: row.count, sum: row.sum };
  return {
    count: agg.count,
    sum: agg.total,
    currency,
    by_tier: byTier,
    daily_series: [...agg.by_day]
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((item) => ({ date: item.bucket, count: item.count, sum: item.sum })),
  };
}

/** Статистика выручки: net по Lava.top / ЮКасса + гранты (без комиссии шлюза). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const grain = parseGrain(url.searchParams.get("grain"), periodDays);
    const displayCurrency = parseDisplayCurrency(url.searchParams.get("currency"));
    const since =
      periodDays === "all"
        ? null
        : new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const db = createServiceSupabase();

    let settlementsQuery = db
      .from("payment_settlements")
      .select("paid_at, provider, net_amount_rub, net_amount_eur, net_amount_usd, contract_id")
      .order("paid_at", { ascending: true });
    if (since) settlementsQuery = settlementsQuery.gte("paid_at", since);

    let grantsQuery = db
      .from("payments")
      .select(
        "amount, currency, tier, source, created_at, net_amount_rub, net_amount_eur, net_amount_usd",
      )
      .eq("source", "manual")
      .order("created_at", { ascending: true });
    if (since) grantsQuery = grantsQuery.gte("created_at", since);

    const [settlementsRes, grantsRes] = await Promise.all([settlementsQuery, grantsQuery]);
    if (settlementsRes.error) throw settlementsRes.error;
    if (grantsRes.error) throw grantsRes.error;

    const rawSettlements = settlementsRes.data ?? [];
    const contractIds = [...new Set(rawSettlements.map((r) => r.contract_id as string))];
    const tierByContract = new Map<string, string>();
    const userByContract = new Map<string, string>();
    if (contractIds.length > 0) {
      const contractsRes = await db
        .from("payment_contracts")
        .select("contract_id, tier, user_id")
        .in("contract_id", contractIds);
      if (contractsRes.error) throw contractsRes.error;
      for (const row of contractsRes.data ?? []) {
        tierByContract.set(row.contract_id as string, row.tier as string);
        if (row.user_id) userByContract.set(row.contract_id as string, row.user_id as string);
      }
    }

    const userIds = [...new Set(userByContract.values())];
    const countryByUser = new Map<string, string>();
    if (userIds.length > 0) {
      const usersRes = await db.from("users").select("id, country_code").in("id", userIds);
      if (usersRes.error) throw usersRes.error;
      for (const row of usersRes.data ?? []) {
        const code = String(row.country_code ?? "").trim().toUpperCase();
        if (code) countryByUser.set(row.id as string, code);
      }
    }

    const netField = netFieldForCurrency(displayCurrency);
    const settlementRows: SettlementLike[] = rawSettlements.map((row) => ({
      paid_at: row.paid_at as string,
      provider: normalizeGatewayProvider(row.provider as string),
      net_amount_rub: Number(row.net_amount_rub) || 0,
      net_amount_eur: Number(row.net_amount_eur) || 0,
      net_amount_usd: Number(row.net_amount_usd) || 0,
      tier: tierByContract.get(row.contract_id as string) ?? null,
    }));

    const lavaRows = settlementRows.filter((r) => providerBucket(r.provider) === "lavatop");
    const yukassaRows = settlementRows.filter((r) => providerBucket(r.provider) === "yookassa");
    const gatewayRows = [...lavaRows, ...yukassaRows];

    const lava = toProviderStats(lavaRows, displayCurrency, grain);
    const yukassa =
      yukassaRows.length > 0
        ? toProviderStats(yukassaRows, displayCurrency, grain)
        : emptyProvider(displayCurrency);
    const combined = toProviderStats(gatewayRows, displayCurrency, grain);

    const byCountryMap = new Map<string, { count: number; sum: number }>();
    for (const row of rawSettlements) {
      const provider = providerBucket(row.provider as string);
      if (provider !== "lavatop" && provider !== "yookassa") continue;
      const userId = userByContract.get(row.contract_id as string);
      const code = (userId && countryByUser.get(userId)) || "??";
      const amount = Number(row[netField]) || 0;
      const prev = byCountryMap.get(code) ?? { count: 0, sum: 0 };
      prev.count += 1;
      prev.sum += amount;
      byCountryMap.set(code, prev);
    }
    const by_country = [...byCountryMap.entries()]
      .map(([code, v]) => ({
        code,
        count: v.count,
        sum: Math.round(v.sum * 100) / 100,
      }))
      .sort((a, b) => b.sum - a.sum || b.count - a.count);

    let grantsSum = 0;
    for (const row of grantsRes.data ?? []) {
      const net = Number(row[netField]);
      if (Number.isFinite(net) && net > 0) {
        grantsSum += net;
      } else if ((row.currency as string) === displayCurrency) {
        grantsSum += Number(row.amount) || 0;
      }
    }

    return json({
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      range_all_time: periodDays === "all",
      grain,
      display_currency: displayCurrency,
      providers: {
        lavatop: lava,
        yookassa: yukassa,
      },
      by_tier: combined.by_tier,
      by_country,
      daily_series: combined.daily_series,
      total: {
        count: combined.count,
        sum: combined.sum,
        currency: displayCurrency,
      },
      grants_manual: {
        count: (grantsRes.data ?? []).length,
        sum: Math.round(grantsSum * 100) / 100,
        currency: displayCurrency,
      },
      // backward-compatible aliases
      lava: {
        count: lava.count,
        primary_currency: displayCurrency,
        primary_sum: lava.sum,
        by_currency: { [displayCurrency]: { count: lava.count, sum: lava.sum } },
        by_tier: lava.by_tier,
        daily_series: lava.daily_series,
        net: true,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
