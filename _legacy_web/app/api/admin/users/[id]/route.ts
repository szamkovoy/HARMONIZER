import { cancelActiveSubscriptionsForUser } from "../../../account/cancelActiveSubscriptions";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { emailsByUserId } from "../../_utils/authEmails";
import { ALL_TIERS, PAID_TIERS, recomputeUserMembershipFromPayments } from "../../_utils/payments";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

function membershipLooksStale(user: {
  membership_tier: string;
  membership_expires_at: string | null;
}): boolean {
  if (!PAID_TIERS.has(user.membership_tier)) return false;
  if (!user.membership_expires_at) return false;
  return Date.parse(user.membership_expires_at) <= Date.now();
}

/** Карточка пользователя: профиль, email, история платежей, последняя активность. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const userSelect =
      "id, display_name, membership_tier, membership_expires_at, locale, created_at, onboarded_at, country_code, city";
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

    const [emails, paymentsRes, lastEventRes] = await Promise.all([
      emailsByUserId(db, [id]),
      db
        .from("payments")
        .select("id, amount, currency, tier, paid_until, source, comment, created_at, edited_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("user_event_log")
        .select("occurred_at")
        .eq("user_id", id)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (paymentsRes.error) throw paymentsRes.error;

    return json({
      user: {
        ...user,
        email: emails.get(id) ?? "—",
        last_activity_at: lastEventRes.data?.occurred_at ?? null,
      },
      payments: paymentsRes.data ?? [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type TierUpdatePayload = {
  tier?: string;
  expires_at?: string | null;
  amount?: number;
  comment?: string;
};

/**
 * Ручное назначение тарифа: обновляет users и пишет строку в леджер (source=manual).
 * expires_at приходит с клиента уже с текущим временем на выбранную дату.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as TierUpdatePayload;

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
      const { error: ledgerError } = await db.from("payments").insert({
        user_id: id,
        amount: typeof payload.amount === "number" && payload.amount >= 0 ? payload.amount : 0,
        tier,
        paid_until: expiresAt,
        source: "manual",
        comment: payload.comment?.trim() || null,
      });
      if (ledgerError) throw ledgerError;
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
 * Нельзя удалить себя или другого admin.
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

    await cancelActiveSubscriptionsForUser(db, { userId: id, email });

    const { error: contractsEmailError } = await db
      .from("payment_contracts")
      .update({ buyer_email: email, updated_at: new Date().toISOString() })
      .eq("user_id", id);
    if (contractsEmailError) throw contractsEmailError;

    const { error: paymentsEmailError } = await db
      .from("payments")
      .update({ buyer_email: email })
      .eq("user_id", id);
    if (paymentsEmailError) throw paymentsEmailError;

    const { error: deleteError } = await db.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;

    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
