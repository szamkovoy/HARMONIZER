import type { SupabaseClient } from "@supabase/supabase-js";

import { baseTierFromRow, hasActiveTrial } from "../../../modules/access/core/paidAccess";
import { VISIBLE_PAID_PRODUCT_TIERS, TIER_ORDER, type ProductTier } from "../../../modules/access/core/tiers";
import { isLavaCurrency, resolveLavaPrice, type LavaCurrency, type LavaPeriodicity, type SellableTier } from "./lava";

/**
 * Данные для страницы Личного кабинета. Страница на WordPress локализует
 * названия уровней сама (по locale) — сервер отдаёт только машинные значения.
 */

/**
 * Как кабинету оформить покупку товара:
 *   - "checkout": POST /api/account/checkout {kind,tier|webinarId,currency} ->
 *     redirect на paymentUrl (сейчас Lava). Универсальный путь.
 *   - "link": прямой внешний URL (задел под российский эквайринг — кнопка
 *     кабинета становится обычной ссылкой на платёжную систему). Цены в этом
 *     случае тоже приходят оттуда, но кабинет просто открывает url.
 */
export type AccountPurchaseMode = "checkout" | "link";

export type AccountPurchase = {
  mode: AccountPurchaseMode;
  /** Цена в валюте кабинета (из Lava /api/v2/products); null, если не задана. */
  price: { amount: number; currency: LavaCurrency } | null;
  /** Для mode="link" — внешний URL провайдера; для "checkout" — null. */
  url: string | null;
};

export type AccountSubscription = {
  /** ID первого инвойса Lava (он же parentContractId рекуррентных платежей). */
  contractId: string;
  tier: string;
  currency: string;
  amount: number | null;
  /** active — списания продолжаются; cancelled — доступ до currentPeriodEnd. */
  status: "active" | "cancelled";
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
};

export type AccountUpgradeTier = {
  tier: ProductTier;
  /** Как оформить покупку и цена в валюте кабинета (из Lava). */
  purchase: AccountPurchase;
};

/** Разовая покупка участия в ближайшем вебинаре. */
export type AccountWebinarPurchase = {
  /** Ближайший опубликованный вебинар (для кнопки «Записаться»); null, если нет. */
  webinarId: string | null;
  purchase: AccountPurchase;
};

/** Разовая покупка книги (ONE_TIME). */
export type AccountBookPurchase = {
  purchase: AccountPurchase;
};

export type AccountOverview = {
  userId: string;
  displayName: string | null;
  email: string | null;
  registeredAt: string | null;
  locale: string;
  /** Действующий базовый уровень: free | oracle | master (practitioner => oracle). */
  tier: Exclude<ProductTier, "practitioner">;
  trialActive: boolean;
  trialExpiresAt: string | null;
  membershipExpiresAt: string | null;
  /** Уровни выше текущего с ценами в валюте кабинета (из Lava). */
  upgradeTiers: AccountUpgradeTier[];
  /** Последняя подписка Lava (active/cancelled); null, если оплат не было. */
  subscription: AccountSubscription | null;
  /** Разовое участие в ближайшем вебинаре (ONE_TIME). */
  webinar: AccountWebinarPurchase;
  /** Разовая покупка книги (ONE_TIME). */
  book: AccountBookPurchase;
};

/**
 * Решение провайдера покупки по валюте. Сейчас всегда Lava (mode="checkout").
 * Задел: когда подключим российский эквайринг, для RUB возвращаем mode="link"
 * с url из конфига — кабинет сам подставит ссылку вместо POST-чеката.
 */
function resolvePurchaseMode(currency: LavaCurrency): AccountPurchaseMode {
  // TODO(ru-acquiring): при currency==="RUB" вернуть "link" + url из env.
  void currency;
  return "checkout";
}

export async function buildAccountOverview(
  db: SupabaseClient,
  userId: string,
  options?: { currency?: string },
): Promise<AccountOverview> {
  const { data: row, error } = await db
    .from("users")
    .select("display_name,created_at,locale,membership_tier,membership_expires_at,trial_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Response(JSON.stringify({ error: "User not found" }), { status: 404 });

  let email: string | null = null;
  const { data: authData } = await db.auth.admin.getUserById(userId);
  if (authData?.user?.email) email = authData.user.email;

  const baseTier = baseTierFromRow(row);
  // practitioner — скрытый legacy-уровень: наружу показываем как «Наставник» (oracle).
  const visibleTier = baseTier === "practitioner" ? "oracle" : baseTier;
  const userLocale = typeof row.locale === "string" && row.locale ? row.locale : "ru";

  let subscription: AccountSubscription | null = null;
  const { data: contractRow } = await db
    .from("payment_contracts")
    .select("contract_id,tier,currency,amount,status,current_period_end,cancelled_at")
    .eq("user_id", userId)
    .eq("product_kind", "subscription")
    .in("status", ["active", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (contractRow) {
    subscription = {
      contractId: contractRow.contract_id,
      tier: contractRow.tier,
      currency: contractRow.currency,
      amount: contractRow.amount ?? null,
      status: contractRow.status as "active" | "cancelled",
      currentPeriodEnd: contractRow.current_period_end ?? null,
      cancelledAt: contractRow.cancelled_at ?? null,
    };
  }

  // После отмены подписки предлагаем все платные уровни (возобновление);
  // при активной подписке — только уровни выше текущего.
  const candidateTiers: ProductTier[] =
    subscription?.status === "cancelled"
      ? [...VISIBLE_PAID_PRODUCT_TIERS]
      : VISIBLE_PAID_PRODUCT_TIERS.filter((tier) => TIER_ORDER[tier] > TIER_ORDER[baseTier]);

  // Валюта цен — из ?currency= (приложение передаёт по гео); fallback EUR.
  const currencyParam = options?.currency?.trim().toUpperCase() ?? "";
  const currency: LavaCurrency = isLavaCurrency(currencyParam) ? currencyParam : "EUR";
  const purchaseMode = resolvePurchaseMode(currency);

  const upgradeTiers: AccountUpgradeTier[] = [];
  for (const tier of candidateTiers) {
    // practitioner не продаётся через Lava; VISIBLE_PAID_PRODUCT_TIERS его не
    // содержит, но на всякий случай пропускаем.
    if (tier === "practitioner") continue;
    let price: { amount: number; currency: LavaCurrency } | null = null;
    try {
      price = await resolveLavaPrice(db, tier as SellableTier, userLocale, currency, "MONTHLY");
    } catch {
      // оффер не сконфигурирован для этой локали/fallback — цена недоступна,
      // кабинет покажет уровень без цены (или скроет кнопку).
    }
    upgradeTiers.push({ tier, purchase: { mode: purchaseMode, price, url: null } });
  }

  // Ближайший опубликованный вебинар + цена разового участия (ONE_TIME).
  let webinarId: string | null = null;
  const { data: nearestWebinar } = await db
    .from("webinars")
    .select("id")
    .eq("is_published", true)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nearestWebinar) webinarId = nearestWebinar.id;

  let webinarPrice: { amount: number; currency: LavaCurrency } | null = null;
  if (webinarId) {
    try {
      webinarPrice = await resolveLavaPrice(db, "webinar", userLocale, currency, "ONE_TIME" as LavaPeriodicity);
    } catch {
      // оффер вебинара не сконфигурирован — цена недоступна
    }
  }

  // Цена разовой покупки книги (ONE_TIME).
  let bookPrice: { amount: number; currency: LavaCurrency } | null = null;
  try {
    bookPrice = await resolveLavaPrice(db, "book", userLocale, currency, "ONE_TIME" as LavaPeriodicity);
  } catch {
    // оффер книги не сконфигурирован — цена недоступна
  }

  return {
    userId,
    displayName: row.display_name ?? null,
    email,
    registeredAt: row.created_at ?? null,
    locale: userLocale,
    tier: visibleTier,
    trialActive: hasActiveTrial(row),
    trialExpiresAt: row.trial_expires_at ?? null,
    membershipExpiresAt: row.membership_expires_at ?? null,
    upgradeTiers,
    subscription,
    webinar: {
      webinarId,
      purchase: { mode: purchaseMode, price: webinarPrice, url: null },
    },
    book: {
      purchase: { mode: purchaseMode, price: bookPrice, url: null },
    },
  };
}
