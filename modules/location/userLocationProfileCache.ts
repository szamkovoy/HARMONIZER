import { Platform } from "react-native";

import type { UserLocationCoords } from "@/modules/location/acquireAndPersistUserCoordinates";

type SecureStoreLike = typeof import("expo-secure-store");

interface UserLocationCacheEntry {
  version: 1;
  userId: string;
  lat: number;
  lng: number;
  timezone: string;
  savedAt: string;
}

const CACHE_VERSION = 1;
const CACHE_PREFIX = "harmonizer.userLocation.v1";
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
const memoryCache = new Map<string, UserLocationCoords>();

function safeStorageKey(key: string): string | null {
  const sanitized = key.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || !SECURE_STORE_KEY_RX.test(sanitized)) return null;
  return sanitized;
}

function cacheKey(userId: string): string {
  return safeStorageKey(`${CACHE_PREFIX}.${userId}`) ?? `${CACHE_PREFIX}.invalid`;
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
  if (!safeKey) return null;
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      return webStorage.getItem(safeKey);
    } catch {
      return null;
    }
  }
  const SecureStore = getSecureStore();
  if (!SecureStore) return null;
  try {
    return await SecureStore.getItemAsync(safeKey);
  } catch {
    return null;
  }
}

async function setRaw(key: string, value: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return;
  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      webStorage.setItem(safeKey, value);
    } catch {
      /* ignore */
    }
    return;
  }
  const SecureStore = getSecureStore();
  if (!SecureStore) return;
  try {
    await SecureStore.setItemAsync(safeKey, value);
  } catch {
    /* ignore */
  }
}

function parseEntry(raw: string | null, userId: string): UserLocationCoords | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as UserLocationCacheEntry;
    if (
      entry.version !== CACHE_VERSION ||
      entry.userId !== userId ||
      typeof entry.lat !== "number" ||
      typeof entry.lng !== "number" ||
      !entry.timezone?.trim()
    ) {
      return null;
    }
    return { lat: entry.lat, lng: entry.lng, timezone: entry.timezone };
  } catch {
    return null;
  }
}

export async function loadCachedUserCoords(userId: string): Promise<UserLocationCoords | null> {
  const key = cacheKey(userId);
  const fromMemory = memoryCache.get(key);
  if (fromMemory) return fromMemory;
  const coords = parseEntry(await getRaw(key), userId);
  if (coords) memoryCache.set(key, coords);
  return coords;
}

export async function saveCachedUserCoords(userId: string, coords: UserLocationCoords): Promise<void> {
  const key = cacheKey(userId);
  memoryCache.set(key, coords);
  const entry: UserLocationCacheEntry = {
    version: CACHE_VERSION,
    userId,
    lat: coords.lat,
    lng: coords.lng,
    timezone: coords.timezone,
    savedAt: new Date().toISOString(),
  };
  await setRaw(key, JSON.stringify(entry));
}
