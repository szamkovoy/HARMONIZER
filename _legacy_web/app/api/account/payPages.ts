/**
 * Публичные страницы оплаты тарифа (без кабинетной сессии, по подписанному токену):
 *   GET  /pay/failed?t=   — «Оплата не удалась» (Lava failure_return_url, ЮKassa после отказа)
 *   GET  /pay/renew?t=    — «Продлить доступ» из письма о конце 30 дней
 *   POST /pay/retry       — выбранный вариант → новый счёт → 303 на форму оплаты
 *   GET  /pay/return?t=&c= — возврат из ЮKassa: успех → кабинет, отказ → /pay/failed
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabase } from "../_utils/supabase";
import { accountCabinetUrl } from "./_utils";
import { LavaInvoiceError } from "./lava";
import { getPayPageCopy, fillPayCopy, formatPayDate, payTierName, type PayPageCopy } from "./payPageCopy";
import { isPaymentProviderEnabled, resolvePaymentGateway } from "./paymentGatewayProfile";
import { markContractFailed, yookassaFailureReason } from "./fulfillPaymentContract";
import { verifyPayRetryToken, type PayRetryKind, type PayRetryPayload } from "./payRetryToken";
import { startTierCheckout, tierCheckoutBlocks } from "./tierCheckout";
import { fetchYookassaPayment } from "./yookassa";

export type PayOption = "card" | "foreign" | "paypal" | "pass" | "subscription";

type PageAction = { label: string; option: PayOption };

/**
 * ЮKassa держит покупателя на своей форме при отказе банка и возвращает его
 * только по «Выйти из оплаты»; платёж при этом ещё pending. Две короткие
 * проверки ловят успех, который ЮKassa не успела закрыть, дальше — отказ.
 */
const RETURN_POLL_MAX = 2;
const RETURN_POLL_SECONDS = 3;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlResponse(doc: string, status = 200): Response {
  return new Response(doc, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function redirect(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
}

export function renderPayPage(params: {
  lang: string;
  title: string;
  body: string;
  token?: string;
  actions?: PageAction[];
  cabinetLabel?: string;
  refreshUrl?: string;
  status?: number;
}): Response {
  const forms = (params.actions ?? [])
    .map(
      (a, i) => `<form method="post" action="/pay/retry">
      <input type="hidden" name="t" value="${escapeHtml(params.token ?? "")}" />
      <input type="hidden" name="o" value="${a.option}" />
      <button type="submit" class="${i === 0 ? "primary" : "secondary"}">${escapeHtml(a.label)}</button>
    </form>`,
    )
    .join("\n");
  const cabinet = params.cabinetLabel
    ? `<a class="link" href="${escapeHtml(accountCabinetUrl())}">${escapeHtml(params.cabinetLabel)}</a>`
    : "";
  const refresh = params.refreshUrl
    ? `<meta http-equiv="refresh" content="${RETURN_POLL_SECONDS};url=${escapeHtml(params.refreshUrl)}" />`
    : "";
  const doc = `<!DOCTYPE html>
<html lang="${escapeHtml(params.lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  ${refresh}
  <title>${escapeHtml(params.title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f6f5; color: #1a1a1a;
      display: flex; min-height: 100dvh; align-items: flex-start; justify-content: center; margin: 0;
      padding: 12px 1rem 1.5rem; box-sizing: border-box; }
    .card { background: #fff; padding: 2rem 1.5rem; border-radius: 16px; max-width: 460px; width: 100%;
      box-shadow: 0 8px 30px rgba(0,0,0,.06); text-align: center; }
    h1 { font-size: 1.75rem; font-weight: 800; margin: 0 0 1rem; }
    p { margin: 0 0 1.5rem; color: #4b5563; line-height: 1.55; font-size: 1rem; }
    form { margin: 0 0 .75rem; }
    button { width: 100%; padding: .95rem 1rem; border-radius: 12px; font-size: 1rem; font-weight: 600;
      cursor: pointer; border: 1px solid #2f6f5e; }
    button.primary { background: #2f6f5e; color: #fff; }
    button.secondary { background: #fff; color: #2f6f5e; }
    button[disabled] { opacity: .6; cursor: progress; }
    .link { display: inline-block; margin-top: .5rem; color: #2f6f5e; font-size: .95rem; }
  </style>
</head>
<body><div class="card">
  <h1>${escapeHtml(params.title)}</h1>
  <p>${escapeHtml(params.body)}</p>
  ${forms}
  ${cabinet}
</div>
<script>
  document.querySelectorAll("form").forEach(function (f) {
    f.addEventListener("submit", function () {
      document.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
    });
  });
</script>
</body>
</html>`;
  return htmlResponse(doc, params.status ?? 200);
}

function expiredPage(copy: PayPageCopy & { lang: string }): Response {
  return renderPayPage({
    lang: copy.lang,
    title: copy.expiredTitle,
    body: copy.expiredBody,
    cabinetLabel: copy.toCabinet,
  });
}

function alreadyPage(copy: PayPageCopy & { lang: string }): Response {
  return renderPayPage({
    lang: copy.lang,
    title: copy.alreadyTitle,
    body: copy.alreadyBody,
    cabinetLabel: copy.toCabinet,
  });
}

/** ЮKassa не принимает карты зарубежных банков — им нужна Lava (EUR). */
function foreignCardAvailable(token: PayRetryPayload): boolean {
  const gateway = resolvePaymentGateway({ country: token.country, currency: token.currency });
  return gateway.ok && gateway.provider === "yookassa" && isPaymentProviderEnabled("lavatop");
}

function paypalAvailable(token: PayRetryPayload): boolean {
  if (token.currency === "RUB") return false;
  const gateway = resolvePaymentGateway({ country: token.country, currency: token.currency });
  return gateway.ok && gateway.provider === "lavatop";
}

/** Варианты после отказа: тот же вид оплаты другой картой, PayPal, 30 дней. */
export function buildFailedActions(params: {
  kind: PayRetryKind;
  blocks: Awaited<ReturnType<typeof tierCheckoutBlocks>>;
  paypal: boolean;
  foreignCard?: boolean;
  copy: PayPageCopy;
}): PageAction[] | "already_active" {
  const { blocks, copy } = params;
  if (blocks.subscription === "already_active") return "already_active";
  const actions: PageAction[] = [];
  if (!blocks[params.kind]) {
    actions.push({ label: copy.payOtherCard, option: "card" });
    if (params.foreignCard) actions.push({ label: copy.payForeignCard, option: "foreign" });
    if (params.paypal) actions.push({ label: copy.payPaypal, option: "paypal" });
  }
  if (params.kind === "subscription" && !blocks.pass) {
    actions.push({ label: copy.payPass, option: "pass" });
  }
  return actions;
}

/** Варианты на странице продления: ещё 30 дней, PayPal, подписка. */
export function buildRenewActions(params: {
  blocks: Awaited<ReturnType<typeof tierCheckoutBlocks>>;
  paypal: boolean;
  copy: PayPageCopy;
}): PageAction[] | "already_active" {
  const { blocks, copy } = params;
  if (blocks.subscription === "already_active") return "already_active";
  const actions: PageAction[] = [];
  if (!blocks.pass) {
    actions.push({ label: copy.renewPass, option: "pass" });
    if (params.paypal) actions.push({ label: copy.payPaypal, option: "paypal" });
  }
  if (!blocks.subscription) actions.push({ label: copy.renewSubscription, option: "subscription" });
  return actions;
}

export async function renderFailedPage(db: SupabaseClient, token: PayRetryPayload, rawToken: string): Promise<Response> {
  const copy = getPayPageCopy(token.locale);
  const actions = buildFailedActions({
    kind: token.kind,
    blocks: await tierCheckoutBlocks(db, { userId: token.userId, tier: token.tier }),
    paypal: paypalAvailable(token),
    foreignCard: foreignCardAvailable(token),
    copy,
  });
  if (actions === "already_active") return redirect(accountCabinetUrl({ paid: true }));
  if (actions.length === 0) return alreadyPage(copy);
  return renderPayPage({
    lang: copy.lang,
    title: copy.failedTitle,
    body: copy.failedBody,
    token: rawToken,
    actions,
    cabinetLabel: copy.toCabinet,
  });
}

export async function handlePayFailedGet(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const token = verifyPayRetryToken(raw);
  if (!token) return expiredPage(getPayPageCopy(null));
  return renderFailedPage(createServiceSupabase({ fetchTimeoutMs: 6_000 }), token, raw);
}

export async function handlePayRenewGet(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const token = verifyPayRetryToken(raw);
  if (!token) return expiredPage(getPayPageCopy(null));
  const copy = getPayPageCopy(token.locale);
  const db = createServiceSupabase({ fetchTimeoutMs: 6_000 });

  const actions = buildRenewActions({
    blocks: await tierCheckoutBlocks(db, { userId: token.userId, tier: token.tier }),
    paypal: paypalAvailable(token),
    copy,
  });
  if (actions === "already_active" || actions.length === 0) return alreadyPage(copy);

  const { data: user } = await db
    .from("users")
    .select("membership_tier,membership_expires_at")
    .eq("id", token.userId)
    .maybeSingle();
  const expiresAt = (user?.membership_expires_at as string | null) ?? null;
  const body =
    expiresAt && user?.membership_tier === token.tier
      ? fillPayCopy(copy.renewBody, { tier: payTierName(copy, token.tier), date: formatPayDate(expiresAt, copy.lang) })
      : "";
  return renderPayPage({
    lang: copy.lang,
    title: copy.renewTitle,
    body,
    token: raw,
    actions,
    cabinetLabel: copy.toCabinet,
  });
}

export type RetryChoice = { kind: PayRetryKind; paypal: boolean; foreign?: boolean };

export function retryChoice(token: PayRetryPayload, option: string): RetryChoice | null {
  switch (option) {
    case "card":
      return { kind: token.kind, paypal: false };
    case "foreign":
      return { kind: token.kind, paypal: false, foreign: true };
    case "paypal":
      return { kind: token.kind, paypal: true };
    case "pass":
      return { kind: "pass", paypal: false };
    case "subscription":
      return { kind: "subscription", paypal: false };
    default:
      return null;
  }
}

export async function handlePayRetryPost(req: Request): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const token = verifyPayRetryToken(form.get("t"));
  if (!token) return expiredPage(getPayPageCopy(null));
  const copy = getPayPageCopy(token.locale);
  const choice = retryChoice(token, form.get("o") ?? "");
  if (!choice) return expiredPage(copy);

  try {
    const out = await startTierCheckout(createServiceSupabase(), {
      userId: token.userId,
      tier: token.tier,
      kind: choice.kind,
      // Lava, международная карта: EUR без страны → профиль INT.
      currency: choice.foreign ? "EUR" : token.currency,
      country: choice.foreign ? null : token.country,
      paymentMethod: choice.paypal ? "PAYPAL" : null,
    });
    if (out.ok) return redirect(out.paymentUrl);
    if (out.error === "already_active") return redirect(accountCabinetUrl({ paid: true }));
    if (out.error === "has_subscription" || out.error === "higher_access") return alreadyPage(copy);
    console.error("[pay/retry] checkout refused", out.error, token.userId);
  } catch (error) {
    const detail = error instanceof LavaInvoiceError ? error.lavaBody.slice(0, 300) : error;
    console.error("[pay/retry] checkout failed", token.userId, detail);
  }
  return renderPayPage({
    lang: copy.lang,
    title: copy.errorTitle,
    body: copy.errorBody,
    cabinetLabel: copy.toCabinet,
    status: 502,
  });
}

export async function handlePayReturnGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? "";
  const contractId = url.searchParams.get("c") ?? "";
  const attempt = Number(url.searchParams.get("n") ?? "0") || 0;
  const token = verifyPayRetryToken(raw);
  if (!token || !contractId) return redirect(accountCabinetUrl());
  const copy = getPayPageCopy(token.locale);
  const db = createServiceSupabase({ fetchTimeoutMs: 6_000 });

  const { data: contract, error } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,status,provider,provider_payment_id")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  if (!contract || contract.user_id !== token.userId) return redirect(accountCabinetUrl());
  if (contract.status === "active") return redirect(accountCabinetUrl({ paid: true }));
  if (contract.status === "failed") return renderFailedPage(db, token, raw);

  if (contract.provider === "yookassa" && contract.provider_payment_id) {
    const payment = await fetchYookassaPayment(contract.provider_payment_id as string);
    if (payment.status === "succeeded" || payment.status === "waiting_for_capture") {
      return redirect(accountCabinetUrl({ paid: true }));
    }
    if (payment.status === "canceled") {
      await markContractFailed(db, contractId, yookassaFailureReason(payment));
      return renderFailedPage(db, token, raw);
    }
  }

  if (attempt >= RETURN_POLL_MAX) return renderFailedPage(db, token, raw);
  const next = new URLSearchParams({ t: raw, c: contractId, n: String(attempt + 1) });
  return renderPayPage({
    lang: copy.lang,
    title: copy.checkingTitle,
    body: copy.checkingBody,
    refreshUrl: `${url.pathname}?${next}`,
  });
}
