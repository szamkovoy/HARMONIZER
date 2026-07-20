import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import {
  createLavaOneTimeInvoice,
  createLavaSubscriptionInvoice,
  isLavaCurrency,
  nextPeriodEnd,
  resolveLavaOfferId,
  resolveLavaOfferIdByName,
  type SellableTier,
} from "../lava";
import { TIER_ORDER } from "../../../../modules/access/core/tiers";

// Создание платёжного контракта Lava.
// Вызывается страницей Личного кабинета (кабинетная сессия, CORS сайта).
//
// kind:
//   - "subscription" (по умолчанию): переход на платный тариф (oracle/master).
//     Политика апгрейда (A3, 2026-07-15): немедленно, без пересчёта; старая
//     подписка отменяется вебхуком payment.success нового контракта (остаток
//     периода — в пользу автора). Даунгрейд — через отмену и новую подписку
//     после окончания оплаченного периода.
//   - "webinar": разовое участие в вебинаре (ONE_TIME). webinarId — конкретный
//     вебинар из ctx=webinar:<id>; если не передан — ближайший опубликованный.
//     Вебхук payment.success регистрирует пользователя на вебинар
//     (webinar_registrations), membership_* НЕ меняется.
//   - "book": разовая покупка книги (ONE_TIME). Вебхук payment.success просто
//     фиксирует активную покупку в payment_contracts; membership_* и регистрации
//     НЕ меняются. Приложение благодарит за покупку через /api/account/purchases/last.
//
// Провайдер: сейчас всегда Lava. Задел под российский эквайринг — когда для
// currency=RUB подключим отдельный провайдер, маршрутизация будет здесь
// (одна точка решения), а кабинет останется прежним: он работает с paymentUrl.
export const runtime = "nodejs";

const SELLABLE_TIERS: readonly SellableTier[] = ["oracle", "master"];

export function OPTIONS() {
  return corsPreflight();
}

type CheckoutBody = {
  kind?: string;
  tier?: string;
  webinarId?: string;
  currency?: string;
};

export async function POST(req: Request) {
  try {
    const userId = cabinetBearerUserId(req);
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as CheckoutBody | null;
    const kind = (body?.kind?.trim().toLowerCase() || "subscription") as "subscription" | "webinar" | "book";
    const currency = body?.currency?.trim().toUpperCase() ?? "";
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

    const { data: authData } = await db.auth.admin.getUserById(userId);
    const email = authData?.user?.email;
    if (!email) return corsJson({ error: "User has no email" }, { status: 409 });

    const userLocale = typeof row.locale === "string" && row.locale.trim() ? row.locale : "ru";

    if (kind === "webinar") {
      return await startWebinarCheckout(db, userId, email, userLocale, currency, body?.webinarId);
    }
    if (kind === "book") {
      return await startBookCheckout(db, userId, email, userLocale, currency);
    }

    return await startSubscriptionCheckout(db, userId, email, userLocale, currency, body?.tier);
  } catch (error) {
    return withCors(errorResponse(error));
  }
}

async function startSubscriptionCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  userLocale: string,
  currency: "RUB" | "USD" | "EUR",
  tierRaw?: string,
): Promise<Response> {
  const tier = tierRaw?.trim().toLowerCase() as SellableTier | undefined;
  if (!tier || !SELLABLE_TIERS.includes(tier)) {
    return corsJson({ error: "tier must be one of: oracle, master" }, { status: 400 });
  }

  // Гейт по активной подписке: пока подписка живёт (active), разрешён только
  // апгрейд на уровень выше. После отмены (cancelled) можно оформить любой
  // уровень заново — это возобновление, а не даунгрейд посередине периода.
  const { data: active, error: activeError } = await db
    .from("payment_contracts")
    .select("tier")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("product_kind", "subscription")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (active && TIER_ORDER[tier] <= TIER_ORDER[active.tier as keyof typeof TIER_ORDER]) {
    return corsJson({ error: "Requested tier is not higher than the active subscription" }, { status: 409 });
  }

  const offerId = await resolveLavaOfferId(db, tier, userLocale);
  const invoice = await createLavaSubscriptionInvoice({ email, offerId, currency, locale: userLocale });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    tier,
    currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: "MONTHLY",
    product_kind: "subscription",
    status: "pending",
    current_period_end: nextPeriodEnd().toISOString(),
  });
  if (insertError) throw insertError;

  return corsJson({ paymentUrl: invoice.paymentUrl, contractId: invoice.id });
}

async function startWebinarCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  userLocale: string,
  currency: "RUB" | "USD" | "EUR",
  webinarIdRaw?: string,
): Promise<Response> {
  // webinarId: либо из ctx=webinar:<id>, либо ближайший опубликованный вебинар.
  let webinarId = webinarIdRaw?.trim() || "";
  if (!webinarId) {
    const { data: nearest, error: nearestError } = await db
      .from("webinars")
      .select("id")
      .eq("is_published", true)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (nearestError) throw nearestError;
    if (!nearest) return corsJson({ error: "No upcoming webinar to register for" }, { status: 409 });
    webinarId = nearest.id;
  } else {
    // Проверяем, что вебинар существует и опубликован.
    const { data: w, error: wError } = await db
      .from("webinars")
      .select("id")
      .eq("id", webinarId)
      .eq("is_published", true)
      .maybeSingle();
    if (wError) throw wError;
    if (!w) return corsJson({ error: "Webinar not found" }, { status: 404 });
  }

  // Уже записан — повторно платить не нужно.
  const { data: reg } = await db
    .from("webinar_registrations")
    .select("webinar_id")
    .eq("webinar_id", webinarId)
    .eq("user_id", userId)
    .maybeSingle();
  if (reg) return corsJson({ alreadyRegistered: true, webinarId });

  const offerId = await resolveLavaOfferIdByName(db, "webinar", userLocale);
  const invoice = await createLavaOneTimeInvoice({ email, offerId, currency, locale: userLocale });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    tier: "webinar",
    currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: "ONE_TIME",
    product_kind: "one_time",
    product_ref: webinarId,
    status: "pending",
  });
  if (insertError) throw insertError;

  return corsJson({ paymentUrl: invoice.paymentUrl, contractId: invoice.id, webinarId });
}

async function startBookCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  userLocale: string,
  currency: "RUB" | "USD" | "EUR",
): Promise<Response> {
  const offerId = await resolveLavaOfferIdByName(db, "book", userLocale);
  const invoice = await createLavaOneTimeInvoice({ email, offerId, currency, locale: userLocale });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    tier: "book",
    currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: "ONE_TIME",
    product_kind: "one_time",
    // product_ref для книги пока не нужен (нет sku/языковой привязки); задел
    // под будущие SKU разных книг/языков — тогда сюда ляжет идентификатор издания.
    product_ref: null,
    status: "pending",
  });
  if (insertError) throw insertError;

  return corsJson({ paymentUrl: invoice.paymentUrl, contractId: invoice.id });
}
