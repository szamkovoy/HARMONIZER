import { randomUUID } from "crypto";

import { resolveIpCountry } from "../../../_utils/ipCountry";
import { normalizeMarketingRecipient } from "../../../_utils/marketingMail";
import { createServiceSupabase, errorResponse } from "../../../_utils/supabase";
import {
  createLavaOneTimeInvoice,
  createLavaSubscriptionInvoice,
  LavaInvoiceError,
  nextPeriodEnd,
} from "../../../account/lava";
import { userIdFromContact } from "../../../account/widgetFulfillment";
import { createYookassaPayment } from "../../../account/yookassa";
import { TIER_ORDER } from "../../../../../modules/access/core/tiers";
import { resolveWidgetLocale } from "../../../../../lib/paymentWidget/config";
import { asWidgetLocale } from "../../../../../lib/paymentWidget/copy";
import {
  loadWidget,
  resolveWidgetOffer,
  thanksReturnUrl,
  widgetCorsHeaders,
  widgetJson,
  widgetPreflight,
} from "../../widgetServer";

export const runtime = "nodejs";

export function OPTIONS() {
  return widgetPreflight();
}

type CheckoutBody = {
  name?: string;
  email?: string;
  method?: string;
  lang?: string;
  pageUrl?: string;
  /** Honeypot: real visitors never fill it. */
  website?: string;
};

const RECENT_WINDOW_MS = 10 * 60 * 1000;
const RECENT_MAX = 5;

/**
 * Landing widget checkout: { name, email, method: ru|int, lang, pageUrl }.
 * Creates a pending widget contract (account is created after payment) and
 * returns { paymentUrl }. Errors carry a machine `error` code the widget maps to copy.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as CheckoutBody | null;
    if (!body) return widgetJson({ error: "bad_request" }, { status: 400 });
    if ((body.website ?? "").trim()) return widgetJson({ error: "bad_request" }, { status: 400 });

    const db = createServiceSupabase();
    const widget = await loadWidget(db, id);
    if (!widget?.catalog) return widgetJson({ error: "unavailable" }, { status: 404 });
    const catalog = widget.catalog;

    const recipient = normalizeMarketingRecipient(body.email ?? "");
    if (!recipient.ok) return widgetJson({ error: "invalid_email" }, { status: 400 });
    const email = recipient.email;

    const nameVisible = widget.config.elements.some((e) => e.type === "name" && e.visible);
    const name = (body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (nameVisible && widget.config.requireName && !name) {
      return widgetJson({ error: "invalid_name" }, { status: 400 });
    }

    const locale = resolveWidgetLocale(widget.config, asWidgetLocale(body.lang));
    const geo = await resolveIpCountry(req.headers);
    const offer = await resolveWidgetOffer(widget, geo.country || null);
    const method = body.method === "ru" || body.method === "int" ? body.method : null;
    if (!method || !offer[method]) return widgetJson({ error: "unavailable" }, { status: 409 });

    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const { count: recent, error: recentErr } = await db
      .from("payment_contracts")
      .select("contract_id", { count: "exact", head: true })
      .eq("source", "widget")
      .eq("buyer_email", email)
      .gte("created_at", since);
    if (recentErr) throw recentErr;
    if ((recent ?? 0) >= RECENT_MAX) return widgetJson({ error: "too_many" }, { status: 429 });

    const existingUserId = await userIdFromContact(db, email);
    const isSubscription = catalog.product_kind === "subscription";
    if (isSubscription && existingUserId) {
      const { data: active, error: activeErr } = await db
        .from("payment_contracts")
        .select("tier")
        .eq("user_id", existingUserId)
        .eq("status", "active")
        .eq("product_kind", "subscription")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (activeErr) throw activeErr;
      const order = TIER_ORDER as Record<string, number>;
      if (active && (order[catalog.tier] ?? 0) <= (order[active.tier as string] ?? 0)) {
        return widgetJson({ error: "already_active" }, { status: 409 });
      }
    }

    const pageUrl = typeof body.pageUrl === "string" ? body.pageUrl.slice(0, 2000) : null;
    const successUrl = widget.config.successUrl;
    const periodicity = isSubscription ? "MONTHLY" : "ONE_TIME";
    const baseRow = {
      user_id: existingUserId,
      buyer_email: email,
      buyer_name: name || null,
      buyer_locale: locale,
      source: "widget",
      widget_id: widget.id,
      catalog_id: catalog.id,
      tier: catalog.tier,
      periodicity,
      product_kind: catalog.product_kind,
      product_ref: null,
      status: "pending",
      ...(isSubscription ? { current_period_end: nextPeriodEnd().toISOString() } : {}),
    };

    if (method === "ru") {
      const contractId = randomUUID();
      const { error: insertErr } = await db.from("payment_contracts").insert({
        ...baseRow,
        contract_id: contractId,
        provider: "yookassa",
        currency: "RUB",
        amount: catalog.amount,
      });
      if (insertErr) throw insertErr;
      try {
        const { payment, confirmationUrl } = await createYookassaPayment({
          contractId,
          userId: existingUserId,
          amount: catalog.amount,
          currency: "RUB",
          description: catalog.description?.trim() || catalog.title,
          tier: catalog.tier,
          kind: isSubscription ? "subscription" : "one_time",
          cardOnly: isSubscription,
          returnUrl: successUrl || thanksReturnUrl(pageUrl, widget.id),
        });
        await db
          .from("payment_contracts")
          .update({ provider_payment_id: payment.id, updated_at: new Date().toISOString() })
          .eq("contract_id", contractId);
        return widgetJson({ paymentUrl: confirmationUrl });
      } catch (err) {
        await db
          .from("payment_contracts")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("contract_id", contractId)
          .eq("status", "pending");
        throw err;
      }
    }

    const intOffer = offer.int!;
    const invoiceParams = {
      email,
      offerId: intOffer.offerId,
      currency: intOffer.currency,
      locale,
      successUrl,
    };
    const invoice = isSubscription
      ? await createLavaSubscriptionInvoice(invoiceParams)
      : await createLavaOneTimeInvoice(invoiceParams);
    if (!invoice.paymentUrl) throw new Error("Lava invoice created without paymentUrl");
    const { error: insertErr } = await db.from("payment_contracts").insert({
      ...baseRow,
      contract_id: invoice.id,
      provider: "lavatop",
      currency: intOffer.currency,
      amount: invoice.amountTotal?.amount ?? intOffer.amount,
    });
    if (insertErr) throw insertErr;
    return widgetJson({ paymentUrl: invoice.paymentUrl });
  } catch (error) {
    if (error instanceof LavaInvoiceError && error.code === "lava_buyer_email_rejected") {
      return widgetJson({ error: "email_rejected" }, { status: 400 });
    }
    console.error("[widget-checkout]", error);
    const res = errorResponse(error);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(widgetCorsHeaders())) headers.set(k, v);
    return new Response(JSON.stringify({ error: "checkout_failed" }), { status: res.status >= 500 ? 502 : res.status, headers });
  }
}
