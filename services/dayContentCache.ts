import type { DailyForecast } from "@/modules/daily-engine";
import type { ProductTier } from "@/modules/access/core/tiers";
import type { AccessMode } from "@/services/globalContentClient";
import { isDayContentCacheable } from "@/services/dayContentIntegrity";
import { DateTime } from "luxon";
import { Platform } from "react-native";

export type CachedDayContentSource = "cache" | "computed" | "global";

export interface CachedDayContent {
  forecast: DailyForecast;
  source: CachedDayContentSource;
  modelUsed: string | null;
}

interface UserLocation {
  lat: number;
  lng: number;
  timezone: string;
}

interface DayContentCacheEntry extends CachedDayContent {
  version: 1;
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  location: UserLocation;
  savedAt: string;
  expiresAt: string;
}

interface CacheManifestEntry {
  key: string;
  userId: string;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  expiresAt: string;
}

interface CacheManifest {
  version: 1;
  entries: CacheManifestEntry[];
}

export interface CacheLookupResult extends CachedDayContent {
  freshness: "fresh" | "stale";
}

/** Кэш дня + координаты из записи (для старта без lat/lon в профиле). */
export type RelaxedCacheLookupResult = CacheLookupResult & {
  location: UserLocation;
};

type SecureStoreLike = typeof import("expo-secure-store");

const CACHE_VERSION = 1;
const CACHE_PREFIX = "harmonizer.dayContent.v1";
const MANIFEST_KEY = `${CACHE_PREFIX}.manifest`;
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
/** ~1.1 km. Android Balanced GPS often jitters 20–50 m; 0.0001° (~11 m) was deleting today's cache. */
const LOCATION_EPSILON = 0.01;
const memoryCache = new Map<string, DayContentCacheEntry>();

function safeStorageKey(key: string): string | null {
  const sanitized = key.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || !SECURE_STORE_KEY_RX.test(sanitized)) return null;
  return sanitized;
}

function chunkCountKey(key: string): string {
  return `${key}.chunks`;
}

function chunkKey(key: string, index: number): string {
  return `${key}.chunk.${index}`;
}

function getSecureStore(): SecureStoreLike | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-secure-store") as SecureStoreLike;
  } catch {
    return null;
  }
}

function getWebStorage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

async function getRaw(key: string): Promise<string | null> {
  const safeKey = safeStorageKey(key);
  const SecureStore = getSecureStore();
  if (!safeKey) return null;
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      return webStorage.getItem(safeKey);
    } catch {
      return null;
    }
  }
  if (!SecureStore) return null;

  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(safeKey));
    const count = countRaw ? Number(countRaw) : 0;
    if (!Number.isFinite(count) || count <= 0) return SecureStore.getItemAsync(safeKey);

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(safeKey, index))),
    );
    if (chunks.some((chunk) => chunk == null)) return null;
    return chunks.join("");
  } catch {
    return null;
  }
}

function getRawSync(key: string): string | null {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return null;
  if (memoryCache.has(safeKey)) {
    return JSON.stringify(memoryCache.get(safeKey));
  }
  const webStorage = getWebStorage();
  if (!webStorage) return null;
  try {
    return webStorage.getItem(safeKey);
  } catch {
    return null;
  }
}

async function setRaw(key: string, value: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  const SecureStore = getSecureStore();
  if (!safeKey) return;
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.setItem(safeKey, value);
    } catch {
      /* A cache write must never block the home screen. */
    }
    return;
  }
  if (!SecureStore) return;

  try {
    await removeRaw(safeKey);
    if (value.length <= SECURE_STORE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(safeKey, value);
      return;
    }

    const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, "g")) ?? [];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(safeKey, index), chunk)));
    await SecureStore.setItemAsync(chunkCountKey(safeKey), String(chunks.length));
  } catch {
    /* A cache write must never block the home screen. */
  }
}

async function removeRaw(key: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  const SecureStore = getSecureStore();
  if (!safeKey) return;
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.removeItem(safeKey);
    } catch {
      /* ignore missing/invalid cache keys */
    }
    return;
  }
  if (!SecureStore) return;

  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(safeKey));
    const count = countRaw ? Number(countRaw) : 0;
    const chunkKeys = Number.isFinite(count)
      ? Array.from({ length: Math.max(0, count) }, (_, index) => chunkKey(safeKey, index))
      : [];
    await Promise.all([
      SecureStore.deleteItemAsync(safeKey),
      SecureStore.deleteItemAsync(chunkCountKey(safeKey)),
      ...chunkKeys.map((item) => SecureStore.deleteItemAsync(item)),
    ]);
  } catch {
    /* ignore missing/invalid cache keys */
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function cacheKey(userId: string, accessMode: AccessMode, accessTier: ProductTier, forecastDate: string, scopeKey: string): string {
  return safeStorageKey(`${CACHE_PREFIX}.${userId}.${accessMode}.${accessTier}.${forecastDate}.${scopeKey}`) ?? `${CACHE_PREFIX}.invalid`;
}

function sameLocation(a: UserLocation, b: UserLocation): boolean {
  return (
    a.timezone === b.timezone &&
    Math.abs(a.lat - b.lat) <= LOCATION_EPSILON &&
    Math.abs(a.lng - b.lng) <= LOCATION_EPSILON
  );
}

function entryMatchesLookup(
  entry: DayContentCacheEntry,
  params: {
    userId: string;
    accessMode: AccessMode;
    accessTier: ProductTier;
    forecastDate: string;
    scopeKey: string;
  },
): boolean {
  return (
    entry.version === CACHE_VERSION &&
    entry.userId === params.userId &&
    entry.accessMode === params.accessMode &&
    entry.accessTier === params.accessTier &&
    entry.forecastDate === params.forecastDate &&
    entry.scopeKey === params.scopeKey &&
    isDayContentCacheable(entry.forecast, params.accessMode)
  );
}

function entryToLookupResult(
  entry: DayContentCacheEntry,
  allowStale: boolean | undefined,
): CacheLookupResult | null {
  const freshness = isFresh(entry) ? "fresh" : "stale";
  if (freshness === "stale" && !allowStale) return null;
  return {
    forecast: entry.forecast,
    source: entry.source,
    modelUsed: entry.modelUsed,
    freshness,
  };
}

function isFresh(entry: DayContentCacheEntry, now = Date.now()): boolean {
  return new Date(entry.expiresAt).getTime() > now;
}

function endOfLocalForecastDay(forecastDate: string, timezone: string): string | null {
  return DateTime.fromISO(forecastDate, { zone: timezone }).endOf("day").toUTC().toISO();
}

function earlierIso(a: string, b: string | null): string {
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

async function readManifest(): Promise<CacheManifest> {
  return parseJson<CacheManifest>(await getRaw(MANIFEST_KEY)) ?? { version: CACHE_VERSION, entries: [] };
}

async function writeManifest(manifest: CacheManifest): Promise<void> {
  await setRaw(MANIFEST_KEY, JSON.stringify(manifest));
}

async function rememberKey(entry: CacheManifestEntry): Promise<void> {
  const manifest = await readManifest();
  const entries = manifest.entries.filter((item) => item.key !== entry.key);
  entries.push(entry);
  await writeManifest({ version: CACHE_VERSION, entries });
}

export async function pruneDayContentCache(params: { userId: string; forecastDate: string }): Promise<void> {
  const manifest = await readManifest();
  const now = Date.now();
  const keep: CacheManifestEntry[] = [];

  await Promise.all(
    manifest.entries.map(async (entry) => {
      const expired = new Date(entry.expiresAt).getTime() <= now;
      const otherDayForUser = entry.userId === params.userId && entry.forecastDate !== params.forecastDate;
      const isCurrentUserCurrentDay = entry.userId === params.userId && entry.forecastDate === params.forecastDate;
      if (otherDayForUser || (expired && !isCurrentUserCurrentDay)) {
        memoryCache.delete(entry.key);
        await removeRaw(entry.key);
      } else {
        keep.push(entry);
      }
    }),
  );

  if (keep.length !== manifest.entries.length) {
    await writeManifest({ version: CACHE_VERSION, entries: keep });
  }
}

export async function clearDayContentCache(params: { userId: string; forecastDate?: string }): Promise<void> {
  const manifest = await readManifest();
  const keep: CacheManifestEntry[] = [];

  await Promise.all(
    manifest.entries.map(async (entry) => {
      const matchesUser = entry.userId === params.userId;
      const matchesDate = !params.forecastDate || entry.forecastDate === params.forecastDate;
      if (matchesUser && matchesDate) {
        memoryCache.delete(entry.key);
        await removeRaw(entry.key);
      } else {
        keep.push(entry);
      }
    }),
  );

  if (keep.length !== manifest.entries.length) {
    await writeManifest({ version: CACHE_VERSION, entries: keep });
  }
}

export async function loadDayContentCache(params: {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  userLocation: UserLocation;
  allowStale?: boolean;
}): Promise<CacheLookupResult | null> {
  const key = cacheKey(params.userId, params.accessMode, params.accessTier, params.forecastDate, params.scopeKey);
  const entry = memoryCache.get(key) ?? parseJson<DayContentCacheEntry>(await getRaw(key));
  if (!entry) return null;

  if (!entryMatchesLookup(entry, params)) {
    memoryCache.delete(key);
    await removeRaw(key);
    return null;
  }
  if (!sameLocation(entry.location, params.userLocation)) {
    // GPS jitter / first-fix vs birth coords — keep the day's row for relaxed reads.
    return null;
  }

  memoryCache.set(key, entry);
  return entryToLookupResult(entry, params.allowStale);
}

export async function loadDayContentCacheRelaxed(params: {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  allowStale?: boolean;
}): Promise<RelaxedCacheLookupResult | null> {
  const key = cacheKey(params.userId, params.accessMode, params.accessTier, params.forecastDate, params.scopeKey);
  const entry = memoryCache.get(key) ?? parseJson<DayContentCacheEntry>(await getRaw(key));
  if (!entry || !entryMatchesLookup(entry, params)) return null;

  memoryCache.set(key, entry);
  const lookup = entryToLookupResult(entry, params.allowStale);
  if (!lookup) return null;
  return { ...lookup, location: entry.location };
}

export function peekDayContentCache(params: {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  userLocation: UserLocation;
  allowStale?: boolean;
}): CacheLookupResult | null {
  const key = cacheKey(params.userId, params.accessMode, params.accessTier, params.forecastDate, params.scopeKey);
  const entry = memoryCache.get(key) ?? parseJson<DayContentCacheEntry>(getRawSync(key));
  if (!entry) return null;
  if (!entryMatchesLookup(entry, params) || !sameLocation(entry.location, params.userLocation)) {
    return null;
  }
  return entryToLookupResult(entry, params.allowStale);
}

export function peekDayContentCacheRelaxed(params: {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  allowStale?: boolean;
}): RelaxedCacheLookupResult | null {
  const key = cacheKey(params.userId, params.accessMode, params.accessTier, params.forecastDate, params.scopeKey);
  const entry = memoryCache.get(key) ?? parseJson<DayContentCacheEntry>(getRawSync(key));
  if (!entry || !entryMatchesLookup(entry, params)) return null;
  const lookup = entryToLookupResult(entry, params.allowStale);
  if (!lookup) return null;
  return { ...lookup, location: entry.location };
}

export async function saveDayContentCache(params: {
  userId: string;
  accessMode: AccessMode;
  accessTier: ProductTier;
  forecastDate: string;
  scopeKey: string;
  userLocation: UserLocation;
  content: CachedDayContent;
}): Promise<void> {
  if (!isDayContentCacheable(params.content.forecast, params.accessMode)) return;
  const expiresAt = earlierIso(
    params.content.forecast.cacheValidUntil,
    endOfLocalForecastDay(params.forecastDate, params.userLocation.timezone),
  );
  if (!expiresAt) return;

  const key = cacheKey(params.userId, params.accessMode, params.accessTier, params.forecastDate, params.scopeKey);
  const entry: DayContentCacheEntry = {
    version: CACHE_VERSION,
    userId: params.userId,
    accessMode: params.accessMode,
    accessTier: params.accessTier,
    forecastDate: params.forecastDate,
    scopeKey: params.scopeKey,
    location: params.userLocation,
    savedAt: new Date().toISOString(),
    expiresAt,
    ...params.content,
  };

  memoryCache.set(key, entry);
  await setRaw(key, JSON.stringify(entry));
  await rememberKey({
    key,
    userId: params.userId,
    accessTier: params.accessTier,
    forecastDate: params.forecastDate,
    scopeKey: params.scopeKey,
    expiresAt,
  });
}
