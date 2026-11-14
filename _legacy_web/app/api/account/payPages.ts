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
import { sendPaymentAlert } from "./paymentAlerts";
import { logPaymentEvent } from "./paymentEvents";
import { isPaymentProviderEnabled, resolvePaymentGateway } from "./paymentGatewayProfile";
import { markContractFailed, yookassaFailureReason } from "./fulfillPaymentContract";
import { oneTimeAlreadyPaid, startOneTimeCheckout } from "./oneTimeCheckout";
import { paymentFailureKind, type PaymentFailureKind } from "./paymentFailureKind";
import {
  verifyOneTimeRetryToken,
  verifyPayRetryToken,
  type OneTimeRetryPayload,
  type PayRetryKind,
  type PayRetryPayload,
} from "./payRetryToken";
import { loadBuyer, startTierCheckout, tierCheckoutBlocks } from "./tierCheckout";
import { fetchYookassaPayment } from "./yookassa";

export type PayOption = "card" | "foreign" | "paypal" | "pass" | "subscription";

type PageAction = { label: string; option: PayOption };

/** Токен тарифа (подписка, 30 дней) или разовой покупки (вебинар, книга). */
type AnyPayToken =
  | { type: "tier"; payload: PayRetryPayload }
  | { type: "one_time"; payload: OneTimeRetryPayload };

function readPayToken(raw: string | null | undefined): AnyPayToken | null {
  const tier = verifyPayRetryToken(raw);
  if (tier) return { type: "tier", payload: tier };
  const oneTime = verifyOneTimeRetryToken(raw);
  if (oneTime) return { type: "one_time", payload: oneTime };
  return null;
}

type GatewayHint = { country: string | null; currency: "RUB" | "USD" | "EUR" };

/** Заголовок и текст страницы по тому, чем закончилась попытка. */
export function failedPageText(copy: PayPageCopy, view: PaymentFailureKind): { title: string; body: string } {
  if (view === "abandoned") return { title: copy.incompleteTitle, body: copy.incompleteBody };
  return { title: copy.failedTitle, body: view === "declined_3ds" ? copy.failedBody : copy.failedBodyGeneric };
}

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
    button[disabled] { opacity: .5; cursor: progress; }
    button.busy[disabled] { opacity: 1; }
    button.busy::before { content: ""; display: inline-block; width: 1em; height: 1em; margin-right: .6em;
      vertical-align: -.15em; border: 2px solid currentColor; border-right-color: transparent;
      border-radius: 50%; animation: hz-spin .7s linear infinite; }
    @keyframes hz-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { button.busy::before { animation-duration: 2s; } }
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
  // Новый счёт создаётся несколько секунд: нажатая кнопка крутит индикатор, остальные гаснут.
  document.querySelectorAll("form").forEach(function (f) {
    f.addEventListener("submit", function () {
      document.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      var own = f.querySelector("button");
      if (own) own.classList.add("busy");
    });
  });
  // Возврат кнопкой «назад» с формы оплаты: страница берётся из кэша — кнопки снова рабочие.
  window.addEventListener("pageshow", function () {
    document.querySelectorAll("button").forEach(function (b) {
      b.disabled = false;
      b.classList.remove("busy");
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
function foreignCardAvailable(token: GatewayHint): boolean {
  const gateway = resolvePaymentGateway({ country: token.country, currency: token.currency });
  return gateway.ok && gateway.provider === "yookassa" && isPaymentProviderEnabled("lavatop");
}

function paypalAvailable(token: GatewayHint): boolean {
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
  /** Подпись первой кнопки; по умолчанию «Оплатить другой картой». */
  retryLabel?: string;
}): PageAction[] | "already_active" {
  const { blocks, copy } = params;
  if (blocks.subscription === "already_active") return "already_active";
  const actions: PageAction[] = [];
  if (!blocks[params.kind]) {
    actions.push({ label: params.retryLabel ?? copy.payOtherCard, option: "card" });
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

/** Разовая покупка: повторить тем же способом, иностранная карта, PayPal. */
export function buildOneTimeActions(params: { paypal: boolean; foreignCard: boolean; copy: PayPageCopy }): PageAction[] {
  const actions: PageAction[] = [{ label: params.copy.payAgain, option: "card" }];
  if (params.foreignCard) actions.push({ label: params.copy.payForeignCard, option: "foreign" });
  if (params.paypal) actions.push({ label: params.copy.payPaypal, option: "paypal" });
  return actions;
}

export async function renderFailedPage(
  db: SupabaseClient,
  token: PayRetryPayload,
  rawToken: string,
  view: PaymentFailureKind = "declined",
): Promise<Response> {
  const copy = getPayPageCopy(token.locale);
  const actions = buildFailedActions({
    kind: token.kind,
    blocks: await tierCheckoutBlocks(db, { userId: token.userId, tier: token.tier }),
    paypal: paypalAvailable(token),
    foreignCard: foreignCardAvailable(token),
    copy,
    ...(view === "abandoned" ? { retryLabel: copy.payAgain } : {}),
  });
  if (actions === "already_active") return redirect(accountCabinetUrl({ paid: true }));
  if (actions.length === 0) return alreadyPage(copy);
  return renderPayPage({
    lang: copy.lang,
    ...failedPageText(copy, view),
    token: rawToken,
    actions,
    cabinetLabel: copy.toCabinet,
  });
}

async function renderOneTimeFailedPage(
  db: SupabaseClient,
  token: OneTimeRetryPayload,
  rawToken: string,
  view: PaymentFailureKind,
): Promise<Response> {
  if (await oneTimeAlreadyPaid(db, token)) return redirect(accountCabinetUrl({ paid: true }));
  const copy = getPayPageCopy(token.locale);
  return renderPayPage({
    lang: copy.lang,
    ...failedPageText(copy, view),
    token: rawToken,
    actions: buildOneTimeActions({
      paypal: paypalAvailable(token),
      foreignCard: foreignCardAvailable(token),
      copy,
    }),
    cabinetLabel: copy.toCabinet,
  });
}

function renderAnyFailedPage(
  db: SupabaseClient,
  token: AnyPayToken,
  rawToken: string,
  view: PaymentFailureKind,
): Promise<Response> {
  return token.type === "tier"
    ? renderFailedPage(db, token.payload, rawToken, view)
    : renderOneTimeFailedPage(db, token.payload, rawToken, view);
}

/** Причина последнего отказа по этому продукту: от неё зависит текст страницы. */
async function latestFailureView(db: SupabaseClient, token: AnyPayToken): Promise<PaymentFailureKind> {
  const tier = token.type === "tier" ? token.payload.tier : token.payload.product;
  const { data, error } = await db
    .from("payment_contracts")
    .select("failure_reason")
    .eq("user_id", token.payload.userId)
    .eq("tier", tier)
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[pay/failed] failure reason lookup", error.message ?? error);
    return "declined";
  }
  const reason = (data?.[0]?.failure_reason as string | null | undefined) ?? null;
  return reason ? paymentFailureKind(reason) : "declined";
}

/** Ссылка из письма называет счёт (c=): текст страницы — по причине его отказа. */
async function contractFailureView(
  db: SupabaseClient,
  token: AnyPayToken,
  contractId: string | null,
): Promise<PaymentFailureKind | null> {
  if (!contractId) return null;
  const { data, error } = await db
    .from("payment_contracts")
    .select("user_id,failure_reason")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) {
    console.error("[pay/failed] contract lookup", error.message ?? error);
    return null;
  }
  if (!data || data.user_id !== token.payload.userId) return null;
  return paymentFailureKind(data.failure_reason as string | null);
}

export async function handlePayFailedGet(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const raw = params.get("t") ?? "";
  const token = readPayToken(raw);
  if (!token) return expiredPage(getPayPageCopy(null));
  const db = createServiceSupabase({ fetchTimeoutMs: 6_000 });
  // v=c — Lava cancel_return_url: покупатель сам закрыл форму.
  const view =
    params.get("v") === "c"
      ? "abandoned"
      : ((await contractFailureView(db, token, params.get("c"))) ?? (await latestFailureView(db, token)));
  return renderAnyFailedPage(db, token, raw, view);
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
  const token = readPayToken(form.get("t"));
  if (!token) return expiredPage(getPayPageCopy(null));
  const copy = getPayPageCopy(token.payload.locale);
  const option = form.get("o") ?? "";
  const issue = retryIssueContext(token);

  try {
    if (token.type === "one_time") {
      const redirectTo = await retryOneTime(token.payload, option);
      if (redirectTo) return redirect(redirectTo);
      return expiredPage(copy);
    }

    const choice = retryChoice(token.payload, option);
    if (!choice) return expiredPage(copy);
    const out = await startTierCheckout(createServiceSupabase(), {
      userId: token.payload.userId,
      tier: token.payload.tier,
      kind: choice.kind,
      // Lava, международная карта: EUR без страны → профиль INT.
      currency: choice.foreign ? "EUR" : token.payload.currency,
      country: choice.foreign ? null : token.payload.country,
      paymentMethod: choice.paypal ? "PAYPAL" : null,
    });
    if (out.ok) return redirect(out.paymentUrl);
    if (out.error === "already_active") {
      await notePayRetryIssue(issue, out.error, out.status, false);
      return redirect(accountCabinetUrl({ paid: true }));
    }
    if (out.error === "has_subscription" || out.error === "higher_access") {
      await notePayRetryIssue(issue, out.error, out.status, false);
      return alreadyPage(copy);
    }
    console.error("[pay/retry] checkout refused", out.error, token.payload.userId);
    await notePayRetryIssue(issue, out.error, out.status, out.status >= 500);
  } catch (error) {
    if (error instanceof PayRetryRefused) {
      console.error("[pay/retry] checkout refused", error.message, token.payload.userId);
      await notePayRetryIssue(issue, error.message, error.status, error.status >= 500);
    } else {
      const detail = error instanceof LavaInvoiceError ? error.lavaBody.slice(0, 300) : error;
      console.error("[pay/retry] checkout failed", token.payload.userId, detail);
      await notePayRetryIssue(
        issue,
        error instanceof Error ? error.message : "checkout_failed",
        502,
        true,
        detail,
      );
    }
  }
  return renderPayPage({
    lang: copy.lang,
    title: copy.errorTitle,
    body: copy.errorBody,
    cabinetLabel: copy.toCabinet,
    status: 502,
  });
}

class PayRetryRefused extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Новый счёт на вебинар или книгу. Возвращает адрес, куда отправить покупателя,
 * или null, если кнопка не распознана. Отказ шлюза — PayRetryRefused.
 */
async function retryOneTime(token: OneTimeRetryPayload, option: string): Promise<string | null> {
  if (option !== "card" && option !== "foreign" && option !== "paypal") return null;
  const db = createServiceSupabase();
  const buyer = await loadBuyer(db, token.userId);
  if (typeof buyer === "string") throw new PayRetryRefused(buyer, buyer === "user_not_found" ? 404 : 409);

  const start = (webinarId: string | null) =>
    startOneTimeCheckout(db, {
      userId: token.userId,
      product: token.product,
      webinarId,
      // Lava, международная карта: EUR без страны → профиль INT.
      currency: option === "foreign" ? "EUR" : token.currency,
      country: option === "foreign" ? null : token.country,
      paymentMethod: option === "paypal" ? "PAYPAL" : null,
      buyer,
    });

  let out = await start(token.webinarId);
  // Вебинар из ссылки снят с публикации — записываем на ближайший.
  if (!out.ok && out.error === "webinar_not_found") out = await start(null);
  if (out.ok) return out.paymentUrl;
  if (out.error === "already_registered") return accountCabinetUrl({ paid: true });
  throw new PayRetryRefused(out.error, out.status);
}

export async function handlePayReturnGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("t") ?? "";
  const contractId = url.searchParams.get("c") ?? "";
  const attempt = Number(url.searchParams.get("n") ?? "0") || 0;
  const token = readPayToken(raw);
  if (!token || !contractId) return redirect(accountCabinetUrl());
  const copy = getPayPageCopy(token.payload.locale);
  const db = createServiceSupabase({ fetchTimeoutMs: 6_000 });

  const { data: contract, error } = await db
    .from("payment_contracts")
    .select("contract_id,user_id,status,provider,provider_payment_id,failure_reason")
    .eq("contract_id", contractId)
    .maybeSingle();
  if (error) throw error;
  if (!contract || contract.user_id !== token.payload.userId) return redirect(accountCabinetUrl());
  if (contract.status === "active") return redirect(accountCabinetUrl({ paid: true }));
  if (contract.status === "failed") {
    return renderAnyFailedPage(db, token, raw, paymentFailureKind(contract.failure_reason as string | null));
  }

  if (contract.provider === "yookassa" && contract.provider_payment_id) {
    const payment = await fetchYookassaPayment(contract.provider_payment_id as string);
    if (payment.status === "succeeded" || payment.status === "waiting_for_capture") {
      return redirect(accountCabinetUrl({ paid: true }));
    }
    if (payment.status === "canceled") {
      const reason = yookassaFailureReason(payment);
      await markContractFailed(db, contractId, reason);
      return renderAnyFailedPage(db, token, raw, paymentFailureKind(reason));
    }
  }

  // Платёж всё ещё pending: человек вышел с формы, не оплатив.
  if (attempt >= RETURN_POLL_MAX) return renderAnyFailedPage(db, token, raw, "abandoned");
  const next = new URLSearchParams({ t: raw, c: contractId, n: String(attempt + 1) });
  return renderPayPage({
    lang: copy.lang,
    title: copy.checkingTitle,
    body: copy.checkingBody,
    refreshUrl: `${url.pathname}?${next}`,
  });
}

type RetryIssueContext = {
  userId: string;
  product: string;
  kind: string;
  currency: string;
  provider: "yookassa" | "lavatop";
};

/** Шлюз, в который ушёл бы повторный счёт: то же правило, что и при создании счёта. */
function retryIssueProvider(hint: GatewayHint): "yookassa" | "lavatop" {
  const gateway = resolvePaymentGateway({ country: hint.country, currency: hint.currency });
  if (gateway.ok) return gateway.provider;
  return hint.country === "RU" ? "yookassa" : "lavatop";
}

function retryIssueContext(token: AnyPayToken): RetryIssueContext {
  const { payload } = token;
  return {
    userId: payload.userId,
    product: token.type === "tier" ? token.payload.tier : token.payload.product,
    kind: token.type === "tier" ? token.payload.kind : "one_time",
    currency: payload.currency,
    provider: retryIssueProvider(payload),
  };
}

async function notePayRetryIssue(
  ctx: RetryIssueContext,
  error: string,
  httpStatus: number,
  alert: boolean,
  raw?: unknown,
): Promise<void> {
  try {
    const db = createServiceSupabase();
    const eventType = alert ? "checkout.create_failed" : "checkout.refused";
    await logPaymentEvent(db, {
      provider: ctx.provider,
      eventType,
      buyerEmail: null,
      currency: ctx.currency,
      errorMessage: error,
      raw,
      httpStatus,
    });
    if (!alert) return;
    await sendPaymentAlert(db, {
      eventType,
      userId: ctx.userId,
      tier: ctx.product,
      productKind: ctx.kind,
      currency: ctx.currency,
      provider: ctx.provider,
      failureReason: error,
      raw,
    });
  } catch (err) {
    console.error("[pay/retry] journal failed", err);
  }
}
