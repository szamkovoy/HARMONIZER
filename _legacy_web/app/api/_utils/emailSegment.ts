import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isEmailCopyEmpty,
  resolveExactEmailCopy,
  type EmailCopySource,
} from "./emailCopy";

/**
 * Hosted PostgREST `max_rows` (and local `supabase/config.toml`) silently cap
 * a single table select. `.limit(20000)` still returns at most this many rows.
 */
export const POSTGREST_PAGE_SIZE = 1000;

const VISIBLE_TIERS = ["free", "oracle", "master"] as const;
type VisibleTier = (typeof VISIBLE_TIERS)[number];

export type EmailSegmentQuery = {
  /**
   * All active rows in email_contacts (imported + app + forms), including
   * people who never installed Harmonizer.
   */
  all_contacts?: boolean;
  /**
   * Contacts linked to an app user (OTP confirmed → auth.users → sync).
   * Exclusive vs all_contacts / tier chips.
   */
  all_installed?: boolean;
  /**
   * Active product trial (`users.trial_expires_at > now()`).
   * Same «Демо» as admin users list / dashboard — not a membership_tier.
   */
  include_demo?: boolean;
  /** App users created within the last 24 hours (registration cohort). */
  include_new_24h?: boolean;
  /**
   * Linked app user with users.onboarded_at IS NULL, excluding GetCourse
   * email-only imports (those use email_only).
   */
  not_in_harmonizer?: boolean;
  /**
   * GetCourse import who never opened the app
   * (crm_imported_at set, no onboarded_at, no last_seen_at).
   */
  email_only?: boolean;
  membership_tiers?: VisibleTier[];
  last_seen_within_days?: number | null;
  last_seen_older_than_days?: number | null;
  /** Account created in system (users.created_at), YYYY-MM-DD inclusive. */
  account_created_on_or_after?: string | null;
  account_created_on_or_before?: string | null;
  /** Harmonizer onboarding (users.onboarded_at), YYYY-MM-DD inclusive. */
  onboarded_on_or_after?: string | null;
  onboarded_on_or_before?: string | null;
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

/** YYYY-MM-DD only. */
function asDateOnly(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const ms = Date.parse(`${t}T00:00:00.000Z`);
  return Number.isFinite(ms) ? t : null;
}

function dayStartMs(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}

function dayEndMs(dateOnly: string): number {
  return Date.parse(`${dateOnly}T23:59:59.999Z`);
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

  out.all_contacts = q.all_contacts === true;
  out.all_installed = q.all_installed === true;
  out.include_demo = q.include_demo === true;
  out.include_new_24h = q.include_new_24h === true;
  out.not_in_harmonizer = q.not_in_harmonizer === true;
  out.email_only = q.email_only === true;

  if (Array.isArray(q.membership_tiers)) {
    out.membership_tiers = q.membership_tiers.filter((v): v is VisibleTier =>
      typeof v === "string" && (VISIBLE_TIERS as readonly string[]).includes(v),
    );
  }

  if (out.all_contacts) {
    out.all_installed = false;
    out.include_demo = false;
    out.include_new_24h = false;
    out.not_in_harmonizer = false;
    out.email_only = false;
    out.membership_tiers = [];
  } else if (out.all_installed) {
    out.include_demo = false;
    out.include_new_24h = false;
    out.not_in_harmonizer = false;
    out.email_only = false;
    out.membership_tiers = [];
  }

  out.last_seen_within_days = asPositiveInt(q.last_seen_within_days);
  out.last_seen_older_than_days = asPositiveInt(q.last_seen_older_than_days);
  out.account_created_on_or_after = asDateOnly(q.account_created_on_or_after);
  out.account_created_on_or_before = asDateOnly(q.account_created_on_or_before);
  out.onboarded_on_or_after = asDateOnly(q.onboarded_on_or_after);
  out.onboarded_on_or_before = asDateOnly(q.onboarded_on_or_before);

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

  return normalizeEmailSegmentAudience(out);
}

/** True when at least one audience chip is active. */
export function hasEmailSegmentAudience(query: EmailSegmentQuery): boolean {
  return (
    query.all_contacts === true ||
    query.all_installed === true ||
    query.include_demo === true ||
    query.include_new_24h === true ||
    query.not_in_harmonizer === true ||
    query.email_only === true ||
    Boolean(query.membership_tiers?.length)
  );
}

/**
 * Email-fragment search without chips → whole email_contacts base
 * (not only app installers).
 */
export function normalizeEmailSegmentAudience(
  query: EmailSegmentQuery,
): EmailSegmentQuery {
  if (hasEmailSegmentAudience(query)) return query;
  if (!query.email_contains) return query;
  return {
    ...query,
    all_contacts: true,
    all_installed: false,
    include_demo: false,
    include_new_24h: false,
    not_in_harmonizer: false,
    email_only: false,
    membership_tiers: [],
  };
}

/** Walk PostgREST pages so a segment is not truncated at `max_rows` (1000). */
export async function fetchAllPostgrestRows<T>(
  loadPage: (from: number, to: number) => Promise<T[]>,
  pageSize = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  if (pageSize <= 0) return [];
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const page = await loadPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/** Payload for `email_segment_resolve` (mirrors parseEmailSegmentQuery fields). */
export function segmentQueryToRpcPayload(query: EmailSegmentQuery): Record<string, unknown> {
  return {
    all_contacts: query.all_contacts === true,
    all_installed: query.all_installed === true,
    include_demo: query.include_demo === true,
    include_new_24h: query.include_new_24h === true,
    not_in_harmonizer: query.not_in_harmonizer === true,
    email_only: query.email_only === true,
    membership_tiers: query.membership_tiers ?? [],
    marketing_statuses: query.marketing_statuses?.length
      ? query.marketing_statuses
      : ["active"],
    locales: query.locales ?? [],
    country_codes: query.country_codes ?? [],
    email_contains: query.email_contains ?? null,
    last_seen_within_days: query.last_seen_within_days ?? null,
    last_seen_older_than_days: query.last_seen_older_than_days ?? null,
    account_created_on_or_after: query.account_created_on_or_after ?? null,
    account_created_on_or_before: query.account_created_on_or_before ?? null,
    onboarded_on_or_after: query.onboarded_on_or_after ?? null,
    onboarded_on_or_before: query.onboarded_on_or_before ?? null,
  };
}

type EmailSegmentResolveResult = {
  contacts: EmailContactRow[];
  countries: string[];
  count: number;
  no_audience?: boolean;
};

function parseRpcSegmentResult(
  raw: unknown,
  mode: "count" | "list",
): EmailSegmentResolveResult | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const count = typeof row.count === "number" ? row.count : Number(row.count);
  if (!Number.isFinite(count)) return null;
  const countries = Array.isArray(row.countries)
    ? row.countries.filter((c): c is string => typeof c === "string")
    : [];
  const noAudience = row.no_audience === true;
  if (mode === "count" || noAudience) {
    return {
      contacts: [],
      countries,
      count: noAudience ? 0 : count,
      no_audience: noAudience || undefined,
    };
  }
  const contactsRaw = Array.isArray(row.contacts) ? row.contacts : [];
  const contacts: EmailContactRow[] = [];
  for (const item of contactsRaw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.email !== "string") continue;
    contacts.push({
      id: c.id,
      email: c.email,
      locale: typeof c.locale === "string" ? c.locale : "ru",
      country_code: typeof c.country_code === "string" ? c.country_code : null,
      user_id: typeof c.user_id === "string" ? c.user_id : null,
      source: typeof c.source === "string" ? c.source : "app",
      marketing_status:
        typeof c.marketing_status === "string" ? c.marketing_status : "active",
      unsubscribe_token:
        typeof c.unsubscribe_token === "string" ? c.unsubscribe_token : null,
    });
  }
  return { contacts, countries, count };
}

/**
 * Resolve contacts matching segment. Countries from the filtered set.
 * Prefer live `users.locale` over stale `email_contacts.locale`.
 * Fast path: SQL RPC `email_segment_resolve` (one round-trip; list as jsonb).
 * Fallback: paginated PostgREST if the RPC migration is not applied yet.
 */
export async function resolveEmailSegment(
  db: SupabaseClient,
  query: EmailSegmentQuery,
  options?: { mode?: "count" | "list" },
): Promise<EmailSegmentResolveResult> {
  const mode = options?.mode ?? "list";

  if (!hasEmailSegmentAudience(query)) {
    return { contacts: [], countries: [], count: 0, no_audience: true };
  }

  const { data, error } = await db.rpc("email_segment_resolve", {
    p_query: segmentQueryToRpcPayload(query),
    p_mode: mode,
  });
  if (!error) {
    const parsed = parseRpcSegmentResult(data, mode);
    if (parsed) return parsed;
  } else {
    const msg = error.message ?? "";
    const missingFn =
      /email_segment_resolve/i.test(msg) &&
      (/could not find/i.test(msg) || /PGRST202/i.test(msg) || /42883/.test(msg));
    if (!missingFn) throw error;
  }

  if (mode === "count") {
    const legacy = await resolveEmailSegmentLegacy(db, query);
    return {
      contacts: [],
      countries: legacy.countries,
      count: legacy.count,
      no_audience: legacy.no_audience,
    };
  }
  return resolveEmailSegmentLegacy(db, query);
}

/** Paginated PostgREST resolve — slow on large bases; RPC fallback only. */
async function resolveEmailSegmentLegacy(
  db: SupabaseClient,
  query: EmailSegmentQuery,
): Promise<EmailSegmentResolveResult> {
  const statuses = query.marketing_statuses?.length
    ? query.marketing_statuses
    : ["active"];

  const needsAppUser =
    query.all_installed === true ||
    query.include_demo === true ||
    query.include_new_24h === true ||
    query.not_in_harmonizer === true ||
    query.email_only === true ||
    Boolean(query.membership_tiers?.length);

  let contacts = await fetchAllPostgrestRows<EmailContactRow>(async (from, to) => {
    let contactQuery = db
      .from("email_contacts")
      .select("id, email, locale, country_code, user_id, source, marketing_status, unsubscribe_token")
      .in("marketing_status", statuses);

    // «Все установившие» / тарифы / демо — только контакты с аккаунтом приложения.
    if (needsAppUser) {
      contactQuery = contactQuery.not("user_id", "is", null);
    }

    // Locale is filtered after merging users.locale (preferred over contact.locale).
    if (query.country_codes?.length) {
      contactQuery = contactQuery.in("country_code", query.country_codes);
    }
    // Narrow in SQL when possible; always re-filter in memory (PostgREST ilike + wildcards).
    if (query.email_contains) {
      const escaped = query.email_contains
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      contactQuery = contactQuery.ilike("email", `%${escaped}%`);
    }

    const { data, error } = await contactQuery
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as EmailContactRow[];
  });
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
      onboarded_at: string | null;
      trial_expires_at: string | null;
      locale: string | null;
      crm_imported_at: string | null;
    }
  >();

  const CHUNK = 500;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const chunk = userIds.slice(i, i + CHUNK);
    const { data: users, error: usersError } = await db
      .from("users")
      .select(
        "id, membership_tier, last_seen_at, country_code, created_at, onboarded_at, trial_expires_at, locale, crm_imported_at",
      )
      .in("id", chunk);
    if (usersError) throw usersError;
    for (const u of users ?? []) {
      userMap.set(u.id, {
        membership_tier: u.membership_tier,
        last_seen_at: u.last_seen_at,
        country_code: u.country_code,
        created_at: u.created_at,
        onboarded_at: u.onboarded_at,
        trial_expires_at: u.trial_expires_at,
        locale: u.locale,
        crm_imported_at: u.crm_imported_at ?? null,
      });
    }
  }

  const now = Date.now();
  const new24hCutoff = now - 24 * 60 * 60 * 1000;
  const tiers = query.membership_tiers ?? [];

  contacts = contacts.flatMap((c) => {
    // Contacts without an app user: only in «Вся база» (all_contacts).
    if (!c.user_id) {
      if (!query.all_contacts) return [];
      if (query.last_seen_within_days != null) return [];
      if (query.account_created_on_or_after || query.account_created_on_or_before) {
        return [];
      }
      if (query.onboarded_on_or_after || query.onboarded_on_or_before) {
        return [];
      }
      return [c];
    }

    const u = userMap.get(c.user_id);
    if (!u) {
      if (query.account_created_on_or_after || query.account_created_on_or_before) {
        return [];
      }
      if (query.onboarded_on_or_after || query.onboarded_on_or_before) {
        return [];
      }
      // Orphan link — still OK for all_contacts email search.
      if (query.all_contacts && !needsAppUser) return [c];
      return [];
    }

    const isEmailOnly =
      Boolean(u.crm_imported_at) && u.onboarded_at == null && u.last_seen_at == null;

    if (!query.all_installed && !query.all_contacts) {
      const onTrial =
        u.trial_expires_at != null &&
        new Date(u.trial_expires_at).getTime() > now;
      const isDemo = query.include_demo === true && onTrial;
      const isNew24h =
        query.include_new_24h === true &&
        u.created_at != null &&
        new Date(u.created_at).getTime() >= new24hCutoff;
      const isNotInHarm =
        query.not_in_harmonizer === true &&
        u.onboarded_at == null &&
        !isEmailOnly;
      const isEmailOnlySeg = query.email_only === true && isEmailOnly;
      // «Навигатор» = free without active trial (same as users access=navigator).
      const tierOk =
        tiers.length > 0 &&
        tiers.includes(u.membership_tier as VisibleTier) &&
        !(u.membership_tier === "free" && onTrial) &&
        !isEmailOnly;
      if (!isDemo && !isNew24h && !isNotInHarm && !isEmailOnlySeg && !tierOk) {
        return [];
      }
    }

    if (query.last_seen_within_days != null) {
      if (!u.last_seen_at) return [];
      const ageDays = (now - new Date(u.last_seen_at).getTime()) / 86400000;
      if (ageDays > query.last_seen_within_days) return [];
    }
    if (query.last_seen_older_than_days != null) {
      if (!u.last_seen_at) {
        // never seen → treat as older than any threshold
      } else {
        const ageDays = (now - new Date(u.last_seen_at).getTime()) / 86400000;
        if (ageDays < query.last_seen_older_than_days) return [];
      }
    }

    if (query.account_created_on_or_after || query.account_created_on_or_before) {
      if (!u.created_at) return [];
      const t = new Date(u.created_at).getTime();
      if (
        query.account_created_on_or_after &&
        t < dayStartMs(query.account_created_on_or_after)
      ) {
        return [];
      }
      if (
        query.account_created_on_or_before &&
        t > dayEndMs(query.account_created_on_or_before)
      ) {
        return [];
      }
    }

    if (query.onboarded_on_or_after || query.onboarded_on_or_before) {
      if (!u.onboarded_at) return [];
      const t = new Date(u.onboarded_at).getTime();
      if (
        query.onboarded_on_or_after &&
        t < dayStartMs(query.onboarded_on_or_after)
      ) {
        return [];
      }
      if (
        query.onboarded_on_or_before &&
        t > dayEndMs(query.onboarded_on_or_before)
      ) {
        return [];
      }
    }

    let next = c;
    if (!next.country_code && u.country_code) {
      next = { ...next, country_code: u.country_code };
    }
    const userLocale = typeof u.locale === "string" ? u.locale.trim() : "";
    if (userLocale) {
      next = { ...next, locale: userLocale };
    }
    if (query.locales?.length) {
      const loc = (next.locale || "").slice(0, 2).toLowerCase();
      if (!query.locales.includes(loc)) return [];
    }
    return [next];
  });

  // Contacts without users already returned above; apply locale filter for all_contacts leftovers.
  if (query.locales?.length && query.all_contacts) {
    contacts = contacts.filter((c) =>
      query.locales!.includes((c.locale || "").slice(0, 2).toLowerCase()),
    );
  }

  const countrySet = new Set<string>();
  for (const c of contacts) {
    if (c.country_code) countrySet.add(c.country_code.toUpperCase());
  }

  return { contacts, countries: [...countrySet].sort(), count: contacts.length };
}

export type CampaignRecipientRow = {
  contact: EmailContactRow;
  locale: string;
  subject: string;
  htmlBody: string;
};

/**
 * Same eligibility as campaign send: segment ∩ exact authored locale copy.
 * Empty copy → count-only segment resolve (no contact payload).
 */
export async function resolveCampaignRecipients(
  db: SupabaseClient,
  query: EmailSegmentQuery,
  copySource: EmailCopySource,
): Promise<{
  eligible: CampaignRecipientRow[];
  segmentCount: number;
  skippedLocaleCount: number;
  countries: string[];
  no_audience?: boolean;
  copyEmpty?: boolean;
}> {
  if (!hasEmailSegmentAudience(query)) {
    return {
      eligible: [],
      segmentCount: 0,
      skippedLocaleCount: 0,
      countries: [],
      no_audience: true,
    };
  }

  if (isEmailCopyEmpty(copySource)) {
    const segment = await resolveEmailSegment(db, query, { mode: "count" });
    return {
      eligible: [],
      segmentCount: segment.count,
      skippedLocaleCount: 0,
      countries: segment.countries,
      copyEmpty: true,
      no_audience: segment.no_audience,
    };
  }

  const segment = await resolveEmailSegment(db, query, { mode: "list" });
  if (segment.no_audience) {
    return {
      eligible: [],
      segmentCount: 0,
      skippedLocaleCount: 0,
      countries: [],
      no_audience: true,
    };
  }

  const eligible: CampaignRecipientRow[] = [];
  let skippedLocaleCount = 0;
  for (const contact of segment.contacts) {
    const exact = resolveExactEmailCopy(contact.locale, copySource);
    if (!exact) {
      skippedLocaleCount += 1;
      continue;
    }
    eligible.push({
      contact,
      locale: exact.locale,
      subject: exact.subject,
      htmlBody: exact.htmlBody,
    });
  }

  return {
    eligible,
    segmentCount: segment.count,
    skippedLocaleCount,
    countries: segment.countries,
  };
}
