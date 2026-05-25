import { Platform } from "react-native";

type SecureStoreLike = typeof import("expo-secure-store");

export type CachedDialogMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  meta?: Record<string, unknown>;
};

type CachedDialogSession = {
  version: 1;
  userId: string;
  useCase: string;
  entrySource: string;
  localDate: string;
  conversationId: string | null;
  savedAt: string;
  messages: CachedDialogMessage[];
};

const CACHE_VERSION = 1;
const CACHE_PREFIX = "harmonizer.dialog.session";
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;

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
  if (!safeKey) return null;

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

async function setRaw(key: string, value: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return;

  const SecureStore = getSecureStore();
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.setItem(safeKey, value);
    } catch {
      /* ignore storage quota issues */
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
    /* ignore storage quota issues */
  }
}

async function removeRaw(key: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  if (!safeKey) return;

  const SecureStore = getSecureStore();
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.removeItem(safeKey);
    } catch {
      /* ignore missing keys */
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
    /* ignore missing keys */
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

function localDateKey(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(new Date());
  }
}

function cacheKey(userId: string, useCase: string, entrySource: string): string {
  return `${CACHE_PREFIX}.${userId}.${useCase}.${entrySource}`;
}

export async function loadDialogSessionCache(params: {
  userId: string;
  useCase: string;
  entrySource: string;
  timeZone: string;
}): Promise<CachedDialogSession | null> {
  const localDate = localDateKey(params.timeZone);
  const raw = await getRaw(cacheKey(params.userId, params.useCase, params.entrySource));
  const parsed = parseJson<CachedDialogSession>(raw);
  if (!parsed) return null;
  if (
    parsed.version !== CACHE_VERSION
    || parsed.userId !== params.userId
    || parsed.useCase !== params.useCase
    || parsed.entrySource !== params.entrySource
    || parsed.localDate !== localDate
    || !Array.isArray(parsed.messages)
  ) {
    return null;
  }
  return parsed;
}

export async function saveDialogSessionCache(params: {
  userId: string;
  useCase: string;
  entrySource: string;
  timeZone: string;
  conversationId: string | null;
  messages: CachedDialogMessage[];
}): Promise<void> {
  const localDate = localDateKey(params.timeZone);
  const payload: CachedDialogSession = {
    version: CACHE_VERSION,
    userId: params.userId,
    useCase: params.useCase,
    entrySource: params.entrySource,
    localDate,
    conversationId: params.conversationId,
    savedAt: new Date().toISOString(),
    messages: params.messages.slice(-40),
  };
  await setRaw(
    cacheKey(params.userId, params.useCase, params.entrySource),
    JSON.stringify(payload),
  );
}

export async function clearDialogSessionCache(params: {
  userId: string;
  useCase: string;
  entrySource: string;
  timeZone: string;
}): Promise<void> {
  void params.timeZone;
  await removeRaw(cacheKey(params.userId, params.useCase, params.entrySource));
}
