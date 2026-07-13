import type { ProductTier } from "@/modules/access";
import type { AppLocale } from "@/modules/i18n";
import type { AccessMode } from "@/services/globalContentClient";
import { peekDayContentCache, peekDayContentCacheRelaxed } from "@/services/dayContentCache";
import { isDayContentComplete } from "@/services/dayContentIntegrity";
import { dayTextsMatchLocale } from "@/services/dayContentLocaleGuard";
import { getSupabase } from "@/services/supabase";

export type LocaleDayContentProbeInput = {
  userId: string;
  locale: AppLocale;
  accessMode: AccessMode;
  accessTier: ProductTier;
  timezone: string;
  birthDate?: string | null;
  birthTime?: string | null;
  birthPlace?: unknown;
  lat?: number | null;
  lon?: number | null;
};

export type LocaleDayContentProbeResult = {
  ready: boolean;
  accessMode: AccessMode;
  forecastDate: string;
  scopeKey: string;
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

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function morningCacheKey(userId: string, forecastDate: string, locale: AppLocale): string {
  return `morning_recommendation:${userId}:${forecastDate}:${locale}`;
}

async function probeFreeServerReady(forecastDate: string, locale: AppLocale): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("global_daily_content")
    .select("slogan,short_text,long_explanation,llm_model,text_i18n")
    .eq("forecast_date_utc", forecastDate)
    .maybeSingle();
  if (error || !data) return false;
  if (!hasText(data.llm_model)) return false;
  if (locale === "ru") {
    return hasText(data.slogan) && hasText(data.short_text) && hasText(data.long_explanation);
  }
  const map = data.text_i18n as Record<string, { slogan?: string; short_text?: string; long_explanation?: string }> | null;
  const localized = map?.[locale];
  if (!localized?.slogan?.trim() || !localized?.short_text?.trim() || !localized?.long_explanation?.trim()) {
    return false;
  }
  return dayTextsMatchLocale(locale, localized.slogan, localized.short_text);
}

async function probePaidServerReady(userId: string, forecastDate: string, locale: AppLocale): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("scenario_cache")
    .select("data")
    .eq("cache_key", morningCacheKey(userId, forecastDate, locale))
    .maybeSingle();
  if (error || !data) return false;
  const cached = data.data as Record<string, unknown> | null;
  if (!cached) return false;
  if (cached.outputLocale !== locale) return false;
  if (
    !(
      hasText(cached.slogan) &&
      hasText(cached.short_text) &&
      hasText(cached.long_explanation) &&
      typeof cached.math_level === "object" &&
      cached.math_level != null
    )
  ) {
    return false;
  }
  return dayTextsMatchLocale(locale, String(cached.slogan), String(cached.short_text));
}

/**
 * Returns whether day recommendation texts for `locale` are already available
 * (client day-cache or server global/scenario_cache) without regenerating.
 */
export async function probeLocaleDayContentReady(
  input: LocaleDayContentProbeInput,
): Promise<LocaleDayContentProbeResult> {
  const accessMode = input.accessMode;
  const timezone = input.timezone?.trim() || "UTC";
  const forecastDate = localDateIso(timezone);
  const scopeKey = contentScopeKey(
    accessMode,
    natalScopeKey({
      birthDate: input.birthDate,
      birthTime: input.birthTime,
      birthPlace: input.birthPlace,
    }),
    input.locale,
  );

  if (typeof input.lat === "number" && typeof input.lon === "number") {
    const cached = peekDayContentCache({
      userId: input.userId,
      accessMode,
      accessTier: input.accessTier,
      forecastDate,
      scopeKey,
      userLocation: { lat: input.lat, lng: input.lon, timezone },
    });
    if (cached?.freshness === "fresh" && isDayContentComplete(cached.forecast, accessMode)) {
      const slogan = String(cached.forecast.slogan ?? "");
      const shortText = String(cached.forecast.recommendationShortText ?? "");
      if (dayTextsMatchLocale(input.locale, slogan, shortText)) {
        return { ready: true, accessMode, forecastDate, scopeKey };
      }
    }
  }

  const ready =
    accessMode === "free"
      ? await probeFreeServerReady(forecastDate, input.locale)
      : await probePaidServerReady(input.userId, forecastDate, input.locale);

  return { ready, accessMode, forecastDate, scopeKey };
}

/**
 * Sync peek of a complete, locale-matching dayContentCache entry (strict location
 * first, then relaxed). Used by Profile before commitLocale and by Home on locale switch.
 */
export function peekLocaleDayContentComplete(
  input: LocaleDayContentProbeInput,
): { forecastDate: string; scopeKey: string } | null {
  const accessMode = input.accessMode;
  const timezone = input.timezone?.trim() || "UTC";
  const forecastDate = localDateIso(timezone);
  const scopeKey = contentScopeKey(
    accessMode,
    natalScopeKey({
      birthDate: input.birthDate,
      birthTime: input.birthTime,
      birthPlace: input.birthPlace,
    }),
    input.locale,
  );

  const matches = (forecast: import("@/modules/daily-engine").DailyForecast) => {
    if (!isDayContentComplete(forecast, accessMode)) return false;
    return dayTextsMatchLocale(
      input.locale,
      String(forecast.slogan ?? ""),
      String(forecast.recommendationShortText ?? ""),
    );
  };

  if (typeof input.lat === "number" && typeof input.lon === "number") {
    const strict = peekDayContentCache({
      userId: input.userId,
      accessMode,
      accessTier: input.accessTier,
      forecastDate,
      scopeKey,
      userLocation: { lat: input.lat, lng: input.lon, timezone },
    });
    if (strict?.freshness === "fresh" && matches(strict.forecast)) {
      return { forecastDate, scopeKey };
    }
  }

  const relaxed = peekDayContentCacheRelaxed({
    userId: input.userId,
    accessMode,
    accessTier: input.accessTier,
    forecastDate,
    scopeKey,
  });
  if (relaxed?.freshness === "fresh" && matches(relaxed.forecast)) {
    return { forecastDate, scopeKey };
  }
  return null;
}
