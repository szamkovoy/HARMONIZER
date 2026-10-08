/**
 * Public landing payment widget: config + prices for /api/widget/:id and checkout.
 * Embedded on third-party sites, so CORS is open; nothing here needs a session.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { findLavaOffer, lavaOfferPrice, type LavaCurrency } from "../account/lava";
import { isPaymentProviderEnabled } from "../account/paymentGatewayProfile";
import {
  internationalCurrency,
  normalizeWidgetConfig,
  type WidgetConfig,
  type WidgetMethod,
} from "../../../lib/paymentWidget/config";

export function widgetCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
  };
}

export function widgetPreflight(): Response {
  return new Response(null, { status: 204, headers: widgetCorsHeaders() });
}

export function widgetJson(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...widgetCorsHeaders(), ...(init?.headers ?? {}) },
  });
}

export type WidgetCatalogRow = {
  id: string;
  tier: string;
  amount: number;
  currency: string;
  title: string;
  description: string | null;
  product_kind: "subscription" | "one_time";
  lava_offer_id: string | null;
  active: boolean;
};

export type LoadedWidget = {
  id: string;
  title: string;
  active: boolean;
  config: WidgetConfig;
  catalog: WidgetCatalogRow | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadWidget(db: SupabaseClient, id: string): Promise<LoadedWidget | null> {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await db
    .from("payment_widgets")
    .select(
      "id,title,active,config,catalog:payment_catalog(id,tier,amount,currency,title,description,product_kind,lava_offer_id,active)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const catalogRaw = (Array.isArray(data.catalog) ? data.catalog[0] : data.catalog) as
    | (WidgetCatalogRow & { amount: number | string })
    | null
    | undefined;
  return {
    id: data.id as string,
    title: data.title as string,
    active: Boolean(data.active),
    config: normalizeWidgetConfig(data.config),
    catalog: catalogRaw ? { ...catalogRaw, amount: Number(catalogRaw.amount) } : null,
  };
}

export type WidgetPrice = { amount: number; currency: "RUB" | "USD" | "EUR" };

export type WidgetOffer = {
  ru: WidgetPrice | null;
  int: (WidgetPrice & { offerId: string }) | null;
};

/** Prices the visitor can pay with, honoring the widget payment mode and enabled gateways. */
export async function resolveWidgetOffer(
  widget: LoadedWidget,
  country: string | null,
): Promise<WidgetOffer> {
  const catalog = widget.catalog;
  const out: WidgetOffer = { ru: null, int: null };
  if (!widget.active || !catalog?.active) return out;
  const mode = widget.config.paymentMode;

  if (mode !== "int" && isPaymentProviderEnabled("yookassa") && catalog.currency === "RUB" && catalog.amount > 0) {
    out.ru = { amount: catalog.amount, currency: "RUB" };
  }

  if (mode !== "ru" && isPaymentProviderEnabled("lavatop") && catalog.lava_offer_id) {
    try {
      const found = await findLavaOffer(catalog.lava_offer_id);
      if (found) {
        const periodicity = catalog.product_kind === "subscription" ? "MONTHLY" : "ONE_TIME";
        const preferred = internationalCurrency(country);
        const order: LavaCurrency[] = preferred === "USD" ? ["USD", "EUR"] : ["EUR", "USD"];
        for (const currency of order) {
          const amount = lavaOfferPrice(found.offer, currency, periodicity);
          if (amount != null && amount > 0) {
            out.int = { amount, currency: currency as "USD" | "EUR", offerId: found.offer.id };
            break;
          }
        }
      }
    } catch (err) {
      console.error("[widget] Lava offer lookup failed", catalog.lava_offer_id, err);
    }
  }
  return out;
}

export function availableMethods(offer: WidgetOffer): WidgetMethod[] {
  const methods: WidgetMethod[] = [];
  if (offer.ru) methods.push("ru");
  if (offer.int) methods.push("int");
  return methods;
}

/** `pageUrl` with `hz_paid=<widgetId>` so the widget shows its thank-you state on return. */
export function thanksReturnUrl(pageUrl: string | null, widgetId: string): string | null {
  if (!pageUrl) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.searchParams.delete("hz_paid");
    url.searchParams.set("hz_paid", widgetId);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
