/**
 * Мини-хранилище флагов модуля account (SecureStore / localStorage на web).
 * Используется для одноразовых уведомлений: «демо-период завершён» и
 * последний известный уровень профиля (для модалки «Спасибо за переход»).
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

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function readAccountFlag(key: string): Promise<string | null> {
  const storageKey = safeKey(`harmonizer.account.${key}`);
  const SecureStore = getSecureStore();
  if (SecureStore) {
    try {
      return await SecureStore.getItemAsync(storageKey);
    } catch {
      return null;
    }
  }
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null;
  } catch {
    return null;
  }
}

export async function writeAccountFlag(key: string, value: string): Promise<void> {
  const storageKey = safeKey(`harmonizer.account.${key}`);
  const SecureStore = getSecureStore();
  if (SecureStore) {
    try {
      await SecureStore.setItemAsync(storageKey, value);
    } catch {
      /* флаг не критичен */
    }
    return;
  }
  try {
    globalThis.localStorage?.setItem(storageKey, value);
  } catch {
    /* флаг не критичен */
  }
}
