import { Platform } from "react-native";

import type { AppLocale } from "@/modules/i18n";
import type { DayPlan } from "@/services/dayPlan";

type SecureStoreLike = typeof import("expo-secure-store");

type CachedDayPlan = {
  version: 1;
  userId: string;
  locale: AppLocale;
  plan: DayPlan;
  savedAt: string;
};

const CACHE_VERSION = 1;
const CACHE_PREFIX = "harmonizer.dayPlan.v1";
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
const memoryCache = new Map<string, CachedDayPlan>();

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

function cacheKey(userId: string, locale: AppLocale): string {
  return safeStorageKey(`${CACHE_PREFIX}.${userId}.${locale}`) ?? `${CACHE_PREFIX}.invalid`;
}

function localDateKey(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return null;
  }
}

function isCacheUsable(entry: CachedDayPlan | null, userId: string, locale: AppLocale): entry is CachedDayPlan {
  if (!entry) return false;
  if (entry.version !== CACHE_VERSION || entry.userId !== userId || entry.locale !== locale) return false;
  const currentLocalDate = localDateKey(entry.plan.timezone);
  return Boolean(currentLocalDate && currentLocalDate === entry.plan.currentLocalDate);
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getRawSync(key: string): string | null {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return null;
  const fromMemory = memoryCache.get(safeKey);
  if (fromMemory) return JSON.stringify(fromMemory);
  const webStorage = getWebStorage();
  if (!webStorage) return null;
  try {
    return webStorage.getItem(safeKey);
  } catch {
    return null;
  }
}

async function getRaw(key: string): Promise<string | null> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return null;

  const fromMemory = memoryCache.get(safeKey);
  if (fromMemory) return JSON.stringify(fromMemory);

  const SecureStore = getSecureStore();
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

async function removeRaw(key: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return;
  memoryCache.delete(safeKey);

  const SecureStore = getSecureStore();
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.removeItem(safeKey);
    } catch {
      /* ignore */
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
    /* ignore */
  }
}

async function setRaw(key: string, value: string, entry: CachedDayPlan): Promise<void> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return;
  memoryCache.set(safeKey, entry);

  const SecureStore = getSecureStore();
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.setItem(safeKey, value);
    } catch {
      /* ignore */
    }
    return;
  }
  if (!SecureStore) return;

  try {
    await removeRaw(safeKey);
    memoryCache.set(safeKey, entry);
    if (value.length <= SECURE_STORE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(safeKey, value);
      return;
    }
    const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, "g")) ?? [];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(safeKey, index), chunk)));
    await SecureStore.setItemAsync(chunkCountKey(safeKey), String(chunks.length));
  } catch {
    /* ignore */
  }
}

export function peekCachedDayPlan(params: { userId: string; locale: AppLocale }): DayPlan | null {
  const raw = getRawSync(cacheKey(params.userId, params.locale));
  const parsed = parseJson<CachedDayPlan>(raw);
  return isCacheUsable(parsed, params.userId, params.locale) ? parsed.plan : null;
}

export async function loadCachedDayPlan(params: { userId: string; locale: AppLocale }): Promise<DayPlan | null> {
  const raw = await getRaw(cacheKey(params.userId, params.locale));
  const parsed = parseJson<CachedDayPlan>(raw);
  if (isCacheUsable(parsed, params.userId, params.locale)) {
    memoryCache.set(cacheKey(params.userId, params.locale), parsed);
    return parsed.plan;
  }
  return null;
}

export async function saveCachedDayPlan(params: {
  userId: string;
  locale: AppLocale;
  plan: DayPlan;
}): Promise<void> {
  const entry: CachedDayPlan = {
    version: CACHE_VERSION,
    userId: params.userId,
    locale: params.locale,
    plan: params.plan,
    savedAt: new Date().toISOString(),
  };
  await setRaw(cacheKey(params.userId, params.locale), JSON.stringify(entry), entry);
}

export async function clearCachedDayPlan(params: { userId: string; locale: AppLocale }): Promise<void> {
  await removeRaw(cacheKey(params.userId, params.locale));
}
