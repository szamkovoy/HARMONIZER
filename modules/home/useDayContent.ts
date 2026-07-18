import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/modules/auth";
import { useAppStartup } from "@/modules/bootstrap/AppStartupProvider";
import type { DailyForecast } from "@/modules/daily-engine";
import { accessModeFromRow } from "@/modules/access/core/paidAccess";
import type { ProductTier } from "@/modules/access/core/tiers";
import { callMonologue, type MorningRecommendationResponse } from "@/services/aiClient";
import { getAiGlobalContentUrl, getDailyForecastUrl } from "@/services/communicatorConfig";
import { fetchDailyForecast, type DailyForecastResult } from "@/services/dailyForecastClient";
import { clearDayContentCache, loadDayContentCache, loadDayContentCacheRelaxed, peekDayContentCache, peekDayContentCacheRelaxed, pruneDayContentCache, saveDayContentCache } from "@/services/dayContentCache";
import { isBaseForecastValid, isDayContentComplete, isDayContentReadyForHome, isFreeDayContentRenderable } from "@/services/dayContentIntegrity";
import { dayTextsMatchLocale } from "@/services/dayContentLocaleGuard";
import { consumeLocaleDayContentWarm } from "@/services/localeDayContentBridge";
import { acquireAndPersistUserCoordinates, type LocationAcquireFailureReason } from "@/modules/location/acquireAndPersistUserCoordinates";
import { loadCachedUserCoords } from "@/modules/location/userLocationProfileCache";
import { dayContentLocationFallback } from "@/modules/location/defaultDayContentLocation";
import { fetchGlobalContent, type AccessMode } from "@/services/globalContentClient";
import { getResponseLocale, subscribeAppLocale, type AppLocale } from "@/modules/i18n/localeStore";
import { stripHomeLlmTexts } from "@/modules/home/stripHomeLlmTexts";
import { sanitizeRecommendationDisplay } from "@/modules/home/sanitizeRecommendationDisplay";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

type DayContentStatus =
  | "idle"
  | "loading"
  | "acquiring_location"
  | "need_location"
  | "need_birth_data"
  | "ready"
  | "stale_ready"
  | "error";
type DayContentSource = DailyForecastResult["source"] | "global";

export type DayContentRefreshOptions = {
  forceRefresh?: boolean;
  /** Locale switched — refresh in background without blocking splash. */
  localeChange?: boolean;
  accessModeOverride?: AccessMode;
  accessTierOverride?: ProductTier;
  /** Показать стартовый оверлей до готовности дня (после смены натальных данных с другого экрана). */
  blockingReload?: boolean;
};

export type DayContentUserLocation = {
  lat: number;
  lng: number;
  timezone: string;
};

export interface UseDayContentResult {
  forecast: DailyForecast | null;
  accessMode: AccessMode;
  modelUsed: string | null;
  source: DayContentSource | null;
  status: DayContentStatus;
  loading: boolean;
  error: Error | null;
  /** Причина сбоя авто-геолокации; null если coords есть или ещё не пробовали. */
  locationIssue: LocationAcquireFailureReason | null;
  userLocation: DayContentUserLocation | null;
  refresh: (opts?: DayContentRefreshOptions) => Promise<void>;
  /** True while locale-specific LLM texts (slogan/rec/math) are being fetched. */
  homeTextsLoading: boolean;
}

interface UseDayContentOptions {
  locationErrorMessage?: string;
  birthDataErrorMessage?: string;
  accessModeOverride?: AccessMode;
  accessTierOverride?: ProductTier;
  natalRequired?: boolean;
  hasNatalProfile?: boolean | null;
}

interface DayContentCacheContext {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  userLocation: {
    lat: number;
    lng: number;
    timezone: string;
  };
}

function localDateIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [error.message, error.error, error.details, error.hint, error.code]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (message) return new Error(message);
  }
  return new Error("Unknown day content error");
}

function locationError(message?: string): Error {
  return new Error(message ?? "Location is required to compute opportunity windows.");
}

function birthDataError(message?: string): Error {
  return new Error(message ?? "Birth data is required to compute the personal daily forecast.");
}

function buildContentScopeKey(accessMode: AccessMode, natalScope: string, locale: AppLocale): string {
  const base = accessMode === "free" ? "global" : natalScope;
  return `${base}:${locale}`;
}

function forecastTextsMatchLocale(forecast: DailyForecast, locale: AppLocale): boolean {
  return dayTextsMatchLocale(
    locale,
    String(forecast.slogan ?? ""),
    String(forecast.recommendationShortText ?? ""),
  );
}

/** Слоган + короткая рекомендация — минимум, чтобы главная считалась «готовой» (как в onboarding warmup). */
function hasHomeCardTexts(forecast: DailyForecast | null | undefined): boolean {
  return Boolean(forecast?.slogan?.trim() && forecast?.recommendationShortText?.trim());
}

/** Сколько оверлей «Готовим ваш день» держится в paid-пути, ожидая LLM-тексты (страховка, как в onboarding). */
const HOME_WARM_TEXTS_TIMEOUT_MS = 90_000;

async function enrichWithMorningContent(
  forecast: DailyForecast,
  forceRefresh: boolean | undefined,
  signal: AbortSignal,
  responseLocale: AppLocale,
): Promise<{ forecast: DailyForecast; modelUsed: string | null }> {
  const content = await callMonologue<MorningRecommendationResponse>(
    "morning_recommendation",
    { forceRefresh: Boolean(forceRefresh) },
    signal,
    responseLocale,
  );
  if (content.error) throw new Error(content.error);
  const shortText = content.short_text?.trim();
  const longText = content.long_explanation?.trim();
  return {
    forecast: Object.assign(forecast, {
      recommendationShortText: shortText
        ? sanitizeRecommendationDisplay(shortText, responseLocale)
        : forecast.recommendationShortText,
      recommendationLongText: longText
        ? sanitizeRecommendationDisplay(longText, responseLocale)
        : forecast.recommendationLongText,
      slogan: content.slogan?.trim() || forecast.slogan,
      mathLevel: content.math_level ?? forecast.mathLevel,
    }),
    modelUsed: content.modelUsed?.trim() || null,
  };
}

function dayContentScopeKey(
  profile: {
    birth_date?: string | null;
    birth_time?: string | null;
    birth_place?: unknown;
  } | null,
): string {
  const raw = [
    profile?.birth_date ?? "",
    profile?.birth_time ?? "",
    typeof profile?.birth_place === "string" ? profile.birth_place : JSON.stringify(profile?.birth_place ?? null),
  ].join("|");
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "default";
}

export function useDayContent(options?: UseDayContentOptions): UseDayContentResult {
  const { profile, profileLoading, refreshProfile } = useAuth();
  const { beginHomeBootstrap, completeHomeBootstrap, setHomeBootstrapPhase, setStartupStep } = useAppStartup();
  const abortRef = useRef<AbortController | null>(null);
  const secondaryContentAbortRef = useRef<AbortController | null>(null);
  const lastHydratedForecastKeyRef = useRef<string | null>(null);
  /** После `refresh({ forceRefresh/blockingReload })` пересчитать LLM-слой дня, даже если в forecast уже есть старые тексты. */
  const pendingMorningMonologueForceRef = useRef(false);
  const latestCacheContextRef = useRef<DayContentCacheContext | null>(null);
  const lastLocalDayRef = useRef<string | null>(null);
  const lastResolvedRequestKeyRef = useRef<string | null>(null);
  const trackedContentLocaleRef = useRef<AppLocale>(getResponseLocale());
  const latestForecastRef = useRef<DailyForecast | null>(null);
  const latestSourceRef = useRef<DayContentSource | null>(null);
  const latestModelUsedRef = useRef<string | null>(null);

  const [forecast, setForecast] = useState<DailyForecast | null>(null);
  const [source, setSource] = useState<DayContentSource | null>(null);
  const [status, setStatus] = useState<DayContentStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [locationIssue, setLocationIssue] = useState<LocationAcquireFailureReason | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>("free");
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [homeTextsLoading, setHomeTextsLoading] = useState(false);
  /** Location actually used for the painted forecast (may be GPS cache / free fallback). */
  const [resolvedUserLocation, setResolvedUserLocation] = useState<DayContentUserLocation | null>(null);
  const secondaryRunRef = useRef(0);
  /** true, пока мы намеренно держим bootstrap-оверлей в paid-пути, ожидая LLM-тексты дня. */
  const warmHeldRef = useRef(false);
  /** Таймаут-страховка: скрыть оверлей, если тексты не пришли за HOME_WARM_TEXTS_TIMEOUT_MS. */
  const warmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Держать оверлей «Готовим ваш день» пока нет слоган+short (paid, сервер отдал только базу). */
  const holdWarmForTexts = useCallback(() => {
    warmHeldRef.current = true;
    if (warmTimeoutRef.current) clearTimeout(warmTimeoutRef.current);
    warmTimeoutRef.current = setTimeout(() => {
      warmTimeoutRef.current = null;
      if (warmHeldRef.current) {
        warmHeldRef.current = false;
        completeHomeBootstrap();
        logRuntimeEvent("home_warm_texts_timeout", {}, "warn");
      }
    }, HOME_WARM_TEXTS_TIMEOUT_MS);
  }, [completeHomeBootstrap]);

  /** Снять удержание оверлея (тексты пришли или выход из пути). Идемпотентен. */
  const releaseWarmIfHeld = useCallback(() => {
    if (warmTimeoutRef.current) {
      clearTimeout(warmTimeoutRef.current);
      warmTimeoutRef.current = null;
    }
    if (warmHeldRef.current) {
      warmHeldRef.current = false;
      completeHomeBootstrap();
    }
  }, [completeHomeBootstrap]);

  useEffect(() => {
    latestForecastRef.current = forecast;
  }, [forecast]);

  useEffect(() => {
    latestSourceRef.current = source;
  }, [source]);

  useEffect(() => {
    latestModelUsedRef.current = modelUsed;
  }, [modelUsed]);

  const userLocation = useMemo(() => {
    if (typeof profile?.lat !== "number" || typeof profile?.lon !== "number") return null;
    return {
      lat: profile.lat,
      lng: profile.lon,
      timezone: profile.tz || "UTC",
    };
  }, [profile?.lat, profile?.lon, profile?.tz]);

  const profileId = profile?.id ?? null;
  const membershipTier = profile?.membership_tier ?? null;
  const trialExpiresAt = profile?.trial_expires_at ?? null;
  const membershipExpiresAt = profile?.membership_expires_at ?? null;
  const profileTimezone = profile?.tz ?? "UTC";
  const scopeKey = useMemo(
    () =>
      dayContentScopeKey({
        birth_date: profile?.birth_date,
        birth_time: profile?.birth_time,
        birth_place: profile?.birth_place,
      }),
    [profile?.birth_date, profile?.birth_time, profile?.birth_place],
  );

  const refresh = useCallback(
    async (opts?: DayContentRefreshOptions) => {
      abortRef.current?.abort();
      secondaryContentAbortRef.current?.abort();
      setError(null);
      setLocationIssue(null);
      if (opts?.forceRefresh || opts?.localeChange) {
        setHomeTextsLoading(true);
      }

      if (profileLoading) {
        beginHomeBootstrap("initializing", "AUTH/wait_profile_refresh");
        return;
      }

      const nextAccessMode =
        opts?.accessModeOverride ??
        options?.accessModeOverride ??
        accessModeFromRow({
          membership_tier: membershipTier,
          trial_expires_at: trialExpiresAt,
          membership_expires_at: membershipExpiresAt,
        });
      const nextAccessTier =
        opts?.accessTierOverride ??
        options?.accessTierOverride ??
        (nextAccessMode === "free" ? "free" : "oracle");
      const needsNatalProfile = Boolean(options?.natalRequired && nextAccessMode !== "free");
      const provisionalTimezone = userLocation?.timezone ?? profileTimezone;
      const provisionalForecastDate = localDateIso(provisionalTimezone);
      const contentLocale = getResponseLocale();
      const contentScopeKey = buildContentScopeKey(nextAccessMode, scopeKey, contentLocale);
      const requestKey = [profileId ?? "anon", nextAccessMode, nextAccessTier, provisionalForecastDate, contentScopeKey].join("|");
      const relaxedLookupParams = profileId
        ? {
            userId: profileId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate: provisionalForecastDate,
            scopeKey: contentScopeKey,
            allowStale: true as const,
          }
        : null;
      let relaxedCache =
        !opts?.forceRefresh && relaxedLookupParams ? peekDayContentCacheRelaxed(relaxedLookupParams) : null;
      const instantCached =
        !opts?.forceRefresh && profileId && userLocation
          ? peekDayContentCache({
              userId: profileId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate: provisionalForecastDate,
              scopeKey: contentScopeKey,
              userLocation,
            })
          : relaxedCache?.freshness === "fresh"
            ? relaxedCache
            : null;
      const hasPaintableOfflineCache = relaxedCache?.freshness === "stale";
      const shouldBlockSplash =
        Boolean(opts?.blockingReload) ||
        (!opts?.forceRefresh &&
          !opts?.localeChange &&
          (lastResolvedRequestKeyRef.current !== requestKey || !forecast) &&
          !(instantCached && instantCached.freshness === "fresh") &&
          !(relaxedCache?.freshness === "stale"));

      if (shouldBlockSplash) {
        beginHomeBootstrap("initializing", "HOME/home_overlay_start");
      }

      if (needsNatalProfile && options?.hasNatalProfile == null) {
        return;
      }
      if (needsNatalProfile && options?.hasNatalProfile === false) {
        const err = birthDataError(options?.birthDataErrorMessage);
        setForecast(null);
        setSource(null);
        setModelUsed(null);
        setResolvedUserLocation(null);
        latestCacheContextRef.current = null;
        setStatus("need_birth_data");
        setError(err);
        completeHomeBootstrap();
        return;
      }

      let locationForRequest = userLocation;
      if (!locationForRequest && profileId) {
        locationForRequest = await loadCachedUserCoords(profileId);
      }
      if (!locationForRequest && relaxedLookupParams && !opts?.forceRefresh && !relaxedCache) {
        setHomeBootstrapPhase("initializing", "HOME/day_cache_relaxed_read");
        relaxedCache = await loadDayContentCacheRelaxed(relaxedLookupParams);
      }
      const offlineStaleCache = relaxedCache?.freshness === "stale" ? relaxedCache : null;
      if (!locationForRequest && relaxedCache?.freshness === "fresh") {
        locationForRequest = relaxedCache.location;
      }

      let acquireFailure: LocationAcquireFailureReason | null = null;
      if (!locationForRequest && profileId) {
        setHomeBootstrapPhase("initializing", "HOME/gps_acquire_persist");
        setStatus("acquiring_location");
        logRuntimeEvent("day_content:auto_location_attempt", { profileId }, "info");
        const acquired = await acquireAndPersistUserCoordinates(profileId);
        if (acquired.ok) {
          locationForRequest = acquired.coords;
          if (acquired.persisted) {
            await refreshProfile();
          }
        } else {
          acquireFailure = acquired.reason;
          setLocationIssue(acquired.reason);
        }
      }

      if (!locationForRequest) {
        if (offlineStaleCache && profileId) {
          locationForRequest = offlineStaleCache.location;
          latestCacheContextRef.current = {
            userId: profileId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate: provisionalForecastDate,
            scopeKey: contentScopeKey,
            userLocation: offlineStaleCache.location,
          };
          setAccessMode(nextAccessMode);
          setForecast(offlineStaleCache.forecast);
          setSource(offlineStaleCache.source);
          setModelUsed(offlineStaleCache.modelUsed);
          setResolvedUserLocation(offlineStaleCache.location);
          setError(locationError(options?.locationErrorMessage));
          setStatus("stale_ready");
          lastResolvedRequestKeyRef.current = requestKey;
          completeHomeBootstrap();
          logRuntimeEvent(
            "day_content:offline_stale_with_missing_location",
            { reason: acquireFailure },
            "warn",
          );
          return;
        }

        // Free Home must not blank recommendations when GPS/permission is missing
        // after an app update (SecureStore/profile coords often empty on cold start).
        // Use the same Moscow/tz fallback as Profile locale ensure; keep locationIssue
        // so the user can retry real geolocation for accurate windows.
        if (nextAccessMode === "free") {
          locationForRequest = dayContentLocationFallback(profileTimezone);
          if (acquireFailure) {
            setLocationIssue(acquireFailure);
          }
          logRuntimeEvent(
            "day_content:free_location_fallback",
            {
              profileId,
              tz: profileTimezone,
              reason: acquireFailure,
            },
            "warn",
          );
        } else {
          const err = locationError(options?.locationErrorMessage);
          logRuntimeEvent(
            "day_content:missing_location",
            {
              hasProfile: Boolean(profileId),
              profileId,
              tz: profileTimezone,
              reason: acquireFailure,
            },
            "warn",
          );
          setForecast(null);
          setSource(null);
          setModelUsed(null);
          setResolvedUserLocation(null);
          latestCacheContextRef.current = null;
          setStatus("need_location");
          setError(err);
          if (acquireFailure) {
            setLocationIssue(acquireFailure);
          }
          completeHomeBootstrap();
          return;
        }
      }

      setResolvedUserLocation(locationForRequest);
      const resolvedInstantCache =
        !opts?.forceRefresh && profileId
          ? peekDayContentCache({
              userId: profileId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate: localDateIso(locationForRequest.timezone),
              scopeKey: contentScopeKey,
              userLocation: locationForRequest,
            })
          : null;
      if (resolvedInstantCache?.freshness === "fresh") {
        const cacheLocaleOk = forecastTextsMatchLocale(resolvedInstantCache.forecast, contentLocale);
        latestCacheContextRef.current = {
          userId: profileId!,
          accessMode: nextAccessMode,
          accessTier: nextAccessTier,
          forecastDate: localDateIso(locationForRequest.timezone),
          scopeKey: contentScopeKey,
          userLocation: locationForRequest,
        };
        const forecastForUi = cacheLocaleOk
          ? resolvedInstantCache.forecast
          : stripHomeLlmTexts(resolvedInstantCache.forecast);
        if (!cacheLocaleOk) {
          pendingMorningMonologueForceRef.current = true;
          lastHydratedForecastKeyRef.current = null;
        }
        setAccessMode(nextAccessMode);
        setForecast(forecastForUi);
        setSource(resolvedInstantCache.source);
        setModelUsed(resolvedInstantCache.modelUsed);
        setHomeTextsLoading(
          !isDayContentComplete(forecastForUi, nextAccessMode) ||
            !forecastTextsMatchLocale(forecastForUi, contentLocale),
        );
        setStatus("ready");
        lastResolvedRequestKeyRef.current = [
          profileId ?? "anon",
          nextAccessMode,
          nextAccessTier,
          localDateIso(locationForRequest.timezone),
          contentScopeKey,
        ].join("|");
        completeHomeBootstrap();
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let staleCache: Awaited<ReturnType<typeof loadDayContentCache>> | null = null;
      let resolvedRequestKey = requestKey;
      let resolvedForecastDate = provisionalForecastDate;
      let readyForecast: DailyForecast | null = null;

      try {
        const forecastDate = localDateIso(locationForRequest.timezone);
        resolvedForecastDate = forecastDate;
        const userId = profileId;
        resolvedRequestKey = [profileId ?? "anon", nextAccessMode, nextAccessTier, forecastDate, contentScopeKey].join("|");
        lastLocalDayRef.current = forecastDate;
        setAccessMode(nextAccessMode);

        if (userId) {
          if (opts?.forceRefresh) {
            await clearDayContentCache({ userId, forecastDate });
          }
        }

        if (!opts?.forceRefresh && userId) {
          setStartupStep("HOME/day_cache_async_read");
          const cached = await loadDayContentCache({
            userId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate,
            scopeKey: contentScopeKey,
            userLocation: locationForRequest,
            allowStale: true,
          });
          if (controller.signal.aborted) return;
          if (cached) {
            if (cached.freshness === "fresh") {
              const cacheLocaleOk = forecastTextsMatchLocale(cached.forecast, contentLocale);
              const forecastForUi = cacheLocaleOk ? cached.forecast : stripHomeLlmTexts(cached.forecast);
              if (!cacheLocaleOk) {
                pendingMorningMonologueForceRef.current = true;
                lastHydratedForecastKeyRef.current = null;
              }
              latestCacheContextRef.current = {
                userId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              };
              setForecast(forecastForUi);
              setSource(cached.source);
              setModelUsed(cached.modelUsed);
              setHomeTextsLoading(
                !isDayContentComplete(forecastForUi, nextAccessMode) ||
                  !forecastTextsMatchLocale(forecastForUi, contentLocale),
              );
              setStatus("ready");
              lastResolvedRequestKeyRef.current = resolvedRequestKey;
              completeHomeBootstrap();
              void pruneDayContentCache({ userId, forecastDate }).catch(() => undefined);
              return;
            }
            staleCache = cached;
          }
          void pruneDayContentCache({ userId, forecastDate }).catch(() => undefined);
        }

        setStatus("loading");
        setHomeBootstrapPhase(
          "loading_day",
          nextAccessMode === "free" ? "HOME/api_global_free" : "HOME/api_daily_forecast",
        );
        const requestUrl = nextAccessMode === "free" ? getAiGlobalContentUrl() : getDailyForecastUrl();
        logRuntimeEvent("day_content:request_start", {
          accessMode: nextAccessMode,
          forecastDate,
          url: requestUrl,
          forceRefresh: Boolean(opts?.forceRefresh),
        });
        // eslint-disable-next-line no-console
        console.log("[dayContent] refresh url", requestUrl);

        if (nextAccessMode === "free") {
          const result = await fetchGlobalContent({
            userLocation: locationForRequest,
            signal: controller.signal,
            responseLocale: getResponseLocale(),
          });
          if (!isFreeDayContentRenderable(result.forecast)) {
            throw new Error("Global day content is incomplete.");
          }
          const responseLocale = getResponseLocale();
          let forecastForUi = result.forecast;
          if (!forecastTextsMatchLocale(forecastForUi, responseLocale)) {
            forecastForUi = stripHomeLlmTexts(forecastForUi);
            pendingMorningMonologueForceRef.current = true;
            lastHydratedForecastKeyRef.current = null;
          }
          latestCacheContextRef.current = userId
            ? {
                userId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              }
            : null;
          setForecast(forecastForUi);
          readyForecast = forecastForUi;
          setSource("global");
          setModelUsed(result.modelUsed);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log("[dayContent] modelUsed", result.modelUsed ?? "unknown");
          }
          setAccessMode(nextAccessMode);
          if (userId && isDayContentComplete(forecastForUi, "free") && forecastTextsMatchLocale(forecastForUi, responseLocale)) {
            void saveDayContentCache({
              userId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate,
              scopeKey: contentScopeKey,
              userLocation: locationForRequest,
              content: {
                forecast: forecastForUi,
                source: "global",
                modelUsed: result.modelUsed,
              },
            }).catch(() => undefined);
          }
        } else {
          const result = await fetchDailyForecast({
            forecastDate,
            userLocation: locationForRequest,
            forceRefresh: opts?.forceRefresh,
            responseLocale: getResponseLocale(),
            signal: controller.signal,
          });
          const responseLocale = getResponseLocale();
          const localeOk = forecastTextsMatchLocale(result.forecast, responseLocale);
          const shouldForceMorningRefresh = Boolean(opts?.forceRefresh || opts?.localeChange || !localeOk);
          const hasCompleteServerContent = isDayContentComplete(result.forecast, nextAccessMode) && localeOk;
          let forecastForUi = result.forecast;
          pendingMorningMonologueForceRef.current = shouldForceMorningRefresh && !hasCompleteServerContent;
          if (shouldForceMorningRefresh && !hasCompleteServerContent) {
            forecastForUi = stripHomeLlmTexts(result.forecast);
            lastHydratedForecastKeyRef.current = null;
          } else if (hasCompleteServerContent) {
            lastHydratedForecastKeyRef.current = [
              userId ?? "anon",
              forecastDate,
              contentScopeKey,
              forecastForUi.date,
              forecastForUi.computedAt,
              nextAccessMode,
            ].join("|");
          }
          if (!isDayContentReadyForHome(forecastForUi, nextAccessMode)) {
            throw new Error("Personal day content is incomplete.");
          }
          const modelForUi = result.modelUsed;
          latestCacheContextRef.current = userId
            ? {
                userId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              }
            : null;
          setForecast(forecastForUi);
          readyForecast = forecastForUi;
          setSource(result.source);
          setModelUsed(modelForUi);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log("[dayContent] modelUsed", modelForUi ?? "unknown");
          }
          if (
            userId &&
            isDayContentComplete(forecastForUi, nextAccessMode) &&
            forecastTextsMatchLocale(forecastForUi, responseLocale)
          ) {
            void saveDayContentCache({
              userId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate,
              scopeKey: contentScopeKey,
              userLocation: locationForRequest,
              content: {
                forecast: forecastForUi,
                source: result.source,
                modelUsed: modelForUi,
              },
            }).catch(() => undefined);
          }
        }
        setStatus("ready");
        lastResolvedRequestKeyRef.current = resolvedRequestKey;
        // Оверлей «Готовим ваш день» скрывается только когда есть слоган + короткая
        // рекомендация. Для free readyForecast всегда с текстами (иначе бросили бы
        // ошибку выше). Для paid сервер мог отдать только числовой каркас — тогда
        // держим оверлей, пока вторичный эффект не подтянет LLM-тексты (или таймаут).
        if (hasHomeCardTexts(readyForecast) && forecastTextsMatchLocale(readyForecast, getResponseLocale())) {
          completeHomeBootstrap();
        } else {
          holdWarmForTexts();
        }
        setHomeTextsLoading(
          !isDayContentComplete(readyForecast, nextAccessMode) ||
            !forecastTextsMatchLocale(readyForecast, getResponseLocale()),
        );
        logRuntimeEvent("day_content:ready", {
          accessMode: nextAccessMode,
          source: nextAccessMode === "free" ? "global" : "personal",
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        logRuntimeEvent(
          "day_content:error",
          { message: e instanceof Error ? e.message : String(e) },
          "warn",
        );
        const err = toError(e);
        if (staleCache) {
          latestCacheContextRef.current = profileId
            ? {
                userId: profileId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate: resolvedForecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              }
            : null;
          setForecast(staleCache.forecast);
          setSource(staleCache.source);
          setModelUsed(staleCache.modelUsed);
          setError(err);
          setStatus("stale_ready");
          lastResolvedRequestKeyRef.current = resolvedRequestKey;
          completeHomeBootstrap();
          return;
        }
        if (opts?.localeChange && latestForecastRef.current) {
          latestCacheContextRef.current = profileId
            ? {
                userId: profileId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate: resolvedForecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              }
            : null;
          setForecast(latestForecastRef.current);
          setSource(latestSourceRef.current);
          setModelUsed(latestModelUsedRef.current);
          setError(null);
          setStatus("ready");
          setHomeTextsLoading(false);
          lastResolvedRequestKeyRef.current = resolvedRequestKey;
          completeHomeBootstrap();
          logRuntimeEvent(
            "day_content:locale_refresh_failed_kept_current",
            { message: err.message, accessMode: nextAccessMode },
            "warn",
          );
          return;
        }
        setForecast(null);
        setSource(null);
        setModelUsed(null);
        latestCacheContextRef.current = null;
        setError(err);
        setStatus("error");
        setHomeTextsLoading(false);
        completeHomeBootstrap();
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [
      options?.accessModeOverride,
      options?.accessTierOverride,
      options?.birthDataErrorMessage,
      options?.hasNatalProfile,
      options?.locationErrorMessage,
      options?.natalRequired,
      membershipExpiresAt,
      membershipTier,
      profileId,
      profileLoading,
      profileTimezone,
      refreshProfile,
      scopeKey,
      trialExpiresAt,
      userLocation,
      setStartupStep,
      holdWarmForTexts,
    ],
  );

  useEffect(() => {
    if (profileLoading) {
      return;
    }
    void refresh().catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[dayContent] initial refresh", e instanceof Error ? e.message : String(e));
    });
    return () => {
      abortRef.current?.abort();
      secondaryContentAbortRef.current?.abort();
      if (warmTimeoutRef.current) {
        clearTimeout(warmTimeoutRef.current);
        warmTimeoutRef.current = null;
      }
    };
  }, [refresh, profileLoading]);

  useEffect(() => {
    return subscribeAppLocale(() => {
      const nextLocale = getResponseLocale();
      if (nextLocale === trackedContentLocaleRef.current) return;
      trackedContentLocaleRef.current = nextLocale;

      const nextAccessMode =
        options?.accessModeOverride ??
        accessModeFromRow({
          membership_tier: membershipTier,
          trial_expires_at: trialExpiresAt,
          membership_expires_at: membershipExpiresAt,
        });
      const nextAccessTier =
        options?.accessTierOverride ?? (nextAccessMode === "free" ? "free" : "oracle");
      const provisionalTimezone = userLocation?.timezone ?? profileTimezone;
      const provisionalForecastDate = localDateIso(provisionalTimezone);
      const contentScopeKey = buildContentScopeKey(nextAccessMode, scopeKey, nextLocale);

      const applyWarmed = (warmed: {
        forecast: DailyForecast;
        source: DayContentSource;
        modelUsed: string | null;
        userLocation: { lat: number; lng: number; timezone: string };
      }) => {
        if (!profileId || !isDayContentComplete(warmed.forecast, nextAccessMode)) return false;
        if (!forecastTextsMatchLocale(warmed.forecast, nextLocale)) return false;
        pendingMorningMonologueForceRef.current = false;
        lastHydratedForecastKeyRef.current = [
          profileId,
          provisionalForecastDate,
          contentScopeKey,
          warmed.forecast.date,
          warmed.forecast.computedAt,
          nextAccessMode,
        ].join("|");
        lastResolvedRequestKeyRef.current = [
          profileId,
          nextAccessMode,
          nextAccessTier,
          provisionalForecastDate,
          contentScopeKey,
        ].join("|");
        latestCacheContextRef.current = {
          userId: profileId,
          accessMode: nextAccessMode,
          accessTier: nextAccessTier,
          forecastDate: provisionalForecastDate,
          scopeKey: contentScopeKey,
          userLocation: warmed.userLocation,
        };
        setAccessMode(nextAccessMode);
        setForecast(warmed.forecast);
        setSource(warmed.source);
        setModelUsed(warmed.modelUsed);
        setResolvedUserLocation(warmed.userLocation);
        setHomeTextsLoading(false);
        setStatus("ready");
        setError(null);
        completeHomeBootstrap();
        return true;
      };

      // Profile ensure warms dayContentCache before setAppLocale — apply it
      // with the same accessMode/tier overrides Home uses for fetch/cache keys.
      const tryApplyFromCache = async (): Promise<boolean> => {
        const bridged = consumeLocaleDayContentWarm(nextLocale);
        if (
          bridged &&
          bridged.userId === profileId &&
          applyWarmed({
            forecast: bridged.forecast,
            source: bridged.source,
            modelUsed: bridged.modelUsed,
            userLocation: bridged.userLocation,
          })
        ) {
          return true;
        }
        if (profileId && userLocation) {
          const warmed = peekDayContentCache({
            userId: profileId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate: provisionalForecastDate,
            scopeKey: contentScopeKey,
            userLocation,
          });
          if (
            warmed?.freshness === "fresh" &&
            applyWarmed({
              forecast: warmed.forecast,
              source: warmed.source,
              modelUsed: warmed.modelUsed,
              userLocation,
            })
          ) {
            return true;
          }
        }
        if (profileId) {
          const relaxed = peekDayContentCacheRelaxed({
            userId: profileId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate: provisionalForecastDate,
            scopeKey: contentScopeKey,
          });
          if (
            relaxed?.freshness === "fresh" &&
            applyWarmed({
              forecast: relaxed.forecast,
              source: relaxed.source,
              modelUsed: relaxed.modelUsed,
              userLocation: relaxed.location,
            })
          ) {
            return true;
          }
          // Native peek* is memory-only — Profile may have just written SecureStore.
          const asyncRelaxed = await loadDayContentCacheRelaxed({
            userId: profileId,
            accessMode: nextAccessMode,
            accessTier: nextAccessTier,
            forecastDate: provisionalForecastDate,
            scopeKey: contentScopeKey,
          });
          if (
            asyncRelaxed?.freshness === "fresh" &&
            applyWarmed({
              forecast: asyncRelaxed.forecast,
              source: asyncRelaxed.source,
              modelUsed: asyncRelaxed.modelUsed,
              userLocation: asyncRelaxed.location,
            })
          ) {
            return true;
          }
        }
        return false;
      };

      void (async () => {
        if (await tryApplyFromCache()) return;

        // Cache miss after Profile ensure should be rare. Do NOT force a second
        // monologue here — refresh attaches scenario_cache / decides force itself.
        pendingMorningMonologueForceRef.current = false;
        lastHydratedForecastKeyRef.current = null;
        lastResolvedRequestKeyRef.current = null;
        setHomeTextsLoading(true);
        setForecast((current) => {
          const stripped = current ? stripHomeLlmTexts(current) : current;
          latestForecastRef.current = stripped;
          return stripped;
        });
        void refresh({ localeChange: true }).catch(() => undefined);
      })();
    });
  }, [
    completeHomeBootstrap,
    membershipExpiresAt,
    membershipTier,
    options?.accessModeOverride,
    options?.accessTierOverride,
    profileId,
    profileTimezone,
    refresh,
    scopeKey,
    trialExpiresAt,
    userLocation,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const timezone = userLocation?.timezone ?? profileTimezone;
      const localDay = localDateIso(timezone);
      if (localDay !== lastLocalDayRef.current) {
        void refresh().catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [profileTimezone, refresh, userLocation?.timezone]);

  useEffect(() => {
    if (!forecast) return;
    if (status !== "ready" && status !== "stale_ready") return;
    const forecastForHydration: DailyForecast = forecast;
    const forceMorningRefresh = pendingMorningMonologueForceRef.current;
    const localeAtCheck = getResponseLocale();
    const needsSecondaryContent =
      forceMorningRefresh ||
      !isDayContentComplete(forecastForHydration, accessMode) ||
      !forecastTextsMatchLocale(forecastForHydration, localeAtCheck);
    if (!needsSecondaryContent) return;
    const cacheContext = latestCacheContextRef.current;
    if (!cacheContext) return;
    const hydrationKey = [
      cacheContext.userId,
      cacheContext.forecastDate,
      cacheContext.scopeKey,
      forecastForHydration.date,
      forecastForHydration.computedAt,
      accessMode,
    ].join("|");
    if (lastHydratedForecastKeyRef.current === hydrationKey && !forceMorningRefresh) return;
    if (!forceMorningRefresh) {
      lastHydratedForecastKeyRef.current = hydrationKey;
    }

    secondaryContentAbortRef.current?.abort();
    const controller = new AbortController();
    secondaryContentAbortRef.current = controller;
    const runId = ++secondaryRunRef.current;
    const localeAtStart = getResponseLocale();
    const scopeKeyAtStart = cacheContext.scopeKey;
    setHomeTextsLoading(true);

    void (async () => {
      try {
        if (accessMode === "free") {
          setStartupStep("HOME/api_global_free");
          // Poll while Node `after()` / cron warms real LLM texts (non-blocking route).
          const deadline = Date.now() + 120_000;
          let latest = forecastForHydration;
          let latestModel = modelUsed;
          while (Date.now() < deadline) {
            if (controller.signal.aborted || runId !== secondaryRunRef.current) return;
            await new Promise((resolve) => setTimeout(resolve, 4_000));
            if (controller.signal.aborted || runId !== secondaryRunRef.current) return;
            if (getResponseLocale() !== localeAtStart || latestCacheContextRef.current?.scopeKey !== scopeKeyAtStart) {
              return;
            }
            try {
              const polled = await fetchGlobalContent({
                userLocation: cacheContext.userLocation,
                signal: controller.signal,
                responseLocale: localeAtStart,
              });
              if (!isFreeDayContentRenderable(polled.forecast)) continue;
              if (!forecastTextsMatchLocale(polled.forecast, localeAtStart)) continue;
              latest = polled.forecast;
              latestModel = polled.modelUsed ?? latestModel;
              if (isDayContentComplete(polled.forecast, "free")) break;
            } catch {
              /* keep polling until deadline */
            }
          }
          if (controller.signal.aborted || runId !== secondaryRunRef.current) return;
          if (getResponseLocale() !== localeAtStart || latestCacheContextRef.current?.scopeKey !== scopeKeyAtStart) {
            return;
          }
          if (!forecastTextsMatchLocale(latest, localeAtStart)) {
            setHomeTextsLoading(false);
            return;
          }
          setForecast((current) => {
            if (!current) return current;
            if (current.date !== forecastForHydration.date) return current;
            return latest;
          });
          if (latestModel) setModelUsed(latestModel);
          if (forceMorningRefresh) {
            pendingMorningMonologueForceRef.current = false;
            lastHydratedForecastKeyRef.current = hydrationKey;
          }
          setHomeTextsLoading(false);
          releaseWarmIfHeld();
          await saveDayContentCache({
            userId: cacheContext.userId,
            accessMode: cacheContext.accessMode,
            accessTier: cacheContext.accessTier,
            forecastDate: cacheContext.forecastDate,
            scopeKey: cacheContext.scopeKey,
            userLocation: cacheContext.userLocation,
            content: {
              forecast: latest,
              source: "global",
              modelUsed: latestModel,
            },
          });
          return;
        }

        setStartupStep("HOME/api_morning_monologue");
        let enriched = await enrichWithMorningContent(
          forecastForHydration,
          forceMorningRefresh,
          controller.signal,
          localeAtStart,
        );
        if (
          !forecastTextsMatchLocale(enriched.forecast, localeAtStart) &&
          !forceMorningRefresh
        ) {
          enriched = await enrichWithMorningContent(forecastForHydration, true, controller.signal, localeAtStart);
        }
        if (controller.signal.aborted || runId !== secondaryRunRef.current) return;
        if (getResponseLocale() !== localeAtStart || latestCacheContextRef.current?.scopeKey !== scopeKeyAtStart) {
          return;
        }
        if (!forecastTextsMatchLocale(enriched.forecast, localeAtStart)) {
          setHomeTextsLoading(false);
          return;
        }
        if (!isBaseForecastValid(enriched.forecast)) return;
        setForecast((current) => {
          if (!current) return current;
          if (current.date !== forecastForHydration.date || current.computedAt !== forecastForHydration.computedAt) {
            return current;
          }
          return enriched.forecast;
        });
        if (enriched.modelUsed) {
          setModelUsed(enriched.modelUsed);
        }
        if (forceMorningRefresh) {
          pendingMorningMonologueForceRef.current = false;
          lastHydratedForecastKeyRef.current = hydrationKey;
        }
        setHomeTextsLoading(false);
        releaseWarmIfHeld();
        await saveDayContentCache({
          userId: cacheContext.userId,
          accessMode: cacheContext.accessMode,
          accessTier: cacheContext.accessTier,
          forecastDate: cacheContext.forecastDate,
          scopeKey: cacheContext.scopeKey,
          userLocation: cacheContext.userLocation,
          content: {
            forecast: enriched.forecast,
            source: source ?? "computed",
            modelUsed: enriched.modelUsed || modelUsed,
          },
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        if (runId === secondaryRunRef.current) {
          setHomeTextsLoading(false);
        }
        if (forceMorningRefresh) {
          pendingMorningMonologueForceRef.current = false;
        }
        logRuntimeEvent(
          "day_content:secondary_content_error",
          { message: e instanceof Error ? e.message : String(e) },
          "warn",
        );
      } finally {
        if (secondaryContentAbortRef.current === controller) {
          secondaryContentAbortRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
      if (secondaryContentAbortRef.current === controller) {
        secondaryContentAbortRef.current = null;
      }
    };
  }, [accessMode, forecast, modelUsed, setStartupStep, source, status, releaseWarmIfHeld]);

  return {
    forecast,
    accessMode,
    modelUsed,
    source,
    status,
    loading: status === "loading" || status === "acquiring_location",
    error,
    locationIssue,
    userLocation: resolvedUserLocation ?? userLocation,
    refresh,
    homeTextsLoading,
  };
}
