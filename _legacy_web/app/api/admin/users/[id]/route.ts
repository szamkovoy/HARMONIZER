import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { emailsByUserId } from "../../_utils/authEmails";
import { ALL_TIERS, PAID_TIERS, syncUserTierFromLatestPayment } from "../../_utils/payments";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Карточка пользователя: профиль, email, история платежей, последняя активность. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { data: user, error } = await db
      .from("users")
      .select("id, display_name, membership_tier, membership_expires_at, locale, created_at, onboarded_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!user) return json({ error: "Пользователь не найден" }, { status: 404 });

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
      await syncUserTierFromLatestPayment(db, id);
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
