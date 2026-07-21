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

function bucketKey(iso: string, grain: Grain): string {
  const day = iso.slice(0, 10);
  if (grain === "day") return day;
  const d = new Date(`${day}T00:00:00.000Z`);
  const dayNum = d.getUTCDay(); // 0 Sun
  const diff = (dayNum + 6) % 7; // Monday-start
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function accessSegment(row: {
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
}): "navigator" | "trial" | "oracle" | "master" {
  const now = Date.now();
  if (row.trial_expires_at && new Date(row.trial_expires_at).getTime() > now) return "trial";
  const expires = row.membership_expires_at ? new Date(row.membership_expires_at).getTime() : null;
  const active = expires == null || expires > now;
  if (!active) return "navigator";
  if (row.membership_tier === "master") return "master";
  if (row.membership_tier === "oracle" || row.membership_tier === "practitioner") return "oracle";
  return "navigator";
}

/** Статистика пользователей: регистрации, сегменты доступа, активность, страны. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const grain = parseGrain(url.searchParams.get("grain"));
    const db = createServiceSupabase();
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const [usersRes, profileRes, regRes, dau1, dau3, dau7] = await Promise.all([
      db.from("users").select("id", { count: "exact", head: true }),
      db.from("users").select("membership_tier, membership_expires_at, trial_expires_at, country_code"),
      db.from("users").select("created_at").gte("created_at", since).order("created_at", { ascending: true }),
      db.rpc("admin_active_users_count", { p_hours: 24 }),
      db.rpc("admin_active_users_count", { p_hours: 72 }),
      db.rpc("admin_active_users_count", { p_hours: 168 }),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (profileRes.error) throw profileRes.error;
    if (regRes.error) throw regRes.error;

    const byAccess: Record<string, number> = {
      navigator: 0,
      trial: 0,
      oracle: 0,
      master: 0,
    };
    const byTier: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    for (const row of profileRes.data ?? []) {
      const tier = row.membership_tier ?? "free";
      byTier[tier] = (byTier[tier] ?? 0) + 1;
      const seg = accessSegment(row);
      byAccess[seg] = (byAccess[seg] ?? 0) + 1;
      if (row.country_code) {
        byCountry[row.country_code] = (byCountry[row.country_code] ?? 0) + 1;
      }
    }

    const registrationsByBucket: Record<string, number> = {};
    for (const row of regRes.data ?? []) {
      if (!row.created_at) continue;
      const key = bucketKey(row.created_at, grain);
      registrationsByBucket[key] = (registrationsByBucket[key] ?? 0) + 1;
    }

    const registrationSeries = Object.entries(registrationsByBucket)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const countrySeries = Object.entries(byCountry)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count }));

    return json({
      generated_at: new Date().toISOString(),
      period_days: periodDays,
      grain,
      total_users: usersRes.count ?? 0,
      by_tier: byTier,
      by_access: byAccess,
      by_country: countrySeries,
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
