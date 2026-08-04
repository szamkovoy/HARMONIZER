import { accessNowSegment } from "../../../admin/_lib/accessNow";
import { emailsByUserId } from "../_utils/authEmails";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

function dateStart(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const d = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${d}T00:00:00.000Z`;
}

function dateEndExclusive(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const d = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const next = new Date(`${d}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function positiveInt(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const n = Math.floor(Number(raw.trim()));
  return Number.isFinite(n) && n > 0 ? n : null;
}

type UserRow = {
  id: string;
  email?: string | null;
  display_name: string | null;
  membership_tier: string | null;
  membership_expires_at: string | null;
  trial_expires_at: string | null;
  membership_started_at?: string | null;
  created_at: string | null;
  onboarded_at: string | null;
  last_seen_at?: string | null;
  locale?: string | null;
  country_code?: string | null;
  city?: string | null;
  marketing_status?: string | null;
};

const SORTS = new Set([
  "created_at",
  "onboarded_at",
  "tier_end",
  "last_seen",
  "last_payment",
  "access",
  "locale",
]);

/**
 * Список/поиск пользователей.
 * Query: q, locale, country_code, city, marketing_status,
 * onboarded_from/to, created_from/to, access (incl. not_in_harmonizer),
 * addon, addon_since, active_hours, last_seen_within_days,
 * last_seen_older_than_days, sort, order.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || null;
    const locale = url.searchParams.get("locale")?.trim() || null;
    const countryCode = url.searchParams.get("country_code")?.trim() || null;
    const city = url.searchParams.get("city")?.trim() || null;
    const marketingStatus = url.searchParams.get("marketing_status")?.trim() || null;
    const accessRaw = url.searchParams.get("access")?.trim() || null;
    const access =
      accessRaw === "trial" ||
      accessRaw === "navigator" ||
      accessRaw === "oracle" ||
      accessRaw === "master" ||
      accessRaw === "not_in_harmonizer"
        ? accessRaw
        : null;
    const addonRaw = url.searchParams.get("addon")?.trim() || null;
    const addon = addonRaw === "webinar" || addonRaw === "book" ? addonRaw : null;
    const addonSince = dateStart(url.searchParams.get("addon_since"));
    const hasSubTierRaw = url.searchParams.get("has_sub_tier")?.trim() || null;
    const hasSubTier =
      hasSubTierRaw === "oracle" || hasSubTierRaw === "master" ? hasSubTierRaw : null;
    const activeHoursRaw = Number(url.searchParams.get("active_hours"));
    const activeHours =
      activeHoursRaw === 24 || activeHoursRaw === 72 || activeHoursRaw === 168
        ? activeHoursRaw
        : null;
    const lastSeenWithin = positiveInt(url.searchParams.get("last_seen_within_days"));
    const lastSeenOlder = positiveInt(url.searchParams.get("last_seen_older_than_days"));
    const sortRaw = url.searchParams.get("sort")?.trim() || "created_at";
    const sort = SORTS.has(sortRaw) ? sortRaw : "created_at";
    const orderRaw = (url.searchParams.get("order")?.trim() || "desc").toLowerCase();
    const order = orderRaw === "asc" ? "asc" : "desc";

    const db = createServiceSupabase();

    let restrictIds: Set<string> | null = null;

    if (activeHours) {
      const since = new Date(Date.now() - activeHours * 60 * 60 * 1000).toISOString();
      const { data: events, error: evErr } = await db
        .from("user_event_log")
        .select("user_id")
        .gt("occurred_at", since)
        .limit(5000);
      if (evErr) throw evErr;
      restrictIds = new Set(
        (events ?? [])
          .map((e) => e.user_id as string | null)
          .filter((id): id is string => Boolean(id)),
      );
      if (restrictIds.size === 0) {
        return json({ users: [] });
      }
    }

    if (addon) {
      let cq = db
        .from("payment_contracts")
        .select("user_id")
        .eq("tier", addon)
        .eq("status", "active")
        .not("user_id", "is", null);
      if (addonSince) cq = cq.gte("created_at", addonSince);
      const { data: contracts, error: cErr } = await cq;
      if (cErr) throw cErr;
      const addonIds = new Set(
        (contracts ?? [])
          .map((c) => c.user_id as string | null)
          .filter((id): id is string => Boolean(id)),
      );
      if (addonIds.size === 0) {
        return json({ users: [] });
      }
      restrictIds = restrictIds
        ? new Set([...restrictIds].filter((id) => addonIds.has(id)))
        : addonIds;
      if (restrictIds.size === 0) {
        return json({ users: [] });
      }
    }

    // Cohort dig-down: users with subscription contract (active/cancelled) for oracle|master.
    if (hasSubTier) {
      const { data: contracts, error: cErr } = await db
        .from("payment_contracts")
        .select("user_id")
        .eq("tier", hasSubTier)
        .eq("product_kind", "subscription")
        .in("status", ["active", "cancelled"])
        .not("user_id", "is", null);
      if (cErr) throw cErr;
      const subIds = new Set(
        (contracts ?? [])
          .map((c) => c.user_id as string | null)
          .filter((id): id is string => Boolean(id)),
      );
      if (subIds.size === 0) {
        return json({ users: [] });
      }
      restrictIds = restrictIds
        ? new Set([...restrictIds].filter((id) => subIds.has(id)))
        : subIds;
      if (restrictIds.size === 0) {
        return json({ users: [] });
      }
    }

    // Active-hours dig-down: load those users directly (matches admin_active_users_count).
    if (activeHours && restrictIds) {
      const ids = [...restrictIds].slice(0, 200);
      const { data: rows, error: uErr } = await db
        .from("users")
        .select(
          "id, display_name, membership_tier, membership_expires_at, trial_expires_at, membership_started_at, created_at, onboarded_at, last_seen_at, locale, country_code, city",
        )
        .in("id", ids);
      if (uErr) throw uErr;

      const emails = await emailsByUserId(db, ids);
      let users: UserRow[] = (rows ?? []).map((u) => ({
        ...u,
        email: emails.get(u.id) ?? null,
        marketing_status: null,
      }));

      if (q) {
        const qq = q.toLowerCase();
        users = users.filter(
          (u) =>
            (u.email ?? "").toLowerCase().includes(qq) ||
            (u.display_name ?? "").toLowerCase().includes(qq),
        );
      }
      if (locale) users = users.filter((u) => u.locale === locale);
      if (countryCode) {
        users = users.filter(
          (u) => (u.country_code ?? "").toUpperCase() === countryCode.toUpperCase(),
        );
      }
      if (city) {
        const c = city.toLowerCase();
        users = users.filter((u) => (u.city ?? "").toLowerCase().includes(c));
      }
      if (access === "not_in_harmonizer") {
        users = users.filter((u) => !u.onboarded_at);
      } else if (access) {
        users = users.filter(
          (u) =>
            Boolean(u.onboarded_at) &&
            accessNowSegment({
              membership_tier: u.membership_tier,
              membership_expires_at: u.membership_expires_at,
              trial_expires_at: u.trial_expires_at,
            }) === access,
        );
      }
      if (lastSeenWithin != null) {
        const cutoff = Date.now() - lastSeenWithin * 86400000;
        users = users.filter(
          (u) => u.last_seen_at && Date.parse(u.last_seen_at) >= cutoff,
        );
      }
      if (lastSeenOlder != null) {
        const cutoff = Date.now() - lastSeenOlder * 86400000;
        users = users.filter(
          (u) => !u.last_seen_at || Date.parse(u.last_seen_at) < cutoff,
        );
      }

      users.sort(
        (a, b) =>
          new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      );
      return json({ users });
    }

    const limit = access || addon || hasSubTier ? 200 : 100;

    const { data, error } = await db.rpc("admin_search_users", {
      p_query: q,
      p_tier: null,
      p_locale: locale,
      p_country_code: countryCode,
      p_city: city,
      p_marketing_status: marketingStatus,
      p_onboarded_from: dateStart(url.searchParams.get("onboarded_from")),
      p_onboarded_to: dateEndExclusive(url.searchParams.get("onboarded_to")),
      p_created_from: dateStart(url.searchParams.get("created_from")),
      p_created_to: dateEndExclusive(url.searchParams.get("created_to")),
      p_limit: limit,
      p_access: access,
      p_last_seen_within_days: lastSeenWithin,
      p_last_seen_older_than_days: lastSeenOlder,
      p_sort: sort,
      p_order: order,
    });
    if (error) throw error;

    let users = (data ?? []) as UserRow[];

    if (restrictIds) {
      users = users.filter((u) => restrictIds!.has(u.id));
    }

    return json({ users });
  } catch (error) {
    return errorResponse(error);
  }
}
