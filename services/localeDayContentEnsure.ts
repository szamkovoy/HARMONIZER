import type { ProductTier } from "@/modules/access";
import type { DailyForecast } from "@/modules/daily-engine";
import type { AppLocale } from "@/modules/i18n";
import type { AccessMode } from "@/services/globalContentClient";
import { callMonologue } from "@/services/aiClient";
import { fetchDailyForecast } from "@/services/dailyForecastClient";
import {
  peekDayContentCache,
  peekDayContentCacheRelaxed,
  saveDayContentCache,
  type CachedDayContentSource,
} from "@/services/dayContentCache";
import { isDayContentComplete, isFreeDayContentRenderable } from "@/services/dayContentIntegrity";
import { assertDayTextsMatchLocale, dayTextsMatchLocale } from "@/services/dayContentLocaleGuard";
import { DAY_CONTENT_LLM_TIMEOUT_MS } from "@/services/dayContentTimeouts";
import { fetchGlobalContent } from "@/services/globalContentClient";
import type { LocaleDayContentWarmPayload } from "@/services/localeDayContentBridge";

export type EnsureLocaleDayContentParams = {
  userId: string;
  locale: AppLocale;
  accessMode: AccessMode;
  accessTier: ProductTier;
  userLocation: { lat: number; lng: number; timezone: string };
  birthDate?: string | null;
  birthTime?: string | null;
  birthPlace?: unknown;
  /**
   * Пересобрать LLM-тексты дня на `locale` (смена языка / miss в кэше).
   * Само по себе НЕ форсирует пересчёт эфемерид — см. `forceStructuralRefresh`.
   */
  forceRefresh?: boolean;
  /**
   * Пересчитать числовой каркас дня (эфемериды) + инвалидировать morning на сервере.
   * Нужен после смены натала; при одной смене языка оставлять false.
   */
  forceStructuralRefresh?: boolean;
  signal?: AbortSignal;
};

export type EnsuredLocaleDayContent = LocaleDayContentWarmPayload;

type MorningMonologue = {
  slogan: string;
  short_text: string;
  long_explanation: string;
  math_level?: unknown;
  model?: string;
};

function localDateIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function natalScopeKey(profile: {
  birthDate?: string | null;
  birthTime?: string | null;
  birthPlace?: unknown;
}): string {
  const raw = [
    profile.birthDate ?? "",
    profile.birthTime ?? "",
    typeof profile.birthPlace === "string" ? profile.birthPlace : JSON.stringify(profile.birthPlace ?? null),
  ].join("|");
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "default";
}

function contentScopeKey(accessMode: AccessMode, natalScope: string, locale: AppLocale): string {
  const base = accessMode === "free" ? "global" : natalScope;
  return `${base}:${locale}`;
}

function asWarmPayload(params: {
  locale: AppLocale;
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  userLocation: { lat: number; lng: number; timezone: string };
  forecast: DailyForecast;
  source: CachedDayContentSource;
  modelUsed: string | null;
}): EnsuredLocaleDayContent {
  return params;
}

async function fetchMorningMonologue(
  locale: AppLocale,
  opts: { forceRefresh?: boolean; localeSwitch?: boolean },
  signal?: AbortSignal,
): Promise<MorningMonologue> {
  const monologue = await callMonologue<{
    slogan?: string;
    short_text?: string;
    long_explanation?: string;
    math_level?: unknown;
    model?: string;
    modelUsed?: string;
    error?: string;
    code?: string;
  }>(
    "morning_recommendation",
    {
      forceRefresh: opts.forceRefresh === true,
      localeSwitch: opts.localeSwitch === true,
    },
    signal,
    locale,
  );
  if (monologue.error) throw new Error(monologue.error);
  const slogan = String(monologue.slogan ?? "").trim();
  const short_text = String(monologue.short_text ?? "").trim();
  const long_explanation = String(monologue.long_explanation ?? "").trim();
  if (!slogan || !short_text || !long_explanation) {
    throw new Error("Morning recommendation ensure returned incomplete texts");
  }
  assertDayTextsMatchLocale(locale, slogan, short_text);
  const model =
    typeof monologue.model === "string"
      ? monologue.model
      : typeof monologue.modelUsed === "string"
        ? monologue.modelUsed
        : undefined;
  return {
    slogan,
    short_text,
    long_explanation,
    math_level: monologue.math_level,
    model,
  };
}

function readExistingWarm(
  params: EnsureLocaleDayContentParams,
  forecastDate: string,
  scopeKey: string,
): EnsuredLocaleDayContent | null {
  const strict = peekDayContentCache({
    userId: params.userId,
    accessMode: params.accessMode,
    accessTier: params.accessTier,
    forecastDate,
    scopeKey,
    userLocation: params.userLocation,
  });
  const hit =
    strict?.freshness === "fresh"
      ? { ...strict, location: params.userLocation }
      : peekDayContentCacheRelaxed({
          userId: params.userId,
          accessMode: params.accessMode,
          accessTier: params.accessTier,
          forecastDate,
          scopeKey,
        });
  if (!hit || hit.freshness !== "fresh") return null;
  const warmOk =
    params.accessMode === "free"
      ? isFreeDayContentRenderable(hit.forecast)
      : isDayContentComplete(hit.forecast, params.accessMode);
  if (!warmOk) return null;
  if (
    !dayTextsMatchLocale(
      params.locale,
      String(hit.forecast.slogan ?? ""),
      String(hit.forecast.recommendationShortText ?? ""),
    )
  ) {
    return null;
  }
  return asWarmPayload({
    locale: params.locale,
    userId: params.userId,
    accessMode: params.accessMode,
    accessTier: params.accessTier,
    forecastDate,
    scopeKey,
    userLocation: "location" in hit ? hit.location : params.userLocation,
    forecast: hit.forecast,
    source: hit.source,
    modelUsed: hit.modelUsed,
  });
}

/**
 * Ensure day recommendation texts exist for `locale` and persist a complete
 * entry in `dayContentCache` so Home can paint instantly after `setAppLocale`.
 * Returns the warmed payload for Profile→Home bridge publish.
 */
export async function ensureLocaleDayContent(
  params: EnsureLocaleDayContentParams,
): Promise<EnsuredLocaleDayContent> {
  const forceRefresh = params.forceRefresh === true;
  const forecastDate = localDateIso(params.userLocation.timezone);
  const scopeKey = contentScopeKey(
    params.accessMode,
    natalScopeKey({
      birthDate: params.birthDate,
      birthTime: params.birthTime,
      birthPlace: params.birthPlace,
    }),
    params.locale,
  );

  // Switching back to a locale already warmed today — reuse phone cache (no LLM).
  if (!forceRefresh) {
    const existing = readExistingWarm(params, forecastDate, scopeKey);
    if (existing) return existing;
  }

  if (params.accessMode === "free") {
    const load = async (refresh: boolean) => {
      const result = await fetchGlobalContent({
        userLocation: params.userLocation,
        responseLocale: params.locale,
        forceRefresh: refresh,
        signal: params.signal,
      });
      // Accept renderable free texts (long_explanation may be stripped when the
      // server row still has a legacy/non-§ body). Requiring isDayContentComplete
      // here forced forceRefresh → full-day LLM after every app restart.
      if (!isFreeDayContentRenderable(result.forecast)) {
        throw new Error("Global day content ensure returned incomplete texts");
      }
      assertDayTextsMatchLocale(
        params.locale,
        String(result.forecast.slogan ?? ""),
        String(result.forecast.recommendationShortText ?? ""),
      );
      return result;
    };

    // Free: only force when the caller explicitly asked. Do not auto-escalate on
    // incomplete long text — that path waits on LLM and is what made IT→RU slow.
    let result;
    try {
      result = await load(forceRefresh);
    } catch (error) {
      if (forceRefresh || params.signal?.aborted) throw error;
      // Hard miss (no row / no locale slogan) → one awaited locale backfill.
      // Server no longer regenerates the whole day just for a missing locale.
      result = await load(true);
    }

    await saveDayContentCache({
      userId: params.userId,
      accessMode: "free",
      accessTier: params.accessTier,
      forecastDate,
      scopeKey,
      userLocation: params.userLocation,
      content: {
        forecast: result.forecast,
        source: "global",
        modelUsed: result.modelUsed,
      },
    });
    return asWarmPayload({
      locale: params.locale,
      userId: params.userId,
      accessMode: "free",
      accessTier: params.accessTier,
      forecastDate,
      scopeKey,
      userLocation: params.userLocation,
      forecast: result.forecast,
      source: "global",
      modelUsed: result.modelUsed,
    });
  }

  // Locale switch: prefer translating the canonical source texts already cached
  // for today (fast). Full big-prompt regenerate only when no source exists or
  // the caller forced a structural natal refresh.
  // No silent retry on timeout — Profile shows the error/confirm dialog instead
  // of stretching to ~2–2.5 minutes with a second 120s attempt.
  const preferLocaleSwitch = params.forceStructuralRefresh !== true;
  const monologue = await fetchMorningMonologue(
    params.locale,
    {
      forceRefresh,
      localeSwitch: preferLocaleSwitch,
    },
    params.signal,
  );

  // Смена языка: только LLM-тексты (monologue выше) + кэш/structural forecast.
  // Смена натала: forceStructuralRefresh → сервер пересчитывает эфемериды и
  // morning (иначе новый каркас + stale scenario_cache). Без этого флага
  // forceRefresh на daily-forecast ложно запускал Astronomía + второй LLM
  // и упирался в короткий 25s HTTP-таймаут («timed out after 25s»).
  const structuralRefresh = params.forceStructuralRefresh === true;
  const daily = await fetchDailyForecast({
    forecastDate,
    userLocation: params.userLocation,
    responseLocale: params.locale,
    forceRefresh: structuralRefresh,
    timeoutMs: DAY_CONTENT_LLM_TIMEOUT_MS,
    signal: params.signal,
  });

  const merged = {
    ...daily.forecast,
    slogan: monologue.slogan,
    recommendationShortText: monologue.short_text,
    recommendationLongText: monologue.long_explanation,
    mathLevel:
      (monologue.math_level && typeof monologue.math_level === "object"
        ? (monologue.math_level as NonNullable<(typeof daily.forecast)["mathLevel"]>)
        : null) ?? daily.forecast.mathLevel,
  };
  if (!isDayContentComplete(merged, params.accessMode)) {
    throw new Error("Personal day content ensure returned incomplete texts");
  }
  assertDayTextsMatchLocale(params.locale, merged.slogan ?? "", merged.recommendationShortText ?? "");

  const modelUsed = daily.modelUsed ?? monologue.model ?? null;
  await saveDayContentCache({
    userId: params.userId,
    accessMode: params.accessMode,
    accessTier: params.accessTier,
    forecastDate,
    scopeKey,
    userLocation: params.userLocation,
    content: {
      forecast: merged,
      source: daily.source,
      modelUsed,
    },
  });
  return asWarmPayload({
    locale: params.locale,
    userId: params.userId,
    accessMode: params.accessMode,
    accessTier: params.accessTier,
    forecastDate,
    scopeKey,
    userLocation: params.userLocation,
    forecast: merged,
    source: daily.source,
    modelUsed,
  });
}
