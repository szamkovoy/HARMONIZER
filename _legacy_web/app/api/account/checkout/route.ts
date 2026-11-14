import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import { isLavaCurrency, LavaInvoiceError, normalizeLavaBuyerEmail, type SellableTier } from "../lava";
import { startOneTimeCheckout } from "../oneTimeCheckout";
import { resolvePaymentGateway } from "../paymentGatewayProfile";
import { sendPaymentAlert } from "../paymentAlerts";
import { logPaymentEvent } from "../paymentEvents";
import { startTierCheckout } from "../tierCheckout";

// Создание платёжного контракта.
// kind: subscription | pass (30 дней без автопродления) | webinar | book.
// Провайдер: resolvePaymentGateway({ country, currency }) — RU/INT профили.
// Кабинет всегда получает { paymentUrl, contractId }.
export const runtime = "nodejs";

const SELLABLE_TIERS: readonly SellableTier[] = ["oracle", "master"];

export function OPTIONS() {
  return corsPreflight();
}

async function noteCheckoutIssue(
  db: ReturnType<typeof createServiceSupabase>,
  input: {
    userId: string;
    email?: string | null;
    tier?: string | null;
    kind?: string | null;
    currency?: string | null;
    provider?: string | null;
    contractId?: string | null;
    httpStatus: number;
    error: string;
    raw?: unknown;
    alert: boolean;
  },
): Promise<void> {
  const eventType = input.alert ? "checkout.create_failed" : "checkout.refused";
  await logPaymentEvent(db, {
    provider: input.provider ?? "unknown",
    eventType,
    contractId: input.contractId,
    buyerEmail: input.email,
    currency: input.currency,
    errorMessage: input.error,
    raw: input.raw,
    httpStatus: input.httpStatus,
  });
  if (!input.alert) return;
  await sendPaymentAlert(db, {
    eventType,
    contractId: input.contractId,
    userId: input.userId,
    buyerEmail: input.email,
    tier: input.tier,
    productKind: input.kind,
    currency: input.currency,
    provider: input.provider,
    failureReason: input.error,
    raw: input.raw,
  });
}

type CheckoutBody = {
  kind?: string;
  tier?: string;
  webinarId?: string;
  currency?: string;
  country?: string;
  /** Только Lava (EUR/USD): paypal | applepay; пусто — карта. Apple Pay — только разовые покупки. */
  method?: string;
};

export async function POST(req: Request) {
  const ctx: {
    userId: string;
    email?: string;
    tier?: string;
    kind?: string;
    currency?: string;
    provider?: string;
  } = { userId: "" };
  try {
    const userId = cabinetBearerUserId(req);
    ctx.userId = userId ?? "";
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as CheckoutBody | null;
    const kind = (ctx.kind = body?.kind?.trim().toLowerCase() || "subscription") as
      | "subscription"
      | "pass"
      | "webinar"
      | "book";
    const currency = (ctx.currency = body?.currency?.trim().toUpperCase() ?? "");
    if (!isLavaCurrency(currency)) {
      return corsJson({ error: "currency must be one of: RUB, USD, EUR" }, { status: 400 });
    }
    const country = body?.country?.trim().toUpperCase() || undefined;
    const methodRaw = body?.method?.trim().toLowerCase();
    const paypal = methodRaw === "paypal";
    const applePay = methodRaw === "applepay";

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
    const email = (ctx.email = normalizeLavaBuyerEmail(emailRaw));
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
    const gateway = resolvePaymentGateway({ country, currency });
    if (!gateway.ok) {
      await noteCheckoutIssue(db, {
        userId,
        email,
        kind,
        currency,
        httpStatus: 503,
        error: "payment_gateway_unavailable",
        alert: true,
      });
      return corsJson(
        {
          error: "payment_gateway_unavailable",
          message: "No payment provider is enabled for this region.",
        },
        { status: 503 },
      );
    }
    const provider = (ctx.provider = gateway.provider);
    if (kind === "webinar" || kind === "book") {
      const out = await startOneTimeCheckout(db, {
        userId,
        product: kind,
        webinarId: kind === "webinar" ? body?.webinarId : null,
        currency,
        country: country ?? null,
        paymentMethod: paypal ? "PAYPAL" : applePay ? "APPLE_PAY" : null,
        buyer: { email, locale: userLocale },
      });
      if (out.ok) {
        return corsJson({
          paymentUrl: out.paymentUrl,
          contractId: out.contractId,
          ...(out.webinarId ? { webinarId: out.webinarId } : {}),
        });
      }
      if (out.error === "already_registered") {
        return corsJson({ alreadyRegistered: true, webinarId: out.webinarId });
      }
      const message =
        out.error === "no_upcoming_webinar"
          ? "No upcoming webinar to register for"
          : out.error === "webinar_not_found"
            ? "Webinar not found"
            : out.error;
      return corsJson({ error: message, code: out.error }, { status: out.status });
    }

    const tier = (ctx.tier = body?.tier?.trim().toLowerCase()) as SellableTier | undefined;
    if (!tier || !SELLABLE_TIERS.includes(tier)) {
      return corsJson({ error: "tier must be one of: oracle, master" }, { status: 400 });
    }
    const out = await startTierCheckout(db, {
      userId,
      tier,
      kind: kind === "pass" ? "pass" : "subscription",
      currency,
      country: country ?? null,
      paymentMethod: paypal ? "PAYPAL" : applePay && kind === "pass" ? "APPLE_PAY" : null,
      buyer: { email, locale: userLocale },
    });
    if (!out.ok) {
      const message =
        out.error === "already_active"
          ? "Requested tier is not higher than the active subscription"
          : out.error === "higher_access"
            ? "A higher paid tier is still active"
            : out.error === "has_subscription"
              ? "Cancel the active subscription before paying for 30 days"
              : out.error;
      await noteCheckoutIssue(db, {
        userId,
        email,
        tier,
        kind,
        currency,
        provider,
        httpStatus: out.status,
        error: out.error,
        alert: out.status >= 500,
      });
      return corsJson({ error: message, code: out.error }, { status: out.status });
    }
    return corsJson({ paymentUrl: out.paymentUrl, contractId: out.contractId });
  } catch (error) {
    if (error instanceof LavaInvoiceError && error.code === "lava_buyer_email_rejected") {
      try {
        await noteCheckoutIssue(createServiceSupabase(), {
          ...ctx,
          httpStatus: 400,
          error: error.code,
          raw: error.lavaBody.slice(0, 300),
          alert: true,
        });
      } catch {
        /* journal must not replace the checkout error */
      }
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
    try {
      await noteCheckoutIssue(createServiceSupabase(), {
        ...ctx,
        httpStatus: 500,
        error: error instanceof Error ? error.message : "checkout_failed",
        alert: true,
      });
    } catch {
      /* journal must not replace the checkout error */
    }
    return withCors(errorResponse(error));
  }
}
