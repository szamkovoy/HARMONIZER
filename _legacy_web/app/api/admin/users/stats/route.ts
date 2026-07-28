import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type PeriodDays = 7 | 30 | 90 | "all";
type Grain = "day" | "week";

function parsePeriod(raw: string | null): PeriodDays {
  if (raw === "all") return "all";
  const n = Number(raw ?? 30);
  if (n === 7 || n === 90) return n;
  return 30;
}

function parseGrain(raw: string | null, period: PeriodDays): Grain {
  if (period === "all") return "week";
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
}): "trial" | "navigator" | "oracle" | "master" {
  const now = Date.now();
  if (row.trial_expires_at && new Date(row.trial_expires_at).getTime() > now) return "trial";
  const expires = row.membership_expires_at ? new Date(row.membership_expires_at).getTime() : null;
  const active = expires == null || expires > now;
  if (!active) return "navigator";
  if (row.membership_tier === "master") return "master";
  if (row.membership_tier === "oracle" || row.membership_tier === "practitioner") return "oracle";
  return "navigator";
}

/** Unique users with active one-time webinar/book contracts in period. */
async function countAddonBuyers(
  db: ReturnType<typeof createServiceSupabase>,
  sinceIso: string | null,
): Promise<{ webinar: number; book: number }> {
  let query = db
    .from("payment_contracts")
    .select("user_id, tier")
    .in("tier", ["webinar", "book"])
    .eq("status", "active")
    .not("user_id", "is", null);
  if (sinceIso) {
    query = query.gte("created_at", sinceIso);
  }
  const { data, error } = await query;
  if (error) throw error;

  const webinar = new Set<string>();
  const book = new Set<string>();
  for (const row of data ?? []) {
    const uid = row.user_id as string | null;
    if (!uid) continue;
    if (row.tier === "webinar") webinar.add(uid);
    if (row.tier === "book") book.add(uid);
  }
  return { webinar: webinar.size, book: book.size };
}

/** Статистика Гармонизатора: onboarded, доступ, допы, активность, страны. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const periodDays = parsePeriod(url.searchParams.get("days"));
    const grain = parseGrain(url.searchParams.get("grain"), periodDays);
    const db = createServiceSupabase();
    const since =
      periodDays === "all"
        ? null
        : new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    let regQuery = db
      .from("users")
      .select("onboarded_at")
      .not("onboarded_at", "is", null)
      .order("onboarded_at", { ascending: true });
    if (since) regQuery = regQuery.gte("onboarded_at", since);

    const [onboardedCountRes, profileRes, regRes, dau1, dau3, dau7, addons] =
      await Promise.all([
        db
          .from("users")
          .select("id", { count: "exact", head: true })
          .not("onboarded_at", "is", null),
        db
          .from("users")
          .select(
            "membership_tier, membership_expires_at, trial_expires_at, country_code, onboarded_at",
          )
          .not("onboarded_at", "is", null),
        regQuery,
        db.rpc("admin_active_users_count", { p_hours: 24 }),
        db.rpc("admin_active_users_count", { p_hours: 72 }),
        db.rpc("admin_active_users_count", { p_hours: 168 }),
        countAddonBuyers(db, since),
      ]);
    if (onboardedCountRes.error) throw onboardedCountRes.error;
    if (profileRes.error) throw profileRes.error;
    if (regRes.error) throw regRes.error;

    const byAccess: Record<string, number> = {
      trial: 0,
      navigator: 0,
      oracle: 0,
      master: 0,
    };
    const byCountry: Record<string, number> = {};
    for (const row of profileRes.data ?? []) {
      const seg = accessSegment(row);
      byAccess[seg] = (byAccess[seg] ?? 0) + 1;
      if (row.country_code) {
        byCountry[row.country_code] = (byCountry[row.country_code] ?? 0) + 1;
      }
    }

    const registrationsByBucket: Record<string, number> = {};
    for (const row of regRes.data ?? []) {
      if (!row.onboarded_at) continue;
      const key = bucketKey(row.onboarded_at, grain);
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
      range_all_time: periodDays === "all",
      grain,
      total_users: onboardedCountRes.count ?? 0,
      by_access: byAccess,
      addon_buyers: addons,
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
