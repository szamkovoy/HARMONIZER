import type { SupabaseClient } from "@supabase/supabase-js";

const VISIBLE_TIERS = ["free", "oracle", "master"] as const;
type VisibleTier = (typeof VISIBLE_TIERS)[number];

export type EmailSegmentQuery = {
  /** Exclusive: all contacts linked to an app user. */
  all_installed?: boolean;
  /** Users created within the last 24 hours. */
  include_demo?: boolean;
  membership_tiers?: VisibleTier[];
  last_seen_within_days?: number | null;
  last_seen_older_than_days?: number | null;
  country_codes?: string[];
  locales?: string[];
  email_contains?: string;
  marketing_statuses?: string[];
};

export type EmailContactRow = {
  id: string;
  email: string;
  locale: string;
  country_code: string | null;
  user_id: string | null;
  source: string;
  marketing_status: string;
  unsubscribe_token: string | null;
};

const STATUS_VALUES = new Set(["active", "unsubscribed", "suppressed", "complained"]);

/** Accept number or numeric string from admin UI / JSON. */
function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.floor(value);
    return n > 0 ? n : null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Math.floor(Number(value.trim()));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Parse / sanitize segment JSON from admin UI. */
export function parseEmailSegmentQuery(raw: unknown): EmailSegmentQuery {
  const q = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: EmailSegmentQuery = {};

  if (Array.isArray(q.marketing_statuses)) {
    out.marketing_statuses = q.marketing_statuses.filter(
      (v): v is string => typeof v === "string" && STATUS_VALUES.has(v),
    );
  } else {
    out.marketing_statuses = ["active"];
  }

  out.all_installed = q.all_installed === true;
  out.include_demo = q.include_demo === true;

  if (Array.isArray(q.membership_tiers)) {
    out.membership_tiers = q.membership_tiers.filter((v): v is VisibleTier =>
      typeof v === "string" && (VISIBLE_TIERS as readonly string[]).includes(v),
    );
  }

  if (out.all_installed) {
    out.include_demo = false;
    out.membership_tiers = [];
  }

  out.last_seen_within_days = asPositiveInt(q.last_seen_within_days);
  out.last_seen_older_than_days = asPositiveInt(q.last_seen_older_than_days);

  if (Array.isArray(q.country_codes)) {
    out.country_codes = q.country_codes
      .filter((v): v is string => typeof v === "string" && /^[A-Z]{2}$/i.test(v.trim()))
      .map((v) => v.trim().toUpperCase());
  }
  if (Array.isArray(q.locales)) {
    out.locales = q.locales
      .filter((v): v is string => typeof v === "string" && v.trim().length >= 2)
      .map((v) => v.trim().slice(0, 2).toLowerCase());
  }
  if (typeof q.email_contains === "string" && q.email_contains.trim()) {
    out.email_contains = q.email_contains.trim().toLowerCase();
  }

  return out;
}

/**
 * Resolve contacts matching segment. Countries from the filtered set.
 */
export async function resolveEmailSegment(
  db: SupabaseClient,
  query: EmailSegmentQuery,
): Promise<{ contacts: EmailContactRow[]; countries: string[]; count: number }> {
  const statuses = query.marketing_statuses?.length
    ? query.marketing_statuses
    : ["active"];

  const hasAudience =
    query.all_installed === true ||
    query.include_demo === true ||
    Boolean(query.membership_tiers?.length);

  if (!hasAudience) {
    return { contacts: [], countries: [], count: 0 };
  }

  let contactQuery = db
    .from("email_contacts")
    .select("id, email, locale, country_code, user_id, source, marketing_status, unsubscribe_token")
    .in("marketing_status", statuses)
    .not("user_id", "is", null)
    .limit(20000);

  if (query.locales?.length) contactQuery = contactQuery.in("locale", query.locales);
  if (query.country_codes?.length) {
    contactQuery = contactQuery.in("country_code", query.country_codes);
  }
  // Narrow in SQL when possible; always re-filter in memory (PostgREST ilike + wildcards).
  if (query.email_contains) {
    const escaped = query.email_contains.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    contactQuery = contactQuery.ilike("email", `%${escaped}%`);
  }

  const { data: contactRows, error } = await contactQuery;
  if (error) throw error;

  let contacts = (contactRows ?? []) as EmailContactRow[];
  if (query.email_contains) {
    const needle = query.email_contains;
    contacts = contacts.filter((c) => c.email.toLowerCase().includes(needle));
  }
  if (contacts.length === 0) {
    return { contacts: [], countries: [], count: 0 };
  }

  const userIds = contacts.map((c) => c.user_id).filter((id): id is string => Boolean(id));
  const userMap = new Map<
    string,
    {
      membership_tier: string;
      last_seen_at: string | null;
      country_code: string | null;
      created_at: string | null;
    }
  >();

  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data: users, error: usersError } = await db
      .from("users")
      .select("id, membership_tier, last_seen_at, country_code, created_at")
      .in("id", chunk);
    if (usersError) throw usersError;
    for (const u of users ?? []) {
      userMap.set(u.id, {
        membership_tier: u.membership_tier,
        last_seen_at: u.last_seen_at,
        country_code: u.country_code,
        created_at: u.created_at,
      });
    }
  }

  const now = Date.now();
  const demoCutoff = now - 24 * 60 * 60 * 1000;
  const tiers = query.membership_tiers ?? [];

  contacts = contacts.filter((c) => {
    if (!c.user_id) return false;
    const u = userMap.get(c.user_id);
    if (!u) return false;

    if (!query.all_installed) {
      const isDemo =
        query.include_demo === true &&
        u.created_at != null &&
        new Date(u.created_at).getTime() >= demoCutoff;
      const tierOk =
        tiers.length > 0 && tiers.includes(u.membership_tier as VisibleTier);
      if (!isDemo && !tierOk) return false;
    }

    if (query.last_seen_within_days != null) {
      if (!u.last_seen_at) return false;
      const ageDays = (now - new Date(u.last_seen_at).getTime()) / 86400000;
      if (ageDays > query.last_seen_within_days) return false;
    }
    if (query.last_seen_older_than_days != null) {
      if (!u.last_seen_at) {
        // never seen → treat as older than any threshold
      } else {
        const ageDays = (now - new Date(u.last_seen_at).getTime()) / 86400000;
        if (ageDays < query.last_seen_older_than_days) return false;
      }
    }

    if (!c.country_code && u.country_code) {
      c = { ...c, country_code: u.country_code };
    }
    return true;
  });

  const countrySet = new Set<string>();
  for (const c of contacts) {
    if (c.country_code) countrySet.add(c.country_code.toUpperCase());
  }

  return { contacts, countries: [...countrySet].sort(), count: contacts.length };
}
