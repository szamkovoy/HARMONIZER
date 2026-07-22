/**
 * Персист меток запросов разрешения на уведомления (cooldown).
 * SecureStore на native, localStorage на web.
 */
import { Platform } from "react-native";

type SecureStoreLike = typeof import("expo-secure-store");

function getSecureStore(): SecureStoreLike | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-secure-store") as SecureStoreLike;
  } catch {
    return null;
  }
}

function storageKey(key: string): string {
  return `harmonizer.notif.${key.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export async function readNotifFlag(key: string): Promise<string | null> {
  const k = storageKey(key);
  const SecureStore = getSecureStore();
  if (SecureStore) {
    try {
      return await SecureStore.getItemAsync(k);
    } catch {
      return null;
    }
  }
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
}

export async function writeNotifFlag(key: string, value: string): Promise<void> {
  const k = storageKey(key);
  const SecureStore = getSecureStore();
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(k, value);
    } catch {
      /* не критично */
    }
    return;
  }
  try {
    globalThis.localStorage?.setItem(k, value);
  } catch {
    /* не критично */
  }
}
