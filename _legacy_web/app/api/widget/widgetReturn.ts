/**
 * Возврат покупателя виджета из ЮKassa.
 * У ЮKassa один return_url на успех и отказ, поэтому она ведёт сюда, а мы по
 * статусу платежа отправляем человека на «спасибо» или обратно к форме виджета.
 *   GET /pay/widget-return?c=<contractId>&w=<widgetId>&p=<pageUrl>&s=<подпись>
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { WIDGET_PUBLIC_ORIGIN } from "../../../lib/paymentWidget/config";
import { createServiceSupabase } from "../_utils/supabase";
import { accountCabinetUrl } from "../account/_utils";
import { markContractFailed, yookassaFailureReason } from "../account/fulfillPaymentContract";
import { getPayPageCopy } from "../account/payPageCopy";
import { renderPayPage } from "../account/payPages";
import { fetchYookassaPayment } from "../account/yookassa";
import { loadWidget, thanksReturnUrl, unpaidReturnUrl } from "./widgetServer";

const RETURN_POLL_MAX = 2;
/** ЮKassa принимает return_url до 2048 символов; адрес страницы длиннее режем до пути. */
const PAGE_URL_MAX = 1000;

function secret(): string {
  const value = process.env.ACCOUNT_CABINET_SECRET?.trim();
  if (!value) throw new Error("Missing required env: ACCOUNT_CABINET_SECRET");
  return value;
}

function sign(contractId: string, widgetId: string, pageUrl: string): string {
  return createHmac("sha256", secret())
    .update(`widget-return.${contractId}.${widgetId}.${pageUrl}`)
    .digest("base64url");
}

/** Адрес страницы с виджетом, пригодный для return_url; null — страницы нет. */
export function returnPageUrl(pageUrl: string | null): string | null {
  if (!pageUrl) return null;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    if (url.toString().length > PAGE_URL_MAX) url.search = "";
    const out = url.toString();
    return out.length > PAGE_URL_MAX ? null : out;
  } catch {
    return null;
  }
}

export function widgetReturnUrl(params: { contractId: string; widgetId: string; pageUrl: string | null }): string {
  const page = returnPageUrl(params.pageUrl) ?? "";
  const url = new URL("/pay/widget-return", WIDGET_PUBLIC_ORIGIN);
  url.searchParams.set("c", params.contractId);
  url.searchParams.set("w", params.widgetId);
  if (page) url.searchParams.set("p", page);
  url.searchParams.set("s", sign(params.contractId, params.widgetId, page));
  return url.toString();
}

export function verifyWidgetReturn(
  params: URLSearchParams,
): { contractId: string; widgetId: string; pageUrl: string | null } | null {
  const contractId = params.get("c") ?? "";
  const widgetId = params.get("w") ?? "";
  const page = params.get("p") ?? "";
  const given = Buffer.from(params.get("s") ?? "", "base64url");
  if (!contractId || !widgetId) return null;
  const expected = Buffer.from(sign(contractId, widgetId, page), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { contractId, widgetId, pageUrl: page || null };
}

function redirect(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
}

export async function handleWidgetReturnGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const link = verifyWidgetReturn(url.searchParams);
  if (!link) return redirect(accountCabinetUrl());
  const attempt = Number(url.searchParams.get("n") ?? "0") || 0;
  const db = createServiceSupabase({ fetchTimeoutMs: 6_000 });

  const { data: contract, error } = await db
    .from("payment_contracts")
    .select("contract_id,status,provider,provider_payment_id,widget_id,buyer_locale")
    .eq("contract_id", link.contractId)
    .maybeSingle();
  if (error) throw error;
  if (!contract || contract.widget_id !== link.widgetId) return redirect(accountCabinetUrl());

  const unpaid = () => redirect(unpaidReturnUrl(link.pageUrl, link.widgetId) ?? accountCabinetUrl());
  const paid = async () => {
    const widget = await loadWidget(db, link.widgetId);
    return redirect(
      widget?.config.successUrl ||
        thanksReturnUrl(link.pageUrl, link.widgetId) ||
        accountCabinetUrl({ paid: true }),
    );
  };

  if (contract.status === "active") return paid();
  if (contract.status === "failed") return unpaid();

  if (contract.provider === "yookassa" && contract.provider_payment_id) {
    const payment = await fetchYookassaPayment(contract.provider_payment_id as string);
    if (payment.status === "succeeded" || payment.status === "waiting_for_capture") return paid();
    if (payment.status === "canceled") {
      await markContractFailed(db, link.contractId, yookassaFailureReason(payment));
      return unpaid();
    }
  }

  // Платёж всё ещё pending: человек вышел с формы, не оплатив.
  if (attempt >= RETURN_POLL_MAX) return unpaid();
  const copy = getPayPageCopy((contract.buyer_locale as string | null) ?? null);
  const next = new URLSearchParams(url.searchParams);
  next.set("n", String(attempt + 1));
  return renderPayPage({
    lang: copy.lang,
    title: copy.checkingTitle,
    body: copy.checkingBody,
    refreshUrl: `${url.pathname}?${next}`,
  });
}
