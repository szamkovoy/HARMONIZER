import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import {
  createLavaSubscriptionInvoice,
  isLavaCurrency,
  nextPeriodEnd,
  type SellableTier,
} from "../lava";
import { TIER_ORDER } from "../../../../modules/access/core/tiers";

// Создание платёжного контракта Lava для перехода на платный уровень.
// Вызывается страницей Личного кабинета (кабинетная сессия, CORS сайта).
//
// Политика апгрейда (решение продукта, 2026-07-15): апгрейд немедленный,
// пропорциональный пересчёт не делается; старая подписка отменяется
// вебхуком payment.success нового контракта (остаток периода — в пользу
// автора). Даунгрейд — только через отмену и новую подписку после
// окончания оплаченного периода.
export const runtime = "nodejs";

const SELLABLE_TIERS: readonly SellableTier[] = ["oracle", "master"];

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(req: Request) {
  try {
    const userId = cabinetBearerUserId(req);
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { tier?: string; currency?: string } | null;
    const tier = body?.tier?.trim().toLowerCase() as SellableTier | undefined;
    const currency = body?.currency?.trim().toUpperCase() ?? "";
    if (!tier || !SELLABLE_TIERS.includes(tier)) {
      return corsJson({ error: "tier must be one of: oracle, master" }, { status: 400 });
    }
    if (!isLavaCurrency(currency)) {
      return corsJson({ error: "currency must be one of: RUB, USD, EUR" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: row, error } = await db
      .from("users")
      .select("locale")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return corsJson({ error: "User not found" }, { status: 404 });

    // Гейт по активной подписке: пока подписка живёт (active), разрешён только
    // апгрейд на уровень выше. После отмены (cancelled) можно оформить любой
    // уровень заново — это возобновление, а не даунгрейд посередине периода.
    const { data: active, error: activeError } = await db
      .from("payment_contracts")
      .select("tier")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw activeError;
    if (active && TIER_ORDER[tier as keyof typeof TIER_ORDER] <= TIER_ORDER[active.tier as keyof typeof TIER_ORDER]) {
      return corsJson({ error: "Requested tier is not higher than the active subscription" }, { status: 409 });
    }

    const { data: authData } = await db.auth.admin.getUserById(userId);
    const email = authData?.user?.email;
    if (!email) return corsJson({ error: "User has no email" }, { status: 409 });

    const invoice = await createLavaSubscriptionInvoice({
      email,
      tier,
      currency,
      locale: typeof row.locale === "string" ? row.locale : "ru",
    });
    if (!invoice.paymentUrl) {
      throw new Error("Lava invoice created without paymentUrl");
    }

    const { error: insertError } = await db.from("payment_contracts").insert({
      user_id: userId,
      contract_id: invoice.id,
      tier,
      currency,
      amount: invoice.amountTotal?.amount ?? null,
      status: "pending",
      current_period_end: nextPeriodEnd().toISOString(),
    });
    if (insertError) throw insertError;

    return corsJson({ paymentUrl: invoice.paymentUrl, contractId: invoice.id });
  } catch (error) {
    return withCors(errorResponse(error));
  }
}
