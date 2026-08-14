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
import { isAutoRenewCancelled } from "../../../../admin/_lib/accessNow";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { emailsByUserId } from "../../_utils/authEmails";
import { loadAdminPaymentLedger } from "../../_utils/paymentLedger";
import { ALL_TIERS, PAID_TIERS, recomputeUserMembershipFromPayments } from "../../_utils/payments";
import {
  grantOneTimeAddon,
  ONE_TIME_ADDON_TIERS,
} from "../../_utils/grantOneTimeAddon";

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
      "id, display_name, last_name, phone, admin_note, crm_imported_at, getcourse_last_activity_at, membership_tier, membership_expires_at, membership_started_at, trial_expires_at, locale, created_at, onboarded_at, country_code, city, location_name, lat, lon, skip_email_automations, last_seen_at";
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

    const [emails, payments, lastEventRes, contactRes, notifRes, contractRes, crmProductsRes] =
      await Promise.all([
        emailsByUserId(db, [id]),
        loadAdminPaymentLedger(db, { userId: id, limit: 100 }).then((p) => p.payments),
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
          .eq("product_kind", "subscription")
          .in("status", ["active", "cancelled"])
          .order("created_at", { ascending: false })
          .limit(10),
        db
          .from("user_crm_products")
          .select("product_id, crm_products(slug, title, sort_order)")
          .eq("user_id", id),
      ]);
    if (notifRes.error) throw notifRes.error;
    if (contractRes.error) throw contractRes.error;
    if (crmProductsRes.error) throw crmProductsRes.error;

    let emailHistory: {
      kind: string;
      /** Campaign name, or fallback label for automation. */
      subject: string;
      chain_name: string | null;
      letter_name: string | null;
      status: string;
      created_at: string;
      campaign_id: string | null;
      automation_id: string | null;
      step_id: string | null;
    }[] = [];
    let emailHistoryTotal = 0;
    let activeEnrollments: {
      id: string;
      automation_id: string;
      automation_name: string;
      current_position: number;
      steps_total: number;
      next_step_at: string | null;
    }[] = [];
    if (contactRes.data?.id) {
      const contactId = contactRes.data.id;
      const [campaignSends, autoSends, campCount, autoCount, enrollmentsRes] =
        await Promise.all([
          db
            .from("email_campaign_sends")
            .select("status, created_at, campaign_id, email_campaigns(name, subject)")
            .eq("contact_id", contactId)
            .order("created_at", { ascending: false })
            .limit(HISTORY_LIMIT),
          db
            .from("email_automation_sends")
            .select(
              "status, subject, created_at, automation_id, step_id, email_automations(name), email_automation_steps(name, subject)",
            )
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
          db
            .from("email_automation_enrollments")
            .select(
              "id, automation_id, current_position, next_step_at, email_automations(name)",
            )
            .eq("contact_id", contactId)
            .eq("status", "active")
            .order("created_at", { ascending: false }),
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
          subject: (camp?.name || "").trim() || (camp?.subject || "").trim() || "Рассылка",
          chain_name: null,
          letter_name: null,
          status: row.status,
          created_at: row.created_at,
          campaign_id: row.campaign_id ?? null,
          automation_id: null,
          step_id: null,
        });
      }
      for (const row of autoSends.data ?? []) {
        const rawAuto = row.email_automations as
          | { name?: string }
          | { name?: string }[]
          | null;
        const auto = Array.isArray(rawAuto) ? rawAuto[0] : rawAuto;
        const rawStep = row.email_automation_steps as
          | { name?: string; subject?: string }
          | { name?: string; subject?: string }[]
          | null;
        const step = Array.isArray(rawStep) ? rawStep[0] : rawStep;
        const chainName = (auto?.name || "").trim() || "Цепочка";
        const letterName =
          (step?.name || "").trim() ||
          (step?.subject || "").trim() ||
          (row.subject || "").trim() ||
          "Письмо";
        emailHistory.push({
          kind: "automation",
          subject: letterName,
          chain_name: chainName,
          letter_name: letterName,
          status: row.status,
          created_at: row.created_at,
          campaign_id: null,
          automation_id: row.automation_id ?? null,
          step_id: (row.step_id as string | null) ?? null,
        });
      }
      emailHistory.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      emailHistory = emailHistory.slice(0, HISTORY_LIMIT);

      if (enrollmentsRes.error) throw enrollmentsRes.error;
      const enrollRows = enrollmentsRes.data ?? [];
      const autoIds = [...new Set(enrollRows.map((e) => e.automation_id as string))];
      const stepCountByAuto = new Map<string, number>();
      if (autoIds.length > 0) {
        const { data: stepRows, error: stepCountError } = await db
          .from("email_automation_steps")
          .select("automation_id")
          .in("automation_id", autoIds);
        if (stepCountError) throw stepCountError;
        for (const s of stepRows ?? []) {
          const aid = s.automation_id as string;
          stepCountByAuto.set(aid, (stepCountByAuto.get(aid) ?? 0) + 1);
        }
      }
      activeEnrollments = enrollRows.map((row) => {
        const raw = row.email_automations as
          | { name?: string }
          | { name?: string }[]
          | null;
        const auto = Array.isArray(raw) ? raw[0] : raw;
        return {
          id: row.id as string,
          automation_id: row.automation_id as string,
          automation_name: (auto?.name || "").trim() || "Цепочка",
          current_position: Number(row.current_position) || 0,
          steps_total: stepCountByAuto.get(row.automation_id as string) ?? 0,
          next_step_at: (row.next_step_at as string | null) ?? null,
        };
      });
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

    const contracts = contractRes.data ?? [];
    const activeContract = contracts.find((c) => c.status === "active") ?? null;
    const cancelledContract =
      contracts.find((c) => c.status === "cancelled" && c.cancelled_at) ?? null;
    const contract = activeContract ?? cancelledContract;
    const auto_renew_cancelled = isAutoRenewCancelled({
      membership_tier: user.membership_tier,
      membership_expires_at: user.membership_expires_at,
      hasActiveSubscriptionContract: Boolean(activeContract),
      hasCancelledSubscriptionContract: Boolean(cancelledContract),
    });
    const subscription = contract
      ? {
          contract_id: contract.contract_id,
          tier: contract.tier,
          currency: contract.currency,
          amount: contract.amount,
          status: contract.status,
          current_period_end: contract.current_period_end,
          cancelled_at: contract.cancelled_at ?? null,
        }
      : null;

    const crm_products = (crmProductsRes.data ?? [])
      .map((row) => {
        const raw = row.crm_products as
          | { slug?: string; title?: string; sort_order?: number }
          | { slug?: string; title?: string; sort_order?: number }[]
          | null;
        const p = Array.isArray(raw) ? raw[0] : raw;
        if (!p?.slug || !p?.title) return null;
        return {
          slug: p.slug,
          title: p.title,
          sort_order: Number(p.sort_order) || 0,
        };
      })
      .filter((p): p is { slug: string; title: string; sort_order: number } => Boolean(p))
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "ru"));

    return json({
      user: {
        ...user,
        email: emails.get(id) ?? "—",
        last_activity_at: lastEventRes.data?.occurred_at ?? null,
        auto_renew_cancelled,
      },
      payments,
      contact: contactRes.data ?? null,
      subscription,
      crm_products,
      email_history: emailHistory,
      email_history_total: emailHistoryTotal,
      active_enrollments: activeEnrollments,
      notifications,
      notifications_total: notifTotal ?? notifications.length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type TierUpdatePayload = {
  action?: string;
  access?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  tier?: string;
  expires_at?: string | null;
  amount?: number;
  currency?: string;
  comment?: string;
  skip_email_automations?: boolean;
  display_name?: string | null;
  last_name?: string | null;
};

async function expireActiveManualGrants(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await db
    .from("payments")
    .select("id, paid_until")
    .eq("user_id", userId)
    .eq("source", "manual");
  if (error) throw error;
  const now = Date.now();
  const ids = (rows ?? [])
    .filter((r) => !r.paid_until || Date.parse(r.paid_until) > now)
    .map((r) => r.id as string);
  if (ids.length === 0) return;
  const { error: updErr } = await db
    .from("payments")
    .update({ paid_until: nowIso, edited_at: nowIso })
    .in("id", ids);
  if (updErr) throw updErr;
}

/**
 * Ручное назначение тарифа: обновляет users и пишет строку в леджер (source=manual).
 * action=set_access — смена доступа (демо/навигатор/наставник/мастер) last-write-wins.
 * Также: skip_email_automations без смены тарифа.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as TierUpdatePayload;
    const db = createServiceSupabase();

    if (typeof payload.skip_email_automations === "boolean" && !payload.tier && payload.action !== "set_access" && payload.action !== "set_name") {
      const { data: user, error } = await db
        .from("users")
        .update({ skip_email_automations: payload.skip_email_automations })
        .eq("id", id)
        .select("id, skip_email_automations")
        .single();
      if (error) throw error;
      return json({ user });
    }

    if (payload.action === "set_name") {
      const displayName =
        typeof payload.display_name === "string" ? payload.display_name.trim() : "";
      const lastName =
        typeof payload.last_name === "string" ? payload.last_name.trim() : "";
      const { data: user, error } = await db
        .from("users")
        .update({
          display_name: displayName || null,
          last_name: lastName || null,
        })
        .eq("id", id)
        .select("id, display_name, last_name")
        .single();
      if (error) throw error;
      return json({ user });
    }

    if (payload.action === "set_access") {
      const access = payload.access?.trim() ?? "";
      if (
        access !== "trial" &&
        access !== "navigator" &&
        access !== "oracle" &&
        access !== "master"
      ) {
        return json({ error: "Неизвестный доступ" }, { status: 400 });
      }
      const startsAt =
        typeof payload.starts_at === "string" && payload.starts_at.trim()
          ? payload.starts_at.trim()
          : null;
      const endsAt =
        typeof payload.ends_at === "string" && payload.ends_at.trim()
          ? payload.ends_at.trim()
          : null;
      if (startsAt && Number.isNaN(Date.parse(startsAt))) {
        return json({ error: "Некорректная дата начала" }, { status: 400 });
      }
      if (endsAt && Number.isNaN(Date.parse(endsAt))) {
        return json({ error: "Некорректная дата окончания" }, { status: 400 });
      }
      if (access === "trial" && !endsAt) {
        return json({ error: "Для демо укажите дату окончания" }, { status: 400 });
      }

      const startedIso = startsAt ?? new Date().toISOString();

      if (access === "trial") {
        await expireActiveManualGrants(db, id);
        const { error } = await db
          .from("users")
          .update({
            membership_tier: "free",
            membership_expires_at: null,
            membership_started_at: startedIso,
            trial_expires_at: endsAt,
          })
          .eq("id", id);
        if (error) throw error;
      } else if (access === "navigator") {
        await expireActiveManualGrants(db, id);
        const { error } = await db
          .from("users")
          .update({
            membership_tier: "free",
            membership_expires_at: null,
            membership_started_at: startedIso,
            trial_expires_at: null,
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const tier = access === "master" ? "master" : "oracle";
        await expireActiveManualGrants(db, id);
        const { data: inserted, error: ledgerError } = await db
          .from("payments")
          .insert({
            user_id: id,
            amount: 0,
            currency: "RUB",
            tier,
            paid_until: endsAt,
            source: "manual",
            comment: "Админ: изменить тариф",
          })
          .select("id")
          .single();
        if (ledgerError) throw ledgerError;
        if (inserted?.id) {
          try {
            await settleGrantPayment(db, {
              paymentId: inserted.id,
              amount: 0,
              currency: "RUB",
            });
          } catch (fxErr) {
            console.error("[admin] set_access FX settle failed", inserted.id, fxErr);
          }
        }
        const { error } = await db
          .from("users")
          .update({
            membership_tier: tier,
            membership_expires_at: endsAt,
            membership_started_at: startedIso,
            trial_expires_at: null,
          })
          .eq("id", id);
        if (error) throw error;
      }

      const { data: user, error: readError } = await db
        .from("users")
        .select(
          "id, membership_tier, membership_expires_at, membership_started_at, trial_expires_at",
        )
        .eq("id", id)
        .single();
      if (readError) throw readError;
      return json({ user });
    }

    const tier = payload.tier?.trim() ?? "";
    if (ONE_TIME_ADDON_TIERS.has(tier)) {
      const amount =
        typeof payload.amount === "number" && payload.amount >= 0 ? payload.amount : 0;
      const currency = normalizeFxCurrency(payload.currency) ?? "RUB";
      try {
        const granted = await grantOneTimeAddon(db, {
          userId: id,
          tier: tier as "book" | "webinar",
          amount,
          currency,
          comment: payload.comment?.trim() || null,
          productRef: typeof payload.product_ref === "string" ? payload.product_ref : null,
        });
        const { data: user, error: readError } = await db
          .from("users")
          .select(
            "id, membership_tier, membership_expires_at, membership_started_at, trial_expires_at",
          )
          .eq("id", id)
          .single();
        if (readError) throw readError;
        return json({
          user,
          oneTime: { tier, contractId: granted.contractId, productRef: granted.productRef },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, { status: 400 });
      }
    }

    if (!ALL_TIERS.has(tier)) {
      return json({ error: `Неизвестный тариф: ${tier || "не указан"}` }, { status: 400 });
    }
    const isPaid = PAID_TIERS.has(tier);
    const expiresAt = isPaid ? (payload.expires_at ?? null) : null;
    if (isPaid && expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return json({ error: "Некорректная дата окончания" }, { status: 400 });
    }

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
      const { error: startErr } = await db
        .from("users")
        .update({ membership_started_at: new Date().toISOString() })
        .eq("id", id);
      if (startErr) throw startErr;
    } else {
      await expireActiveManualGrants(db, id);
      const { error } = await db
        .from("users")
        .update({
          membership_tier: "free",
          membership_expires_at: null,
          membership_started_at: new Date().toISOString(),
          trial_expires_at: null,
        })
        .eq("id", id);
      if (error) throw error;
    }

    const { data: user, error: readError } = await db
      .from("users")
      .select("id, membership_tier, membership_expires_at, membership_started_at, trial_expires_at")
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
