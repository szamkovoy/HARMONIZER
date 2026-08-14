import type { SupabaseClient } from "@supabase/supabase-js";

import { baseTierFromRow, hasActiveTrial } from "../../../modules/access/core/paidAccess";
import { VISIBLE_PAID_PRODUCT_TIERS, TIER_ORDER, type ProductTier } from "../../../modules/access/core/tiers";
import { hasActiveBookPurchase } from "./bookOwnership";
import { isLavaCurrency, resolveLavaPrice, type LavaCurrency, type LavaPeriodicity, type SellableTier } from "./lava";
import { resolveCatalogPrice, type CatalogTier } from "./paymentCatalog";
import {
  resolvePaymentGateway,
  type PaymentProviderId,
} from "./paymentGatewayProfile";
import { computeMasterBonusDays } from "./upgradeCredit";

/**
 * Данные для страницы Личного кабинета. Страница локализует названия уровней
 * сама (по locale) — сервер отдаёт только машинные значения.
 */

/**
 * Как кабинету оформить покупку товара:
 *   - "checkout": POST /api/account/checkout {kind,tier|webinarId,currency} ->
 *     redirect на paymentUrl (Lava или ЮKassa). Универсальный путь.
 *   - "link": прямой внешний URL (задел); кабинет открывает url без POST.
 */
export type AccountPurchaseMode = "checkout" | "link";

export type AccountPurchase = {
  mode: AccountPurchaseMode;
  /** Цена в валюте кабинета (Lava products или payment_catalog); null, если не задана. */
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
  /** ЮKassa: доп. дни «Мастер» за неиспользованный остаток «Наставник». */
  upgradeBonusDays?: number;
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
  /** true — у пользователя уже есть active one_time book; кабинет скрывает блок продажи. */
  owned: boolean;
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
  /** Выбор шлюза по стране; available=false → fail-closed (кнопки оплаты скрыть). */
  paymentGateway: {
    available: boolean;
    provider: PaymentProviderId | null;
    country: string;
    error?: "payment_gateway_unavailable";
  };
};

/**
 * Режим оформления: и Lava, и ЮKassa идут через POST checkout → paymentUrl.
 * mode="link" остаётся заделом под внешние URL без нашего чекаута.
 */
function resolvePurchaseMode(_currency: LavaCurrency): AccountPurchaseMode {
  return "checkout";
}

async function resolvePriceForProvider(
  db: SupabaseClient,
  params: {
    provider: PaymentProviderId;
    tier: CatalogTier | SellableTier;
    userLocale: string;
    currency: LavaCurrency;
    periodicity: LavaPeriodicity | "MONTHLY" | "ONE_TIME";
  },
): Promise<{ amount: number; currency: LavaCurrency } | null> {
  if (params.provider === "yookassa") {
    return resolveCatalogPrice(db, {
      provider: "yookassa",
      tier: params.tier as CatalogTier,
      currency: "RUB",
    });
  }
  try {
    return await resolveLavaPrice(
      db,
      params.tier,
      params.userLocale,
      params.currency,
      params.periodicity as LavaPeriodicity,
    );
  } catch {
    return null;
  }
}

export async function buildAccountOverview(
  db: SupabaseClient,
  userId: string,
  options?: { currency?: string; country?: string },
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
  // Prefer active over cancelled (cancelled Lava + new pending/active YooKassa
  // must not show the older cancelled row as "current subscription").
  const { data: contractRows } = await db
    .from("payment_contracts")
    .select("contract_id,tier,currency,amount,status,current_period_end,cancelled_at,created_at")
    .eq("user_id", userId)
    .eq("product_kind", "subscription")
    .in("status", ["active", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(10);
  const contractRow =
    (contractRows ?? []).find((row) => row.status === "active")
    ?? (contractRows ?? [])[0]
    ?? null;
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

  // Валюта/страна — из query (приложение передаёт по гео); fallback EUR.
  const currencyParam = options?.currency?.trim().toUpperCase() ?? "";
  const currency: LavaCurrency = isLavaCurrency(currencyParam) ? currencyParam : "EUR";
  const country = options?.country?.trim().toUpperCase() ?? "";
  const purchaseMode = resolvePurchaseMode(currency);
  const gateway = resolvePaymentGateway({ country: country || null, currency });

  const nearestWebinarPromise = db
    .from("webinars")
    .select("id")
    .eq("is_published", true)
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const sellableUpgradeTiers = candidateTiers.filter((tier) => tier !== "practitioner");

  if (!gateway.ok) {
    const [nearestWebinar, bookOwned] = await Promise.all([
      nearestWebinarPromise,
      hasActiveBookPurchase(db, userId),
    ]);
    const emptyPurchase: AccountPurchase = { mode: purchaseMode, price: null, url: null };
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
      upgradeTiers: sellableUpgradeTiers.map((tier) => ({
        tier,
        purchase: emptyPurchase,
      })),
      subscription,
      webinar: {
        webinarId: nearestWebinar.data?.id ?? null,
        purchase: emptyPurchase,
      },
      book: { purchase: emptyPurchase, owned: bookOwned },
      paymentGateway: {
        available: false,
        provider: null,
        country: country || (currency === "RUB" ? "RU" : ""),
        error: "payment_gateway_unavailable",
      },
    };
  }

  const provider = gateway.provider;
  const priceCurrency: LavaCurrency = provider === "yookassa" ? "RUB" : currency;

  const [upgradePrices, nearestWebinar, bookPrice, bookOwned] = await Promise.all([
    Promise.all(
      sellableUpgradeTiers.map((tier) =>
        resolvePriceForProvider(db, {
          provider,
          tier: tier as SellableTier,
          userLocale,
          currency: priceCurrency,
          periodicity: "MONTHLY",
        }),
      ),
    ),
    nearestWebinarPromise,
    resolvePriceForProvider(db, {
      provider,
      tier: "book",
      userLocale,
      currency: priceCurrency,
      periodicity: "ONE_TIME",
    }),
    hasActiveBookPurchase(db, userId),
  ]);

  // ЮKassa Mentor→Master: превью бонуса по ценам каталога (не по тестовой сумме
  // в payment_contracts) и по фактическому концу доступа (контракт / membership).
  let masterBonusDays = 0;
  const masterIdx = sellableUpgradeTiers.findIndex((tier) => tier === "master");
  if (provider === "yookassa" && visibleTier === "oracle" && masterIdx >= 0) {
    const masterPrice = upgradePrices[masterIdx];
    const oracleCatalog = await resolveCatalogPrice(db, {
      provider: "yookassa",
      tier: "oracle",
      currency: "RUB",
    });
    const periodCandidates = [
      subscription?.currentPeriodEnd,
      row.membership_expires_at,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    const periodEndIso = periodCandidates.sort().at(-1) ?? null;
    masterBonusDays = computeMasterBonusDays({
      periodEndIso,
      oracleAmount: oracleCatalog?.amount ?? subscription?.amount,
      masterAmount: masterPrice?.amount ?? null,
    });
  }

  const upgradeTiers: AccountUpgradeTier[] = sellableUpgradeTiers.map((tier, i) => ({
    tier,
    purchase: { mode: purchaseMode, price: upgradePrices[i] ?? null, url: null },
    ...(tier === "master" && masterBonusDays > 0 ? { upgradeBonusDays: masterBonusDays } : {}),
  }));

  const webinarId = nearestWebinar.data?.id ?? null;
  let webinarPrice: { amount: number; currency: LavaCurrency } | null = null;
  if (webinarId) {
    webinarPrice = await resolvePriceForProvider(db, {
      provider,
      tier: "webinar",
      userLocale,
      currency: priceCurrency,
      periodicity: "ONE_TIME",
    });
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
      owned: bookOwned,
    },
    paymentGateway: {
      available: true,
      provider,
      country: country || (currency === "RUB" ? "RU" : ""),
    },
  };
}
