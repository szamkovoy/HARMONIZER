import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type PeriodDays = 7 | 30 | 90;

function parsePeriod(raw: string | null): PeriodDays {
  const n = Number(raw ?? 30);
  if (n === 7 || n === 90) return n;
  return 30;
}

/** Статистика оплат: сумма/кол-во за период, разбивка по тарифам и по дням. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const db = createServiceSupabase();

    const { data, error } = await db
      .from("payments")
      .select("amount, currency, tier, source, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const rows = data ?? [];
    let totalAmount = 0;
    const byTier: Record<string, { count: number; sum: number }> = {};
    const bySource: Record<string, { count: number; sum: number }> = {};
    const byDay: Record<string, { count: number; sum: number }> = {};

    for (const row of rows) {
      const amount = Number(row.amount) || 0;
      totalAmount += amount;
      const tier = row.tier ?? "unknown";
      const source = row.source ?? "manual";
      const day = row.created_at.slice(0, 10);

      if (!byTier[tier]) byTier[tier] = { count: 0, sum: 0 };
      byTier[tier].count += 1;
      byTier[tier].sum += amount;

      if (!bySource[source]) bySource[source] = { count: 0, sum: 0 };
      bySource[source].count += 1;
      bySource[source].sum += amount;

      if (!byDay[day]) byDay[day] = { count: 0, sum: 0 };
      byDay[day].count += 1;
      byDay[day].sum += amount;
    }

    const dailySeries = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, count: v.count, sum: v.sum }));

    return json({
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      count: rows.length,
      total_amount: totalAmount,
      currency: rows[0]?.currency ?? "RUB",
      by_tier: byTier,
      by_source: bySource,
      daily_series: dailySeries,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
