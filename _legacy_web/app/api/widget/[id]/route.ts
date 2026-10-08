import { resolveIpCountry } from "../../_utils/ipCountry";
import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import {
  defaultWidgetMethod,
  resolveWidgetLocale,
  resolveWidgetTexts,
} from "../../../../lib/paymentWidget/config";
import { asWidgetLocale } from "../../../../lib/paymentWidget/copy";
import {
  availableMethods,
  loadWidget,
  resolveWidgetOffer,
  widgetCorsHeaders,
  widgetJson,
  widgetPreflight,
} from "../widgetServer";

export const runtime = "nodejs";

export function OPTIONS() {
  return widgetPreflight();
}

/**
 * Public widget config for the landing script.
 * Query: lang (requested locale, already resolved from data-lang / browser), tz (IANA).
 * Response: texts in the shown locale, layout, style, prices per method, default method.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const db = createServiceSupabase({ fetchTimeoutMs: 8_000 });
    const widget = await loadWidget(db, id);
    if (!widget) return widgetJson({ error: "widget_not_found" }, { status: 404 });

    const requested = asWidgetLocale(url.searchParams.get("lang"));
    const locale = resolveWidgetLocale(widget.config, requested);
    const texts = resolveWidgetTexts(widget.config, locale);

    const geo = await resolveIpCountry(req.headers);
    const country = geo.country || null;
    const offer = await resolveWidgetOffer(widget, country);
    const methods = availableMethods(offer);
    const preferred = defaultWidgetMethod({ country, timeZone: url.searchParams.get("tz") });
    const defaultMethod = methods.includes(preferred) ? preferred : (methods[0] ?? null);

    return widgetJson({
      id: widget.id,
      locale,
      available: methods.length > 0,
      texts,
      paymentMode: widget.config.paymentMode,
      requireName: widget.config.requireName,
      elements: widget.config.elements,
      style: widget.config.style,
      kind: widget.catalog?.product_kind ?? "one_time",
      prices: {
        ru: offer.ru,
        int: offer.int ? { amount: offer.int.amount, currency: offer.int.currency } : null,
      },
      methods,
      defaultMethod,
    });
  } catch (error) {
    const res = errorResponse(error);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(widgetCorsHeaders())) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  }
}
