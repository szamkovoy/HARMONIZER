/**
 * Переход из приложения в Личный кабинет на сайте (системный браузер).
 *
 * Поток OTT (one-time token):
 *   1. POST /api/account/ott (Bearer JWT приложения) → одноразовый токен ~5 мин.
 *   2. `Linking.openURL("https://zamkovoi.yoga/cabinet/?ott=…&lang=…")` —
 *      строго системный браузер (Safari/Chrome), НЕ WebView: оплата внутри
 *      встроенного браузера запрещена правилами Apple/Google.
 *   3. Страница кабинета меняет OTT на кабинетную сессию через
 *      POST /api/account/session (CORS только для домена сайта).
 */
import { Linking } from "react-native";

import { getResponseLocale } from "@/modules/i18n";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

const DEFAULT_CABINET_URL = "https://zamkovoi.yoga/cabinet/";
const OTT_TIMEOUT_MS = 12_000;

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

/**
 * Открыть Личный кабинет. Бросает ошибку, если не удалось получить OTT —
 * UI показывает локализованное сообщение (`gate.cabinetError`).
 */
export async function openAccountCabinet(): Promise<void> {
  const ott = await requestOneTimeToken();
  const url = new URL(getAccountCabinetUrl());
  url.searchParams.set("ott", ott);
  url.searchParams.set("lang", getResponseLocale());
  await Linking.openURL(url.toString());
}
