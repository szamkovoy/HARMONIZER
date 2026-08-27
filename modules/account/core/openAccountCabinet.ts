/**
 * Переход из приложения в Личный кабинет на сайте (системный браузер).
 *
 * Поток OTT (one-time token):
 *   1. POST /api/account/ott (Bearer JWT приложения) → одноразовый токен ~5 мин.
 *   2. `WebBrowser.openBrowserAsync(...)` — SFSafariViewController / Chrome Custom Tabs
 *      (внешний браузер, НЕ WebView). На Android `createTask: false`, чтобы OS не
 *      убивала Activity приложения при уходе в Chrome (иначе после закрытия кабинета
 *      кажется, что приложение «перезагрузилось»).
 *   3. Страница кабинета меняет OTT на кабинетную сессию через
 *      POST /api/account/session (CORS только для домена сайта).
 *
 * Параметры ссылки:
 *   - lang: язык интерфейса кабинета (= локаль приложения);
 *   - currency: валюта цен по геолокации (RU→RUB, US→USD, иначе EUR);
 *   - country: ISO страны для выбора шлюза (RU → ЮKassa при region=RU; иначе INT);
 *   - ctx: контекст перехода — что кабинет поднимает наверх
 *     ("tier" | "webinar:<id>" | "course:<id>"). Задел под вебинары/курсы.
 *
 * Перед открытием пишется флаг cabinetVisit.<userId> — по возвращении в
 * foreground MembershipEventsBridge сверяет тариф с сервером (страховка,
 * если Realtime-событие оплаты не дошло).
 *
 * UX: не открывать SFSafari поверх RN Modal (чёрный кадр) — call sites передают
 * `beforeOpen` (закрыть модалку) после готовности URL; presentationStyle =
 * FullScreen (не дефолтный OverFullScreen); светлый toolbar под белую страницу
 * кабинета; Android Custom Tabs можно прогреть через `warmAccountCabinetBrowser`.
 */
import { InteractionManager, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { resolveBillingGeo } from "@/modules/account/core/billingCurrency";
import { getResponseLocale } from "@/modules/i18n";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";
import { getSupabaseAccessToken, getSupabaseSessionSnapshot } from "@/services/supabase";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";

const DEFAULT_CABINET_URL = "https://zamkovoi.yoga/cabinet/";
const OTT_TIMEOUT_MS = 12_000;
/** OTT живёт ~5 мин на сервере — кэш чуть короче, чтобы не отдать почти протухший. */
const OTT_PREFETCH_TTL_MS = 3 * 60 * 1000;

export type CabinetContext = "tier" | `webinar:${string}` | `course:${string}`;

export type OpenAccountCabinetOptions = {
  /**
   * Вызывается после готовности URL и до `openBrowserAsync` —
   * закрыть RN Modal / диалог, иначе SFSafari поверх Modal даёт чёрный кадр.
   */
  beforeOpen?: () => void;
};

/** Свежесть визита в кабинет для foreground-проверки тарифа. */
export const CABINET_VISIT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

type PrefetchedOtt = { ott: string; fetchedAt: number };
let prefetchedOtt: PrefetchedOtt | null = null;
let ottPrefetchInFlight: Promise<void> | null = null;

export function getAccountCabinetUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_ACCOUNT_CABINET_URL?.trim();
  return (explicit || DEFAULT_CABINET_URL).replace(/\/+$/, "/");
}

async function requestOneTimeTokenOnce(): Promise<string> {
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
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `account/ott HTTP ${res.status}`);
    }
    const data = (await res.json()) as { ott?: string };
    if (!data.ott) throw new Error("account/ott returned no token");
    return data.ott;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Ретраи на PostgREST 503 / schema cache (типичный краткий сбой Supabase). */
async function requestOneTimeToken(): Promise<string> {
  return withTransientNetworkRetry(requestOneTimeTokenOnce, {
    attempts: 3,
    delaysMs: [400, 900],
  });
}

function takePrefetchedOtt(): string | null {
  const cached = prefetchedOtt;
  prefetchedOtt = null;
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > OTT_PREFETCH_TTL_MS) return null;
  return cached.ott;
}

/**
 * Фоновый прогрев OTT (и JWT refresh), чтобы тап «Личный кабинет» сразу
 * открывал браузер. Безопасно вызывать многократно — dedupe in-flight.
 */
export function prefetchAccountCabinetOtt(): void {
  if (prefetchedOtt && Date.now() - prefetchedOtt.fetchedAt < OTT_PREFETCH_TTL_MS) return;
  if (ottPrefetchInFlight) return;
  ottPrefetchInFlight = (async () => {
    try {
      const ott = await requestOneTimeToken();
      prefetchedOtt = { ott, fetchedAt: Date.now() };
    } catch {
      /* best-effort — open path will fetch again */
    } finally {
      ottPrefetchInFlight = null;
    }
  })();
}

/**
 * Android Custom Tabs: прогрев процесса браузера + mayInit с базовым URL кабинета.
 * На iOS no-op (API платформенный).
 */
export function warmAccountCabinetBrowser(): void {
  if (Platform.OS !== "android") return;
  void (async () => {
    try {
      await WebBrowser.warmUpAsync();
      await WebBrowser.mayInitWithUrlAsync(getAccountCabinetUrl());
    } catch {
      /* best-effort */
    }
  })();
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

function yieldForModalDismiss(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      // One frame after interactions so RN Modal finishes unmount before SFSafari presents.
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Открыть Личный кабинет. Бросает ошибку, если не удалось получить OTT —
 * UI показывает локализованное сообщение (`gate.cabinetError`).
 */
export async function openAccountCabinet(
  ctx: CabinetContext = "tier",
  options?: OpenAccountCabinetOptions,
): Promise<void> {
  const session = await getSupabaseSessionSnapshot();
  const userId = session?.user?.id ?? null;
  try {
    // geo: кэш/таймаут ≤800мс — не блокируем openURL долгим reverse-geocode.
    if (ottPrefetchInFlight) await ottPrefetchInFlight;
    const cachedOtt = takePrefetchedOtt();
    const [ott, geo] = await Promise.all([
      cachedOtt ? Promise.resolve(cachedOtt) : requestOneTimeToken(),
      resolveBillingGeo(userId),
    ]);
    const url = new URL(getAccountCabinetUrl());
    url.searchParams.set("ott", ott);
    url.searchParams.set("lang", getResponseLocale());
    url.searchParams.set("currency", geo.currency);
    if (geo.country) url.searchParams.set("country", geo.country);
    url.searchParams.set("ctx", ctx);
    if (userId) await markCabinetVisit(userId, ctx);

    // Close RN Modal (if any) before presenting the system browser.
    options?.beforeOpen?.();
    if (options?.beforeOpen) await yieldForModalDismiss();

    // Custom Tabs / SFSafariViewController — still an external browser (App Store /
    // Play billing rules). createTask:false keeps the Expo activity alive on Android.
    // FullScreen (not default OverFullScreen) + light toolbar avoid the black flash
    // before the white cabinet HTML paints.
    await WebBrowser.openBrowserAsync(url.toString(), {
      createTask: Platform.OS === "android" ? false : undefined,
      showInRecents: true,
      toolbarColor: "#FFFFFF",
      controlsColor: "#111111",
      dismissButtonStyle: "close",
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
    });
    logRuntimeEvent("cabinet:opened", {
      ctx,
      currency: geo.currency,
      country: geo.country || null,
      platform: Platform.OS,
      usedPrefetchedOtt: Boolean(cachedOtt),
    });
  } catch (error) {
    logRuntimeEvent(
      "cabinet:open_failed",
      {
        ctx,
        platform: Platform.OS,
        hasSession: Boolean(userId),
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
      },
      "warn",
    );
    throw error;
  }
}
