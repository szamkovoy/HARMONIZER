import { randomBytes } from "crypto";

import { accessNowSegment } from "../../../admin/_lib/accessNow";
import { emailsByUserId } from "../_utils/authEmails";
import { enrichUsersAutoRenewCancelled } from "../_utils/autoRenewCancelled";
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

function nonNegInt(raw: string | null, fallback: number): number {
  if (raw == null || !raw.trim()) return fallback;
  const n = Math.floor(Number(raw.trim()));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

type UserRow = {
  id: string;
  email?: string | null;
  display_name: string | null;
  last_name?: string | null;
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
  crm_imported_at?: string | null;
  phone?: string | null;
  getcourse_last_activity_at?: string | null;
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

function parseAccess(raw: string | null): string | null {
  return raw === "trial" ||
    raw === "navigator" ||
    raw === "oracle" ||
    raw === "master" ||
    raw === "not_in_harmonizer" ||
    raw === "email_only"
    ? raw
    : null;
}

/** Safe pre-check: email_contacts only (never generateLink — it can create auth users). */
async function resolveContactUserId(
  db: ReturnType<typeof createServiceSupabase>,
  email: string,
): Promise<string | null> {
  const { data: contact } = await db
    .from("email_contacts")
    .select("user_id")
    .eq("email_normalized", email)
    .maybeSingle();
  return (contact?.user_id as string | null) ?? null;
}

/** Resolve auth id when user is known to exist (createUser conflict). */
async function resolveAuthUserIdByEmail(
  db: ReturnType<typeof createServiceSupabase>,
  email: string,
): Promise<string | null> {
  const fromContact = await resolveContactUserId(db, email);
  if (fromContact) return fromContact;
  try {
    const { data, error } = await db.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (!error && data?.user?.id) return data.user.id;
  } catch {
    /* ignore */
  }
  return null;
}

type CrmProfilePatch = {
  displayName: string | null;
  lastName: string | null;
  phone: string | null;
  countryCode: string | null;
  city: string | null;
  birthDate: string | null;
};

async function waitForUsersRow(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const { data } = await db.from("users").select("id").eq("id", userId).maybeSingle();
    if (data?.id) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`users row missing for ${userId}`);
}

async function applyCrmMarketingProfile(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  profile: CrmProfilePatch,
): Promise<void> {
  await waitForUsersRow(db, userId);

  const patch: Record<string, unknown> = {
    crm_imported_at: new Date().toISOString(),
    membership_tier: "free",
    trial_expires_at: null,
    onboarded_at: null,
    last_seen_at: null,
  };
  if (profile.displayName) patch.display_name = profile.displayName;
  if (profile.lastName) patch.last_name = profile.lastName;
  if (profile.phone) patch.phone = profile.phone;
  if (profile.countryCode) patch.country_code = profile.countryCode;
  if (profile.city) patch.city = profile.city;
  if (profile.birthDate) patch.birth_date = profile.birthDate;

  const { error: upErr } = await db.from("users").update(patch).eq("id", userId);
  if (upErr) throw upErr;

  const token = randomBytes(24).toString("hex");
  const { error: ecErr } = await db.from("email_contacts").upsert(
    {
      email,
      email_normalized: email,
      user_id: userId,
      source: "app",
      locale: "ru",
      country_code: profile.countryCode,
      marketing_status: "active",
      unsubscribe_token: token,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email_normalized" },
  );
  if (ecErr) {
    await db.rpc("sync_email_contacts_from_users");
  }
}

/**
 * Список/поиск пользователей.
 * Query: q, locale, country_code, city, marketing_status,
 * onboarded_from/to, created_from/to, access (incl. not_in_harmonizer),
 * addon, addon_since, active_hours, last_seen_within_days,
 * last_seen_older_than_days, sort, order, limit, offset.
 * Response: { users, total, limit, offset }.
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
    const access = parseAccess(url.searchParams.get("access")?.trim() || null);
    const crmProductSlug = url.searchParams.get("crm_product")?.trim() || null;
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
    const limit = Math.min(100, Math.max(1, nonNegInt(url.searchParams.get("limit"), 50) || 50));
    const offset = nonNegInt(url.searchParams.get("offset"), 0);

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
        return json({ users: [], total: 0, limit, offset });
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
        return json({ users: [], total: 0, limit, offset });
      }
      restrictIds = restrictIds
        ? new Set([...restrictIds].filter((id) => addonIds.has(id)))
        : addonIds;
      if (restrictIds.size === 0) {
        return json({ users: [], total: 0, limit, offset });
      }
    }

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
        return json({ users: [], total: 0, limit, offset });
      }
      restrictIds = restrictIds
        ? new Set([...restrictIds].filter((id) => subIds.has(id)))
        : subIds;
      if (restrictIds.size === 0) {
        return json({ users: [], total: 0, limit, offset });
      }
    }

    // Dig-down by event/addon/sub IDs: filter in memory, then page.
    if (restrictIds) {
      const ids = [...restrictIds].slice(0, 500);
      const { data: rows, error: uErr } = await db
        .from("users")
        .select(
          "id, display_name, last_name, membership_tier, membership_expires_at, trial_expires_at, membership_started_at, created_at, onboarded_at, last_seen_at, locale, country_code, city, crm_imported_at, phone, getcourse_last_activity_at",
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
            (u.display_name ?? "").toLowerCase().includes(qq) ||
            (u.last_name ?? "").toLowerCase().includes(qq),
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
      if (access === "email_only") {
        users = users.filter(
          (u) => u.crm_imported_at && !u.onboarded_at && !u.last_seen_at,
        );
      } else if (access === "not_in_harmonizer") {
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
      const total = users.length;
      const page = users.slice(offset, offset + limit);
      return json({
        users: await enrichUsersAutoRenewCancelled(db, page),
        total,
        limit,
        offset,
      });
    }

    const filterArgs = {
      p_query: q,
      p_tier: null as string | null,
      p_locale: locale,
      p_country_code: countryCode,
      p_city: city,
      p_marketing_status: marketingStatus,
      p_onboarded_from: dateStart(url.searchParams.get("onboarded_from")),
      p_onboarded_to: dateEndExclusive(url.searchParams.get("onboarded_to")),
      p_created_from: dateStart(url.searchParams.get("created_from")),
      p_created_to: dateEndExclusive(url.searchParams.get("created_to")),
      p_access: access,
      p_last_seen_within_days: lastSeenWithin,
      p_last_seen_older_than_days: lastSeenOlder,
      p_crm_product_slug: crmProductSlug,
    };

    const { data: totalRaw, error: countErr } = await db.rpc("admin_count_users", filterArgs);
    if (countErr) throw countErr;
    const total = Number(totalRaw) || 0;

    const { data, error } = await db.rpc("admin_search_users", {
      ...filterArgs,
      p_limit: limit,
      p_offset: offset,
      p_sort: sort,
      p_order: order,
    });
    if (error) throw error;

    const users = (data ?? []) as UserRow[];

    return json({
      users: await enrichUsersAutoRenewCancelled(db, users),
      total,
      limit,
      offset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Ручное добавление в маркетинговую базу (как CRM-импорт, без OTP).
 * Body: { email, display_name?, last_name?, phone?, country_code?, city?, birth_date? }
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as {
      email?: string;
      display_name?: string;
      last_name?: string;
      phone?: string;
      country_code?: string;
      city?: string;
      birth_date?: string;
    };

    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    if (!email.includes("@") || email.length > 320) {
      return json({ error: "Укажите корректный email" }, { status: 400 });
    }

    /** Empty / UI-placeholder strings must not be persisted. */
    const cleanText = (raw: unknown, placeholders: string[] = []): string | null => {
      const v = String(raw ?? "").trim();
      if (!v) return null;
      const lower = v.toLowerCase();
      if (placeholders.some((p) => p.toLowerCase() === lower)) return null;
      return v;
    };

    const displayName = cleanText(body.display_name, ["Имя"]);
    const lastName = cleanText(body.last_name, ["Фамилия"]);
    const phone = cleanText(body.phone, ["Телефон"]);
    const countryRaw = String(body.country_code ?? "")
      .trim()
      .toUpperCase()
      .slice(0, 2);
    const countryCode = countryRaw.length === 2 ? countryRaw : null;
    const city = cleanText(body.city, ["Город", "Город…"]);
    const birthRaw = String(body.birth_date ?? "").trim();
    const birthDate =
      birthRaw && /^\d{4}-\d{2}-\d{2}$/.test(birthRaw) ? birthRaw : null;

    const db = createServiceSupabase();
    const profile: CrmProfilePatch = {
      displayName,
      lastName,
      phone,
      countryCode,
      city,
      birthDate,
    };

    // If already in contacts and is a real Harmonizer / finished CRM row → 409.
    // Incomplete rows (auth created but CRM fields missing) are completed below.
    const contactId = await resolveContactUserId(db, email);
    if (contactId) {
      const { data: row } = await db
        .from("users")
        .select("crm_imported_at, onboarded_at, last_seen_at")
        .eq("id", contactId)
        .maybeSingle();
      const isLive = Boolean(row?.onboarded_at || row?.last_seen_at);
      const alreadyCrm = Boolean(row?.crm_imported_at);
      if (isLive || alreadyCrm) {
        return json(
          {
            error: "Пользователь с таким email уже есть в базе",
            code: "exists",
            userId: contactId,
            email,
          },
          { status: 409 },
        );
      }
      await applyCrmMarketingProfile(db, contactId, email, profile);
      return json({ id: contactId, email, completed: true }, { status: 201 });
    }

    const created = await db.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: displayName || undefined,
        crm_import: true,
      },
    });

    let userId = created.data.user?.id ?? null;

    if (created.error) {
      const msg = created.error.message || String(created.error);
      if (!/already|registered|exists/i.test(msg)) throw created.error;
      userId = await resolveAuthUserIdByEmail(db, email);
      if (!userId) {
        return json(
          {
            error: "Пользователь с таким email уже есть в базе",
            code: "exists",
            userId: null,
            email,
          },
          { status: 409 },
        );
      }
      const { data: row } = await db
        .from("users")
        .select("crm_imported_at, onboarded_at, last_seen_at")
        .eq("id", userId)
        .maybeSingle();
      if (row?.onboarded_at || row?.last_seen_at || row?.crm_imported_at) {
        return json(
          {
            error: "Пользователь с таким email уже есть в базе",
            code: "exists",
            userId,
            email,
          },
          { status: 409 },
        );
      }
      // Interrupted prior create — finish CRM profile and treat as success.
      await applyCrmMarketingProfile(db, userId, email, profile);
      return json({ id: userId, email, completed: true }, { status: 201 });
    }

    if (!userId) throw new Error("createUser returned no id");

    await applyCrmMarketingProfile(db, userId, email, profile);
    return json({ id: userId, email }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
