import { normalizeFxCurrency, settleGrantPayment } from "../../../account/fx";
import { wipeUserAccount } from "../../../account/wipeUserAccount";
import {
  cityFromLocationName,
  locationSuggestsDistrictContext,
  looksLikeDistrictName,
  repairCityField,
} from "../../../_utils/geoCity";
import {
  clearGeoPlaceCache,
  resolveGeoPlaceCached,
} from "../../../_utils/geoReverseResolve";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { emailsByUserId } from "../../_utils/authEmails";
import { loadAdminPaymentLedger } from "../../_utils/paymentLedger";
import { ALL_TIERS, PAID_TIERS, recomputeUserMembershipFromPayments } from "../../_utils/payments";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

const HISTORY_LIMIT = 10;

function membershipLooksStale(user: {
  membership_tier: string;
  membership_expires_at: string | null;
}): boolean {
  if (!PAID_TIERS.has(user.membership_tier)) return false;
  if (!user.membership_expires_at) return false;
  return Date.parse(user.membership_expires_at) <= Date.now();
}

/** Карточка пользователя: общее / гармонизатор, платежи, письма, пуши. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const userSelect =
      "id, display_name, membership_tier, membership_expires_at, locale, created_at, onboarded_at, country_code, city, location_name, lat, lon, skip_email_automations, last_seen_at";
    const { data, error } = await db.from("users").select(userSelect).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Пользователь не найден" }, { status: 404 });
    let user = data;

    if (membershipLooksStale(user)) {
      await recomputeUserMembershipFromPayments(db, id);
      const refreshed = await db.from("users").select(userSelect).eq("id", id).maybeSingle();
      if (refreshed.error) throw refreshed.error;
      if (refreshed.data) user = refreshed.data;
    }

    // Repair district label / village-in-district → town/city (Nominatim zoom=10).
    const lat = typeof user.lat === "number" ? user.lat : Number(user.lat);
    const lon = typeof user.lon === "number" ? user.lon : Number(user.lon);
    const locationHead = cityFromLocationName(user.location_name);
    // Village / district label while location still has «муниципальный округ» → upgrade.
    const needsCityUpgrade =
      looksLikeDistrictName(user.city) ||
      (locationSuggestsDistrictContext(user.location_name) &&
        Boolean(user.city) &&
        (user.city === locationHead || looksLikeDistrictName(user.city)));
    if (needsCityUpgrade && Number.isFinite(lat) && Number.isFinite(lon)) {
      let fixed: string | null = repairCityField({
        city: user.city,
        location_name: user.location_name,
      });
      try {
        clearGeoPlaceCache();
        const { place } = await resolveGeoPlaceCached(lat, lon);
        if (place.city) fixed = place.city;
        if (place.country_code) {
          user = { ...user, country_code: place.country_code };
        }
        if (place.location_name) {
          user = { ...user, location_name: place.location_name };
        }
      } catch (geoErr) {
        console.warn("[admin/users] city reverse repair failed", geoErr);
      }
      if (fixed && fixed !== user.city) {
        const patch: Record<string, string | number> = {
          city: fixed,
          geo_place_lat: lat,
          geo_place_lon: lon,
        };
        if (user.country_code) patch.country_code = user.country_code;
        if (user.location_name) patch.location_name = user.location_name;
        await db.from("users").update(patch).eq("id", id);
        user = { ...user, city: fixed };
      }
    }

    const [emails, payments, lastEventRes, contactRes, notifRes, contractRes] =
      await Promise.all([
        emailsByUserId(db, [id]),
        loadAdminPaymentLedger(db, { userId: id, limit: 100 }),
        db
          .from("user_event_log")
          .select("occurred_at")
          .eq("user_id", id)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("email_contacts")
          .select("id, email, marketing_status")
          .eq("user_id", id)
          .maybeSingle(),
        db
          .from("notification_deliveries")
          .select(
            "id, title, body, created_at, notification_id, read_at, kind, notifications(id, title, body, sent_at)",
          )
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        db
          .from("payment_contracts")
          .select(
            "contract_id, tier, currency, amount, status, current_period_end, cancelled_at, created_at",
          )
          .eq("user_id", id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
    if (notifRes.error) throw notifRes.error;

    let emailHistory: {
      kind: string;
      subject: string;
      status: string;
      created_at: string;
      campaign_id: string | null;
      automation_id: string | null;
    }[] = [];
    let emailHistoryTotal = 0;
    if (contactRes.data?.id) {
      const contactId = contactRes.data.id;
      const [campaignSends, autoSends, campCount, autoCount] = await Promise.all([
        db
          .from("email_campaign_sends")
          .select("status, created_at, campaign_id, email_campaigns(name, subject)")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        db
          .from("email_automation_sends")
          .select("status, subject, created_at, automation_id, email_automations(name)")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        db
          .from("email_campaign_sends")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", contactId),
        db
          .from("email_automation_sends")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", contactId),
      ]);
      emailHistoryTotal = (campCount.count ?? 0) + (autoCount.count ?? 0);
      for (const row of campaignSends.data ?? []) {
        const raw = row.email_campaigns as
          | { name?: string; subject?: string }
          | { name?: string; subject?: string }[]
          | null;
        const camp = Array.isArray(raw) ? raw[0] : raw;
        emailHistory.push({
          kind: "campaign",
          subject: camp?.name || camp?.subject || "Рассылка",
          status: row.status,
          created_at: row.created_at,
          campaign_id: row.campaign_id ?? null,
          automation_id: null,
        });
      }
      for (const row of autoSends.data ?? []) {
        const raw = row.email_automations as
          | { name?: string }
          | { name?: string }[]
          | null;
        const auto = Array.isArray(raw) ? raw[0] : raw;
        emailHistory.push({
          kind: "automation",
          subject: row.subject || auto?.name || "Цепочка",
          status: row.status,
          created_at: row.created_at,
          campaign_id: null,
          automation_id: row.automation_id ?? null,
        });
      }
      emailHistory.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      emailHistory = emailHistory.slice(0, HISTORY_LIMIT);
    }

    const { count: notifTotal } = await db
      .from("notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", id);

    const notifications = (notifRes.data ?? []).map((d) => {
      const raw = d.notifications as
        | { id?: string; title?: string; body?: string; sent_at?: string }
        | { id?: string; title?: string; body?: string; sent_at?: string }[]
        | null;
      const n = Array.isArray(raw) ? raw[0] : raw;
      return {
        id: d.id,
        notification_id: d.notification_id ?? n?.id ?? null,
        title: d.title || n?.title || "Уведомление",
        body: d.body || n?.body || "",
        created_at: d.created_at,
        sent_at: n?.sent_at ?? null,
        read_at: d.read_at ?? null,
        kind: d.kind ?? "admin",
      };
    });

    const contract = contractRes.data;
    const subscription = contract
      ? {
          contract_id: contract.contract_id,
          tier: contract.tier,
          currency: contract.currency,
          amount: contract.amount,
          status: contract.status,
          current_period_end: contract.current_period_end,
        }
      : null;

    return json({
      user: {
        ...user,
        email: emails.get(id) ?? "—",
        last_activity_at: lastEventRes.data?.occurred_at ?? null,
      },
      payments,
      contact: contactRes.data ?? null,
      subscription,
      email_history: emailHistory,
      email_history_total: emailHistoryTotal,
      notifications,
      notifications_total: notifTotal ?? notifications.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type TierUpdatePayload = {
  tier?: string;
  expires_at?: string | null;
  amount?: number;
  currency?: string;
  comment?: string;
  skip_email_automations?: boolean;
};

/**
 * Ручное назначение тарифа: обновляет users и пишет строку в леджер (source=manual).
 * Также: skip_email_automations без смены тарифа.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as TierUpdatePayload;

    if (typeof payload.skip_email_automations === "boolean" && !payload.tier) {
      const db = createServiceSupabase();
      const { data: user, error } = await db
        .from("users")
        .update({ skip_email_automations: payload.skip_email_automations })
        .eq("id", id)
        .select("id, skip_email_automations")
        .single();
      if (error) throw error;
      return json({ user });
    }

    const tier = payload.tier?.trim() ?? "";
    if (!ALL_TIERS.has(tier)) {
      return json({ error: `Неизвестный тариф: ${tier || "не указан"}` }, { status: 400 });
    }
    const isPaid = PAID_TIERS.has(tier);
    const expiresAt = isPaid ? (payload.expires_at ?? null) : null;
    if (isPaid && expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return json({ error: "Некорректная дата окончания" }, { status: 400 });
    }

    const db = createServiceSupabase();

    if (isPaid) {
      const amount =
        typeof payload.amount === "number" && payload.amount >= 0 ? payload.amount : 0;
      const currency = normalizeFxCurrency(payload.currency) ?? "RUB";
      const { data: inserted, error: ledgerError } = await db
        .from("payments")
        .insert({
          user_id: id,
          amount,
          currency,
          tier,
          paid_until: expiresAt,
          source: "manual",
          comment: payload.comment?.trim() || null,
        })
        .select("id")
        .single();
      if (ledgerError) throw ledgerError;
      if (inserted?.id) {
        try {
          await settleGrantPayment(db, { paymentId: inserted.id, amount, currency });
        } catch (fxErr) {
          console.error("[admin] grant FX settle failed", inserted.id, fxErr);
        }
      }
      await recomputeUserMembershipFromPayments(db, id);
    } else {
      const { error } = await db
        .from("users")
        .update({ membership_tier: "free", membership_expires_at: null })
        .eq("id", id);
      if (error) throw error;
    }

    const { data: user, error: readError } = await db
      .from("users")
      .select("id, membership_tier, membership_expires_at")
      .eq("id", id)
      .single();
    if (readError) throw readError;

    return json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Удаление пользователя админом. Платежи/контракты сохраняются (buyer_email + SET NULL).
 */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    const adminId = await requireAdmin(req);
    const { id } = await ctx.params;
    if (id === adminId) {
      return json({ error: "Нельзя удалить собственный аккаунт из админки" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: roleRow, error: roleError } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (roleRow) {
      return json({ error: "Нельзя удалить пользователя с ролью admin" }, { status: 403 });
    }

    const { data: authData, error: authLookupError } = await db.auth.admin.getUserById(id);
    if (authLookupError) throw authLookupError;
    if (!authData?.user) {
      return json({ error: "Пользователь не найден в Auth" }, { status: 404 });
    }
    const email = authData.user.email?.trim() || null;
    if (!email) {
      return json({ error: "У пользователя нет email — удаление отменено" }, { status: 409 });
    }

    await wipeUserAccount(db, { userId: id, email });
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
