import { Platform } from "react-native";

import type { PracticeLocale } from "@/modules/practices/i18n/practices";
import type { PracticeSummary } from "@/modules/practices/core/types";

type SecureStoreLike = typeof import("expo-secure-store");

type CachedYogaEntry = {
  version: 1;
  locale: PracticeLocale;
  yoga: PracticeSummary[];
  savedAt: string;
};

const CACHE_VERSION = 1;
const CACHE_PREFIX = "harmonizer.practiceCatalog.v1";
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
const memoryCache = new Map<string, PracticeSummary[]>();

function safeStorageKey(key: string): string | null {
  const sanitized = key.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || !SECURE_STORE_KEY_RX.test(sanitized)) return null;
  return sanitized;
}

function cacheKey(locale: PracticeLocale): string {
  return safeStorageKey(`${CACHE_PREFIX}.${locale}`) ?? `${CACHE_PREFIX}.invalid`;
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

  const webStorage = getWebStorage();
  if (webStorage) {
    try {
      webStorage.removeItem(safeKey);
    } catch {
      /* ignore invalid cache keys */
    }
    return;
  }

  const SecureStore = getSecureStore();
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
    /* ignore invalid cache keys */
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
      /* cache write must not block the catalog */
    }
    return;
  }

  const SecureStore = getSecureStore();
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
    /* cache write must not block the catalog */
  }
}

function parseCachedYoga(raw: string | null, locale: PracticeLocale): PracticeSummary[] | null {
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CachedYogaEntry;
    if (entry.version !== CACHE_VERSION || entry.locale !== locale || !Array.isArray(entry.yoga)) return null;
    return entry.yoga;
  } catch {
    return null;
  }
}

export function peekCachedYogaPractices(locale: PracticeLocale): PracticeSummary[] | null {
  return memoryCache.get(cacheKey(locale)) ?? null;
}

export async function loadCachedYogaPractices(locale: PracticeLocale): Promise<PracticeSummary[] | null> {
  const key = cacheKey(locale);
  const fromMemory = memoryCache.get(key);
  if (fromMemory) return fromMemory;

  const yoga = parseCachedYoga(await getRaw(key), locale);
  if (yoga) memoryCache.set(key, yoga);
  return yoga;
}

export async function saveCachedYogaPractices(locale: PracticeLocale, yoga: PracticeSummary[]): Promise<void> {
  const key = cacheKey(locale);
  memoryCache.set(key, yoga);
  const entry: CachedYogaEntry = {
    version: CACHE_VERSION,
    locale,
    yoga,
    savedAt: new Date().toISOString(),
  };
  await setRaw(key, JSON.stringify(entry));
}
