import { ZODIAC_SIGNS, type BirthData, type NatalProfile } from "@/modules/astro-core";
import { getAstroNatalUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";
import { wrapConnectivityFailure } from "@/services/userFacingErrors";
import { withTransientNetworkRetry } from "@/services/withTransientNetworkRetry";
import { Platform } from "react-native";

export interface CreateNatalProfileResult {
  natalChart?: unknown;
  profile: NatalProfile;
}

type NatalChartRow = {
  precision_mode: NatalProfile["precisionMode"];
  is_day_chart: boolean;
  ascendant_longitude: number | null;
  house_system: NatalProfile["houseSystem"];
  planets: NatalProfile["planets"];
  computed_at: string;
  ephemeris_lib_version: string | null;
};

interface NatalProfileCacheEntry {
  version: 1;
  userId: string;
  profile: NatalProfile | null;
  birthFingerprint: string | null;
  savedAt: string;
}

type SecureStoreLike = typeof import("expo-secure-store");

const NATAL_PROFILE_TIMEOUT_MS = 10_000;
const NATAL_PROFILE_SAVE_TIMEOUT_MS = 30_000;
const NATAL_PROFILE_CACHE_VERSION = 1;
const NATAL_PROFILE_CACHE_PREFIX = "harmonizer.natalProfile.v1";
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
const natalProfileMemoryCache = new Map<string, NatalProfileCacheEntry>();
const natalProfileRefreshes = new Map<string, Promise<NatalProfile | null>>();

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

function cacheKey(userId: string): string {
  return safeStorageKey(`${NATAL_PROFILE_CACHE_PREFIX}.${userId}`) ?? `${NATAL_PROFILE_CACHE_PREFIX}.invalid`;
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

async function removeRaw(key: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  const SecureStore = getSecureStore();
  if (!safeKey) return;
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.removeItem(safeKey);
    } catch {
      /* ignore invalid cache keys */
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
    /* ignore invalid cache keys */
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

async function setRaw(key: string, value: string): Promise<void> {
  const safeKey = safeStorageKey(key);
  const SecureStore = getSecureStore();
  if (!safeKey) return;
  const webStorage = getWebStorage();
  if (!SecureStore && webStorage) {
    try {
      webStorage.setItem(safeKey, value);
    } catch {
      /* A cache write must never block startup. */
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
    /* A cache write must never block startup. */
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

async function readCachedNatalProfile(
  userId: string,
  expectedBirthFingerprint?: string | null,
): Promise<NatalProfile | null | undefined> {
  const key = cacheKey(userId);
  const entry = natalProfileMemoryCache.get(key) ?? parseJson<NatalProfileCacheEntry>(await getRaw(key));
  if (!entry) return undefined;
  if (entry.version !== NATAL_PROFILE_CACHE_VERSION || entry.userId !== userId) {
    natalProfileMemoryCache.delete(key);
    await removeRaw(key);
    return undefined;
  }
  if (
    expectedBirthFingerprint !== undefined &&
    (entry.birthFingerprint ?? null) !== (expectedBirthFingerprint ?? null)
  ) {
    natalProfileMemoryCache.delete(key);
    await removeRaw(key);
    return undefined;
  }
  // A cached "no profile" must not short-circuit startup — network may have the chart now.
  if (!entry.profile) {
    natalProfileMemoryCache.delete(key);
    await removeRaw(key);
    return undefined;
  }
  natalProfileMemoryCache.set(key, entry);
  return entry.profile;
}

function birthFingerprintFromParts(params: {
  date?: string | null;
  time?: string | null;
  place?: unknown;
}): string {
  const place =
    typeof params.place === "string" ? params.place : JSON.stringify(params.place ?? null);
  return [params.date ?? "", params.time ?? "", place].join("|");
}

function birthFingerprintFromBirthData(birthData: BirthData): string {
  return birthFingerprintFromParts({
    date: birthData.date,
    time: birthData.timeMode === "unknown" ? null : birthData.time ?? null,
    place: {
      lat: birthData.location.lat,
      lon: birthData.location.lng,
      timezone: birthData.location.timezone,
    },
  });
}

async function saveCachedNatalProfile(
  userId: string,
  profile: NatalProfile | null,
  birthFingerprint?: string | null,
): Promise<void> {
  const key = cacheKey(userId);
  const entry: NatalProfileCacheEntry = {
    version: NATAL_PROFILE_CACHE_VERSION,
    userId,
    profile,
    birthFingerprint: birthFingerprint ?? null,
    savedAt: new Date().toISOString(),
  };
  natalProfileMemoryCache.set(key, entry);
  await setRaw(key, JSON.stringify(entry));
}

function mergeAbortSignals(signal?: AbortSignal, timeoutMs?: number): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  signal?.addEventListener("abort", () => controller.abort(), { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    },
    timedOut: () => controller.signal.aborted && !signal?.aborted,
  };
}

async function getAuthContext(): Promise<{ accessToken: string; userId: string }> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const userId = data.session?.user?.id;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для сохранения натальной карты.");
  if (!userId) throw new Error("Нужна активная сессия пользователя для натальной карты.");
  return { accessToken: token, userId };
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
  }

  const text = await res.text().catch(() => res.statusText);
  if (text.includes("DEPLOYMENT_NOT_FOUND")) {
    return new Error(
      `Vercel deployment is not available for EXPO_PUBLIC_COMMUNICATOR_API_URL (${res.status}).`,
    );
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function houseCusps(row: NatalChartRow): number[] | undefined {
  if (row.precision_mode !== "precise" || row.ascendant_longitude == null) return undefined;
  const house1Cusp = Math.floor(row.ascendant_longitude / 30) * 30;
  return Array.from({ length: 12 }, (_, i) => (house1Cusp + i * 30) % 360);
}

function natalProfileFromRow(row: NatalChartRow): NatalProfile {
  const ascendantIndex =
    row.ascendant_longitude == null ? null : Math.floor((((row.ascendant_longitude % 360) + 360) % 360) / 30);
  return {
    precisionMode: row.precision_mode,
    isDayChart: row.is_day_chart,
    ascendant:
      row.ascendant_longitude == null || ascendantIndex == null
        ? undefined
        : {
            longitude: row.ascendant_longitude,
            sign: ZODIAC_SIGNS[ascendantIndex],
          },
    houseSystem: row.house_system,
    houseCusps: houseCusps(row),
    planets: row.planets,
    computedAt: row.computed_at,
    ephemerisLibVersion: row.ephemeris_lib_version ?? "unknown",
  };
}

export async function createNatalProfile(birthData: BirthData, signal?: AbortSignal): Promise<CreateNatalProfileResult> {
  return withTransientNetworkRetry(
    async () => {
      const { accessToken, userId } = await getAuthContext();
      const url = getAstroNatalUrl();
      const timeout = mergeAbortSignals(signal, NATAL_PROFILE_SAVE_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ birthData }),
          signal: timeout.signal,
        });
      } catch (error) {
        if (timeout.timedOut()) {
          throw new Error(`Natal profile save timed out after ${Math.round(NATAL_PROFILE_SAVE_TIMEOUT_MS / 1000)}s.`);
        }
        throw wrapConnectivityFailure(error, "natal-profile");
      } finally {
        timeout.cleanup();
      }

      if (!res.ok) throw await readError(res);
      const result = (await res.json()) as CreateNatalProfileResult;
      await saveCachedNatalProfile(userId, result.profile ?? null, birthFingerprintFromBirthData(birthData));
      return result;
    },
    { signal },
  );
}

async function fetchActiveNatalProfileFromNetwork(
  userId: string,
  signal?: AbortSignal,
  expectedBirthFingerprint?: string | null,
): Promise<NatalProfile | null> {
  const timeout = mergeAbortSignals(signal, NATAL_PROFILE_TIMEOUT_MS);
  try {
    const { data, error } = await requireSupabase()
      .from("user_natal_charts")
      .select("precision_mode,is_day_chart,ascendant_longitude,house_system,planets,computed_at,ephemeris_lib_version")
      .eq("user_id", userId)
      .eq("is_active", true)
      .abortSignal(timeout.signal)
      .maybeSingle();
    if (error) throw error;
    const profile = data ? natalProfileFromRow(data as unknown as NatalChartRow) : null;
    await saveCachedNatalProfile(userId, profile, expectedBirthFingerprint);
    return profile;
  } catch (error) {
    if (timeout.timedOut()) {
      throw new Error(`Natal profile request timed out after ${Math.round(NATAL_PROFILE_TIMEOUT_MS / 1000)}s.`);
    }
    // Do not persist failures as "profile: null" — that caused false "birth data required" on Home.
    throw error;
  } finally {
    timeout.cleanup();
  }
}

function refreshNatalProfileCache(
  userId: string,
  expectedBirthFingerprint?: string | null,
): Promise<NatalProfile | null> {
  const inFlight = natalProfileRefreshes.get(userId);
  if (inFlight) return inFlight;
  const request = fetchActiveNatalProfileFromNetwork(userId, undefined, expectedBirthFingerprint).finally(() => {
    natalProfileRefreshes.delete(userId);
  });
  natalProfileRefreshes.set(userId, request);
  return request;
}

export async function fetchActiveNatalProfile(): Promise<NatalProfile | null> {
  const { userId } = await getAuthContext();
  return fetchActiveNatalProfileFromNetwork(userId);
}

export type FetchActiveNatalProfileCachedOptions = {
  /** Called when a warm cache was shown and a background refresh finishes. */
  onBackgroundRefresh?: (profile: NatalProfile | null) => void;
  /** Current birth-data fingerprint from `users`; mismatched cached natal must be ignored. */
  expectedBirthFingerprint?: string | null;
};

export async function fetchActiveNatalProfileCached(
  userId: string,
  options?: FetchActiveNatalProfileCachedOptions,
): Promise<NatalProfile | null> {
  const cached = await readCachedNatalProfile(userId, options?.expectedBirthFingerprint);
  if (cached) {
    void refreshNatalProfileCache(userId, options?.expectedBirthFingerprint)
      .then((profile) => {
        options?.onBackgroundRefresh?.(profile);
      })
      .catch(() => undefined);
    return cached;
  }
  return refreshNatalProfileCache(userId, options?.expectedBirthFingerprint);
}
