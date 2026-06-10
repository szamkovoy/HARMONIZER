import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/modules/auth";
import { useAppStartup } from "@/modules/bootstrap/AppStartupProvider";
import type { DailyForecast } from "@/modules/daily-engine";
import type { ProductTier } from "@/modules/access/core/tiers";
import { callMonologue, type MorningRecommendationResponse } from "@/services/aiClient";
import { getAiGlobalContentUrl, getDailyForecastUrl } from "@/services/communicatorConfig";
import { fetchDailyForecast, type DailyForecastResult } from "@/services/dailyForecastClient";
import { clearDayContentCache, loadDayContentCache, loadDayContentCacheRelaxed, peekDayContentCache, peekDayContentCacheRelaxed, pruneDayContentCache, saveDayContentCache } from "@/services/dayContentCache";
import { isBaseForecastValid, isDayContentComplete, isDayContentReadyForHome } from "@/services/dayContentIntegrity";
import { acquireAndPersistUserCoordinates, type LocationAcquireFailureReason } from "@/modules/location/acquireAndPersistUserCoordinates";
import { fetchGlobalContent, type AccessMode } from "@/services/globalContentClient";
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

async function enrichWithMorningContent(
  forecast: DailyForecast,
  forceRefresh: boolean | undefined,
  signal: AbortSignal,
): Promise<{ forecast: DailyForecast; modelUsed: string | null }> {
  const content = await callMonologue<MorningRecommendationResponse>(
    "morning_recommendation",
    { forceRefresh: Boolean(forceRefresh) },
    signal,
  );
  if (content.error) throw new Error(content.error);
  return {
    forecast: Object.assign(forecast, {
      recommendationShortText: content.short_text?.trim() || forecast.recommendationShortText,
      recommendationLongText: content.long_explanation?.trim() || forecast.recommendationLongText,
      slogan: content.slogan?.trim() || forecast.slogan,
      mathLevel: content.math_level ?? forecast.mathLevel,
    }),
    modelUsed: content.modelUsed?.trim() || null,
  };
}

function hasPremiumAccess(profile: { membership_tier?: string | null; trial_expires_at?: string | null } | null): boolean {
  if (profile?.membership_tier === "premium") return true;
  if (profile?.membership_tier === "free" && profile.trial_expires_at) {
    return new Date(profile.trial_expires_at).getTime() > Date.now();
  }
  return false;
}

function accessModeFor(profile: { membership_tier?: string | null; trial_expires_at?: string | null } | null): AccessMode {
  if (profile?.membership_tier === "premium") return "premium";
  return hasPremiumAccess(profile) ? "trial" : "free";
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

  const [forecast, setForecast] = useState<DailyForecast | null>(null);
  const [source, setSource] = useState<DayContentSource | null>(null);
  const [status, setStatus] = useState<DayContentStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [locationIssue, setLocationIssue] = useState<LocationAcquireFailureReason | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>("free");
  const [modelUsed, setModelUsed] = useState<string | null>(null);

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

      if (profileLoading) {
        beginHomeBootstrap("initializing", "AUTH/wait_profile_refresh");
        return;
      }

      const nextAccessMode =
        opts?.accessModeOverride ??
        options?.accessModeOverride ??
        accessModeFor({ membership_tier: membershipTier, trial_expires_at: trialExpiresAt });
      const nextAccessTier =
        opts?.accessTierOverride ??
        options?.accessTierOverride ??
        (nextAccessMode === "free" ? "free" : "oracle");
      const needsNatalProfile = Boolean(options?.natalRequired && nextAccessMode !== "free");
      const provisionalTimezone = userLocation?.timezone ?? profileTimezone;
      const provisionalForecastDate = localDateIso(provisionalTimezone);
      const contentScopeKey = nextAccessMode === "free" ? "global" : scopeKey;
      const requestKey = [profileId ?? "anon", nextAccessMode, nextAccessTier, provisionalForecastDate, contentScopeKey].join("|");
      const relaxedInstant =
        !opts?.forceRefresh && profileId
          ? peekDayContentCacheRelaxed({
              userId: profileId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate: provisionalForecastDate,
              scopeKey: contentScopeKey,
              allowStale: true,
            })
          : null;
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
          : relaxedInstant?.freshness === "fresh"
            ? relaxedInstant
            : null;
      const hasPaintableOfflineCache = relaxedInstant?.freshness === "stale";
      const shouldBlockSplash =
        Boolean(opts?.blockingReload) ||
        (!opts?.forceRefresh &&
          (lastResolvedRequestKeyRef.current !== requestKey || !forecast) &&
          !(instantCached && instantCached.freshness === "fresh") &&
          !hasPaintableOfflineCache);

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
        latestCacheContextRef.current = null;
        setStatus("need_birth_data");
        setError(err);
        completeHomeBootstrap();
        return;
      }

      let locationForRequest = userLocation;
      const offlineStaleCache = relaxedInstant?.freshness === "stale" ? relaxedInstant : null;
      if (!locationForRequest && relaxedInstant?.freshness === "fresh") {
        locationForRequest = relaxedInstant.location;
      }

      let acquireFailure: LocationAcquireFailureReason | null = null;
      if (!locationForRequest && profileId) {
        setHomeBootstrapPhase("initializing", "HOME/gps_acquire_persist");
        setStatus("acquiring_location");
        logRuntimeEvent("day_content:auto_location_attempt", { profileId }, "info");
        const acquired = await acquireAndPersistUserCoordinates(profileId);
        if (acquired.ok) {
          await refreshProfile();
          locationForRequest = acquired.coords;
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
        latestCacheContextRef.current = null;
        setStatus("need_location");
        setError(err);
        if (acquireFailure) {
          setLocationIssue(acquireFailure);
        }
        completeHomeBootstrap();
        return;
      }

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
        latestCacheContextRef.current = {
          userId: profileId!,
          accessMode: nextAccessMode,
          accessTier: nextAccessTier,
          forecastDate: localDateIso(locationForRequest.timezone),
          scopeKey: contentScopeKey,
          userLocation: locationForRequest,
        };
        setAccessMode(nextAccessMode);
        setForecast(resolvedInstantCache.forecast);
        setSource(resolvedInstantCache.source);
        setModelUsed(resolvedInstantCache.modelUsed);
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
              latestCacheContextRef.current = {
                userId,
                accessMode: nextAccessMode,
                accessTier: nextAccessTier,
                forecastDate,
                scopeKey: contentScopeKey,
                userLocation: locationForRequest,
              };
              setForecast(cached.forecast);
              setSource(cached.source);
              setModelUsed(cached.modelUsed);
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
          });
          if (!isDayContentComplete(result.forecast, "free")) {
            throw new Error("Global day content is incomplete.");
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
          setForecast(result.forecast);
          setSource("global");
          setModelUsed(result.modelUsed);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log("[dayContent] modelUsed", result.modelUsed ?? "unknown");
          }
          setAccessMode(result.accessMode);
          if (userId) {
            void saveDayContentCache({
              userId,
              accessMode: nextAccessMode,
              accessTier: nextAccessTier,
              forecastDate,
              scopeKey: contentScopeKey,
              userLocation: locationForRequest,
              content: {
                forecast: result.forecast,
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
            signal: controller.signal,
          });
          let forecastForUi = result.forecast;
          let modelForUi = result.modelUsed;
          if (!isDayContentReadyForHome(forecastForUi, nextAccessMode)) {
            throw new Error("Personal day content is incomplete.");
          }
          if ((opts?.forceRefresh || opts?.blockingReload) && userId) {
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
          setSource(result.source);
          setModelUsed(modelForUi);
          if (__DEV__) {
            // eslint-disable-next-line no-console
            console.log("[dayContent] modelUsed", modelForUi ?? "unknown");
          }
          if (userId) {
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
        completeHomeBootstrap();
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
        setForecast(null);
        setSource(null);
        setModelUsed(null);
        latestCacheContextRef.current = null;
        setError(err);
        setStatus("error");
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
      membershipTier,
      profileId,
      profileLoading,
      profileTimezone,
      refreshProfile,
      scopeKey,
      trialExpiresAt,
      userLocation,
      setStartupStep,
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
    };
  }, [refresh, profileLoading]);

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
    if (!forecast || accessMode === "free") return;
    if (status !== "ready" && status !== "stale_ready") return;
    const forecastForHydration: DailyForecast = forecast;
    const forceMorningRefresh = pendingMorningMonologueForceRef.current;
    const needsSecondaryContent =
      forceMorningRefresh ||
      !forecastForHydration.slogan?.trim() ||
      !forecastForHydration.recommendationShortText?.trim() ||
      !forecastForHydration.recommendationLongText?.trim() ||
      !forecastForHydration.mathLevel?.markdown?.trim();
    if (!needsSecondaryContent) return;
    const cacheContext = latestCacheContextRef.current;
    if (!cacheContext) return;
    const hydrationKey = [
      cacheContext.userId,
      cacheContext.forecastDate,
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

    void (async () => {
      try {
        setStartupStep("HOME/api_morning_monologue");
        const enriched = await enrichWithMorningContent(forecastForHydration, forceMorningRefresh, controller.signal);
        if (controller.signal.aborted || !isBaseForecastValid(enriched.forecast)) return;
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
  }, [accessMode, forecast, modelUsed, setStartupStep, source, status]);

  return {
    forecast,
    accessMode,
    modelUsed,
    source,
    status,
    loading: status === "loading" || status === "acquiring_location",
    error,
    locationIssue,
    userLocation,
    refresh,
  };
}
