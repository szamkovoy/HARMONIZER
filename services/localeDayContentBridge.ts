import type { ProductTier } from "@/modules/access";
import type { DailyForecast } from "@/modules/daily-engine";
import type { AppLocale } from "@/modules/i18n";
import type { AccessMode } from "@/services/globalContentClient";
import type { CachedDayContentSource } from "@/services/dayContentCache";

export type LocaleDayContentWarmPayload = {
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
};

/**
 * In-memory handoff: Profile ensure publishes a complete day payload right
 * before `setAppLocale`. Home `subscribeAppLocale` consumes it first so the
 * Navigator paints slogan/recommendation immediately (no strip → secondary
 * monologue flash) even if sync SecureStore peek misses.
 */
let pendingWarm: LocaleDayContentWarmPayload | null = null;

export function publishLocaleDayContentWarm(payload: LocaleDayContentWarmPayload): void {
  pendingWarm = payload;
}

export function consumeLocaleDayContentWarm(locale: AppLocale): LocaleDayContentWarmPayload | null {
  if (!pendingWarm || pendingWarm.locale !== locale) return null;
  const next = pendingWarm;
  pendingWarm = null;
  return next;
}

export function peekLocaleDayContentWarm(locale: AppLocale): LocaleDayContentWarmPayload | null {
  if (!pendingWarm || pendingWarm.locale !== locale) return null;
  return pendingWarm;
}
