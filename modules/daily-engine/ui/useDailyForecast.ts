import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/modules/auth";
import type { DailyForecast } from "@/modules/daily-engine";
import { fetchDailyForecast, type DailyForecastResult } from "@/services/dailyForecastClient";

type DailyForecastStatus = "idle" | "loading" | "ready" | "error" | "missing_location";

export interface UseDailyForecastResult {
  forecast: DailyForecast | null;
  source: DailyForecastResult["source"] | null;
  status: DailyForecastStatus;
  loading: boolean;
  error: Error | null;
  refresh: (opts?: { forceRefresh?: boolean }) => Promise<void>;
}

interface UseDailyForecastOptions {
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

function locationError(message?: string): Error {
  return new Error(message ?? "Location is required to compute opportunity windows.");
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
    try {
      return new Error(JSON.stringify(value));
    } catch {
      return new Error("Unknown daily forecast error");
    }
  }
  return new Error("Unknown daily forecast error");
}

export function useDailyForecast(options?: UseDailyForecastOptions): UseDailyForecastResult {
  const { profile } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  const [forecast, setForecast] = useState<DailyForecast | null>(null);
  const [source, setSource] = useState<DailyForecastResult["source"] | null>(null);
  const [status, setStatus] = useState<DailyForecastStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const userLocation = useMemo(() => {
    if (typeof profile?.lat !== "number" || typeof profile?.lon !== "number") return null;
    return {
      lat: profile.lat,
      lng: profile.lon,
      timezone: profile.tz || "UTC",
    };
  }, [profile?.lat, profile?.lon, profile?.tz]);

  const refresh = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
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
        const result = await fetchDailyForecast({
          forecastDate: localDateIso(userLocation.timezone),
          userLocation,
          forceRefresh: opts?.forceRefresh,
          signal: controller.signal,
        });
        setForecast(result.forecast);
        setSource(result.source);
        setStatus("ready");
      } catch (e) {
        if (controller.signal.aborted) return;
        const err = toError(e);
        setError(err);
        setStatus("error");
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [options?.locationErrorMessage, userLocation],
  );

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return {
    forecast,
    source,
    status,
    loading: status === "loading",
    error,
    refresh,
  };
}
