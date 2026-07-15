/**
 * Переход из приложения в Личный кабинет на сайте (системный браузер).
 *
 * Поток OTT (one-time token):
 *   1. POST /api/account/ott (Bearer JWT приложения) → одноразовый токен ~5 мин.
 *   2. `Linking.openURL("https://zamkovoi.yoga/cabinet/?ott=…&lang=…&currency=…&ctx=…")` —
 *      строго системный браузер (Safari/Chrome), НЕ WebView: оплата внутри
 *      встроенного браузера запрещена правилами Apple/Google.
 *   3. Страница кабинета меняет OTT на кабинетную сессию через
 *      POST /api/account/session (CORS только для домена сайта).
 *
 * Параметры ссылки:
 *   - lang: язык интерфейса кабинета (= локаль приложения);
 *   - currency: валюта цен по геолокации (RU→RUB, US→USD, иначе EUR);
 *   - ctx: контекст перехода — что кабинет поднимает наверх
 *     ("tier" | "webinar:<id>" | "course:<id>"). Задел под вебинары/курсы.
 *
 * Перед открытием пишется флаг cabinetVisit.<userId> — по возвращении в
 * foreground MembershipEventsBridge сверяет тариф с сервером (страховка,
 * если Realtime-событие оплаты не дошло).
 */
import { Linking } from "react-native";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { resolveBillingCurrency } from "@/modules/account/core/billingCurrency";
import { getResponseLocale } from "@/modules/i18n";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken, getSupabaseSessionSnapshot } from "@/services/supabase";

const DEFAULT_CABINET_URL = "https://zamkovoi.yoga/cabinet/";
const OTT_TIMEOUT_MS = 12_000;

export type CabinetContext = "tier" | `webinar:${string}` | `course:${string}`;

/** Свежесть визита в кабинет для foreground-проверки тарифа. */
export const CABINET_VISIT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function getAccountCabinetUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_ACCOUNT_CABINET_URL?.trim();
  return (explicit || DEFAULT_CABINET_URL).replace(/\/+$/, "/");
}

async function requestOneTimeToken(): Promise<string> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) throw new Error("No active session for account cabinet transition.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OTT_TIMEOUT_MS);
  try {
    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/account/ott`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`account/ott HTTP ${res.status}`);
    const data = (await res.json()) as { ott?: string };
    if (!data.ott) throw new Error("account/ott returned no token");
    return data.ott;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function markCabinetVisit(userId: string, ctx: CabinetContext): Promise<void> {
  await writeAccountFlag(`cabinetVisit.${userId}`, JSON.stringify({ ctx, ts: Date.now() }));
}

export async function readFreshCabinetVisit(
  userId: string,
): Promise<{ ctx: CabinetContext; ts: number } | null> {
  const raw = await readAccountFlag(`cabinetVisit.${userId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ctx?: string; ts?: number };
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > CABINET_VISIT_MAX_AGE_MS) return null;
    return { ctx: (parsed.ctx as CabinetContext) ?? "tier", ts: parsed.ts };
  } catch {
    return null;
  }
}

export async function clearCabinetVisit(userId: string): Promise<void> {
  await writeAccountFlag(`cabinetVisit.${userId}`, "");
}

/**
 * Открыть Личный кабинет. Бросает ошибку, если не удалось получить OTT —
 * UI показывает локализованное сообщение (`gate.cabinetError`).
 */
export async function openAccountCabinet(ctx: CabinetContext = "tier"): Promise<void> {
  const session = await getSupabaseSessionSnapshot();
  const userId = session?.user?.id ?? null;
  const [ott, currency] = await Promise.all([requestOneTimeToken(), resolveBillingCurrency(userId)]);
  const url = new URL(getAccountCabinetUrl());
  url.searchParams.set("ott", ott);
  url.searchParams.set("lang", getResponseLocale());
  url.searchParams.set("currency", currency);
  url.searchParams.set("ctx", ctx);
  if (userId) await markCabinetVisit(userId, ctx);
  await Linking.openURL(url.toString());
}
