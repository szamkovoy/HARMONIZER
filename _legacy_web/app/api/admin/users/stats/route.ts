import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type PeriodDays = 7 | 30 | 90;

function parsePeriod(raw: string | null): PeriodDays {
  const n = Number(raw ?? 30);
  if (n === 7 || n === 90) return n;
  return 30;
}

/** Статистика пользователей: регистрации по дням, тиры, активность за 24/72/168 ч. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const db = createServiceSupabase();

    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const [usersRes, tierRes, regRes, dau1, dau3, dau7] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }),
      db.from("users").select("membership_tier"),
      db.from("users").select("created_at").gte("created_at", since).order("created_at", { ascending: true }),
      db.rpc("admin_active_users_count", { p_hours: 24 }),
      db.rpc("admin_active_users_count", { p_hours: 72 }),
      db.rpc("admin_active_users_count", { p_hours: 168 }),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (tierRes.error) throw tierRes.error;
    if (regRes.error) throw regRes.error;

    const byTier: Record<string, number> = {};
    for (const row of tierRes.data ?? []) {
      const t = row.membership_tier ?? "free";
      byTier[t] = (byTier[t] ?? 0) + 1;
    }

    const registrationsByDay: Record<string, number> = {};
    for (const row of regRes.data ?? []) {
      if (!row.created_at) continue;
      const day = row.created_at.slice(0, 10);
      registrationsByDay[day] = (registrationsByDay[day] ?? 0) + 1;
    }

    const registrationSeries = Object.entries(registrationsByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return json({
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      total_users: usersRes.count ?? 0,
      by_tier: byTier,
      registrations_in_period: registrationSeries.reduce((s, x) => s + x.count, 0),
      registration_series: registrationSeries,
      active_users: {
        last_24h: dau1.error ? null : dau1.data,
        last_72h: dau3.error ? null : dau3.data,
        last_168h: dau7.error ? null : dau7.data,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
