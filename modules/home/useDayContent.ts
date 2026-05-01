import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/modules/auth";
import type { DailyForecast } from "@/modules/daily-engine";
import { callMonologue, type MorningRecommendationResponse } from "@/services/aiClient";
import { fetchDailyForecast, type DailyForecastResult } from "@/services/dailyForecastClient";
import { fetchGlobalContent, type AccessMode } from "@/services/globalContentClient";

type DayContentStatus = "idle" | "loading" | "ready" | "error" | "missing_location";
type DayContentSource = DailyForecastResult["source"] | "global";

export interface UseDayContentResult {
  forecast: DailyForecast | null;
  accessMode: AccessMode;
  source: DayContentSource | null;
  status: DayContentStatus;
  loading: boolean;
  error: Error | null;
  refresh: (opts?: { forceRefresh?: boolean; accessModeOverride?: AccessMode }) => Promise<void>;
}

interface UseDayContentOptions {
  locationErrorMessage?: string;
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

function withCause(message: string, cause: unknown): Error {
  const root = toError(cause);
  return new Error(`${message}: ${root.message}`);
}

function locationError(message?: string): Error {
  return new Error(message ?? "Location is required to compute opportunity windows.");
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

async function enrichWithMorningContent(
  forecast: DailyForecast,
  forceRefresh: boolean | undefined,
  signal: AbortSignal,
): Promise<DailyForecast> {
  try {
    const content = await callMonologue<MorningRecommendationResponse>(
      "morning_recommendation",
      { forceRefresh: Boolean(forceRefresh) },
      signal,
    );
    if (content.error) throw new Error(content.error);
    return Object.assign(forecast, {
      recommendationShortText: content.short_text?.trim() || forecast.recommendationShortText,
      recommendationLongText: content.long_explanation?.trim() || forecast.recommendationLongText,
      slogan: content.slogan?.trim() || forecast.slogan,
      mathLevel: content.math_level ?? forecast.mathLevel,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn("[Home] Failed to load morning recommendation monologue", error);
    throw withCause(
      "Не удалось загрузить персональную рекомендацию дня. Проверьте EXPO_PUBLIC_COMMUNICATOR_API_URL и деплой Vercel API",
      error,
    );
  }
}

export function useDayContent(options?: UseDayContentOptions): UseDayContentResult {
  const { profile } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  const [forecast, setForecast] = useState<DailyForecast | null>(null);
  const [source, setSource] = useState<DayContentSource | null>(null);
  const [status, setStatus] = useState<DayContentStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>("free");

  const userLocation = useMemo(() => {
    if (typeof profile?.lat !== "number" || typeof profile?.lon !== "number") return null;
    return {
      lat: profile.lat,
      lng: profile.lon,
      timezone: profile.tz || "UTC",
    };
  }, [profile?.lat, profile?.lon, profile?.tz]);

  const refresh = useCallback(
    async (opts?: { forceRefresh?: boolean; accessModeOverride?: AccessMode }) => {
      abortRef.current?.abort();
      setError(null);

      if (!userLocation) {
        const err = locationError(options?.locationErrorMessage);
        setForecast(null);
        setSource(null);
        setStatus("missing_location");
        setError(err);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("loading");

      try {
        const nextAccessMode = opts?.accessModeOverride ?? accessModeFor(profile);
        setAccessMode(nextAccessMode);

        if (nextAccessMode === "free") {
          const result = await fetchGlobalContent({
            userLocation,
            signal: controller.signal,
          });
          setForecast(result.forecast);
          setSource("global");
          setAccessMode(result.accessMode);
        } else {
          const result = await fetchDailyForecast({
            forecastDate: localDateIso(userLocation.timezone),
            userLocation,
            forceRefresh: opts?.forceRefresh,
            signal: controller.signal,
          });
          const forecastWithContent = await enrichWithMorningContent(result.forecast, opts?.forceRefresh, controller.signal);
          setForecast(forecastWithContent);
          setSource(result.source);
        }
        setStatus("ready");
      } catch (e) {
        if (controller.signal.aborted) return;
        setForecast(null);
        setSource(null);
        setError(toError(e));
        setStatus("error");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [options?.locationErrorMessage, profile, userLocation],
  );

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return {
    forecast,
    accessMode,
    source,
    status,
    loading: status === "loading",
    error,
    refresh,
  };
}
