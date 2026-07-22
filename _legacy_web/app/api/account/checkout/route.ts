import { randomUUID } from "crypto";

import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import {
  createLavaOneTimeInvoice,
  createLavaSubscriptionInvoice,
  isLavaCurrency,
  LavaInvoiceError,
  nextPeriodEnd,
  normalizeLavaBuyerEmail,
  resolveLavaOfferId,
  resolveLavaOfferIdByName,
  type SellableTier,
} from "../lava";
import { resolveCatalogOffer } from "../paymentCatalog";
import { selectPaymentProvider, type PaymentProviderId } from "../selectPaymentProvider";
import { createYookassaPayment } from "../yookassa";
import { TIER_ORDER } from "../../../../modules/access/core/tiers";

// Создание платёжного контракта.
// kind: subscription | webinar | book (см. комментарии ранее).
// Провайдер: selectPaymentProvider(currency) — RUB→ЮKassa при флаге, иначе Lava.
// Кабинет всегда получает { paymentUrl, contractId }.
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
    const kind = (body?.kind?.trim().toLowerCase() || "subscription") as
      | "subscription"
      | "webinar"
      | "book";
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
    const emailRaw = authData?.user?.email;
    if (!emailRaw) return corsJson({ error: "User has no email" }, { status: 409 });
    const email = normalizeLavaBuyerEmail(emailRaw);
    if (!email.includes("@")) {
      return corsJson(
        {
          error: "lava_buyer_email_rejected",
          message:
            "Account email is not accepted by the payment provider. Sign in with a different email or contact support.",
        },
        { status: 400 },
      );
    }

    const userLocale = typeof row.locale === "string" && row.locale.trim() ? row.locale : "ru";
    const provider = selectPaymentProvider(currency);

    if (kind === "webinar") {
      return await startWebinarCheckout(
        db,
        userId,
        email,
        userLocale,
        currency,
        provider,
        body?.webinarId,
      );
    }
    if (kind === "book") {
      return await startBookCheckout(db, userId, email, userLocale, currency, provider);
    }

    return await startSubscriptionCheckout(
      db,
      userId,
      email,
      userLocale,
      currency,
      provider,
      body?.tier,
    );
  } catch (error) {
    if (error instanceof LavaInvoiceError && error.code === "lava_buyer_email_rejected") {
      return corsJson(
        {
          error: "lava_buyer_email_rejected",
          message:
            "This email cannot be used for purchase (for example, the seller account email). Use another account email or contact support.",
          details: error.lavaBody.slice(0, 300),
        },
        { status: 400 },
      );
    }
    return withCors(errorResponse(error));
  }
}

async function assertSubscriptionUpgradeAllowed(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  tier: SellableTier,
): Promise<Response | null> {
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
    return corsJson(
      { error: "Requested tier is not higher than the active subscription" },
      { status: 409 },
    );
  }
  return null;
}

async function startSubscriptionCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  userLocale: string,
  currency: "RUB" | "USD" | "EUR",
  provider: PaymentProviderId,
  tierRaw?: string,
): Promise<Response> {
  const tier = tierRaw?.trim().toLowerCase() as SellableTier | undefined;
  if (!tier || !SELLABLE_TIERS.includes(tier)) {
    return corsJson({ error: "tier must be one of: oracle, master" }, { status: 400 });
  }

  const blocked = await assertSubscriptionUpgradeAllowed(db, userId, tier);
  if (blocked) return blocked;

  if (provider === "yookassa") {
    const out = await createYookassaCheckout(db, {
      userId,
      email,
      currency,
      tier,
      kind: "subscription",
      productKind: "subscription",
      productRef: null,
      periodicity: "MONTHLY",
    });
    return corsJson(out);
  }

  const offerId = await resolveLavaOfferId(db, tier, userLocale);
  const invoice = await createLavaSubscriptionInvoice({
    email,
    offerId,
    currency,
    locale: userLocale,
  });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    provider: "lavatop",
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

async function resolveWebinarId(
  db: ReturnType<typeof createServiceSupabase>,
  webinarIdRaw?: string,
): Promise<{ webinarId: string } | Response> {
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
    const { data: w, error: wError } = await db
      .from("webinars")
      .select("id")
      .eq("id", webinarId)
      .eq("is_published", true)
      .maybeSingle();
    if (wError) throw wError;
    if (!w) return corsJson({ error: "Webinar not found" }, { status: 404 });
  }
  return { webinarId };
}

async function startWebinarCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  userId: string,
  email: string,
  userLocale: string,
  currency: "RUB" | "USD" | "EUR",
  provider: PaymentProviderId,
  webinarIdRaw?: string,
): Promise<Response> {
  const resolved = await resolveWebinarId(db, webinarIdRaw);
  if (resolved instanceof Response) return resolved;
  const { webinarId } = resolved;

  const { data: reg } = await db
    .from("webinar_registrations")
    .select("webinar_id")
    .eq("webinar_id", webinarId)
    .eq("user_id", userId)
    .maybeSingle();
  if (reg) return corsJson({ alreadyRegistered: true, webinarId });

  if (provider === "yookassa") {
    const out = await createYookassaCheckout(db, {
      userId,
      email,
      currency,
      tier: "webinar",
      kind: "one_time",
      productKind: "one_time",
      productRef: webinarId,
      periodicity: "ONE_TIME",
      webinarId,
    });
    return corsJson({ ...out, webinarId });
  }

  const offerId = await resolveLavaOfferIdByName(db, "webinar", userLocale);
  const invoice = await createLavaOneTimeInvoice({
    email,
    offerId,
    currency,
    locale: userLocale,
  });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    provider: "lavatop",
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
  provider: PaymentProviderId,
): Promise<Response> {
  if (provider === "yookassa") {
    const out = await createYookassaCheckout(db, {
      userId,
      email,
      currency,
      tier: "book",
      kind: "one_time",
      productKind: "one_time",
      productRef: null,
      periodicity: "ONE_TIME",
    });
    return corsJson(out);
  }

  const offerId = await resolveLavaOfferIdByName(db, "book", userLocale);
  const invoice = await createLavaOneTimeInvoice({
    email,
    offerId,
    currency,
    locale: userLocale,
  });
  if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");

  const { error: insertError } = await db.from("payment_contracts").insert({
    user_id: userId,
    buyer_email: email,
    contract_id: invoice.id,
    provider: "lavatop",
    tier: "book",
    currency,
    amount: invoice.amountTotal?.amount ?? null,
    periodicity: "ONE_TIME",
    product_kind: "one_time",
    product_ref: null,
    status: "pending",
  });
  if (insertError) throw insertError;

  return corsJson({ paymentUrl: invoice.paymentUrl, contractId: invoice.id });
}

async function createYookassaCheckout(
  db: ReturnType<typeof createServiceSupabase>,
  params: {
    userId: string;
    email: string;
    currency: "RUB" | "USD" | "EUR";
    tier: "oracle" | "master" | "webinar" | "book";
    kind: "subscription" | "one_time";
    productKind: "subscription" | "one_time";
    productRef: string | null;
    periodicity: "MONTHLY" | "ONE_TIME";
    webinarId?: string;
  },
): Promise<{ paymentUrl: string; contractId: string }> {
  if (params.currency !== "RUB") {
    throw new Error("YooKassa checkout requires RUB");
  }

  const offer = await resolveCatalogOffer(db, {
    provider: "yookassa",
    tier: params.tier,
    currency: "RUB",
  });

  const contractId = randomUUID();
  const description =
    offer.description?.trim() || offer.title || `Harmonizer ${params.tier}`;

  const insertRow: Record<string, unknown> = {
    user_id: params.userId,
    buyer_email: params.email,
    contract_id: contractId,
    provider: "yookassa",
    tier: params.tier,
    currency: "RUB",
    amount: offer.amount,
    periodicity: params.periodicity,
    product_kind: params.productKind,
    product_ref: params.productRef,
    status: "pending",
  };
  if (params.productKind === "subscription") {
    insertRow.current_period_end = nextPeriodEnd().toISOString();
  }

  const { error: insertError } = await db.from("payment_contracts").insert(insertRow);
  if (insertError) throw insertError;

  try {
    const { payment, confirmationUrl } = await createYookassaPayment({
      contractId,
      userId: params.userId,
      amount: offer.amount,
      currency: "RUB",
      description,
      tier: params.tier,
      kind: params.kind,
      webinarId: params.webinarId ?? null,
      cardOnly: params.kind === "subscription",
    });

    const { error: updateError } = await db
      .from("payment_contracts")
      .update({
        provider_payment_id: payment.id,
        updated_at: new Date().toISOString(),
      })
      .eq("contract_id", contractId);
    if (updateError) throw updateError;

    return { paymentUrl: confirmationUrl, contractId };
  } catch (err) {
    await db
      .from("payment_contracts")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("contract_id", contractId)
      .eq("status", "pending");
    throw err;
  }
}
