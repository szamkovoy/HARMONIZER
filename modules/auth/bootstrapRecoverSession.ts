import type { Session } from "@supabase/supabase-js";

import {
  isInvalidRefreshTokenError,
  isTransientAuthConnectivityFailure,
} from "./authNetworkErrors";
import {
  clearPersistedAuthSession,
  readPersistedAuthSessionFromStorage,
  requireSupabase,
  sessionHasUsableAccessToken,
} from "@/services/supabase";

const SET_SESSION_RECOVER_ATTEMPTS = 6;
/** Даём GoTrue завершить refresh/запись в SecureStore после INITIAL_SESSION=null. */
const RECOVER_SETTLE_MS = 400;
const INVALID_REFRESH_RECHECK_DELAYS_MS = [160, 420, 900] as const;
/** Паузы между попытками (сумма ~9 с) — пережить кратковременный RN «Network request failed» на cold start. */
const SET_SESSION_RECOVER_DELAYS_MS = [450, 750, 1200, 1700, 2200, 2800] as const;

async function readPersistedSessionOrNull(): Promise<Session | null> {
  const disk = await readPersistedAuthSessionFromStorage();
  if (!disk?.refresh_token || !disk?.access_token || !disk.user?.id) return null;
  return disk;
}

async function readRotatedSessionOrNull(previous: Session): Promise<Session | null> {
  for (const delayMs of [0, ...INVALID_REFRESH_RECHECK_DELAYS_MS]) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const freshDisk = await readPersistedSessionOrNull();
    if (
      freshDisk &&
      freshDisk.refresh_token !== previous.refresh_token &&
      (freshDisk.access_token !== previous.access_token || sessionHasUsableAccessToken(freshDisk, true))
    ) {
      return freshDisk;
    }
  }
  return null;
}

/**
 * Если SDK отдал null (ошибка refresh / lock), но в SecureStore ещё лежит сессия GoTrue,
 * пробуем `setSession` с повтором — это единственный публичный путь синхронизировать in-memory
 * клиент Supabase с хранилищем без гонки с параллельным `getSession()` на старте.
 *
 * Важно: после refresh GoTrue может записать новый refresh token в SecureStore, а мы всё ещё
 * держим старый в памяти. Нельзя вызывать `clearPersistedAuthSession` вслепую — сначала
 * перечитываем диск и повторяем с актуальными токенами.
 */
export async function recoverAuthSessionFromPersistedStorageWithRetries(): Promise<Session | null> {
  const supabase = requireSupabase();

  await new Promise((resolve) => setTimeout(resolve, RECOVER_SETTLE_MS));

  let disk = await readPersistedSessionOrNull();
  if (!disk) return null;

  for (let attempt = 0; attempt < SET_SESSION_RECOVER_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.auth.setSession({
      access_token: disk.access_token,
      refresh_token: disk.refresh_token,
    });
    if (data.session && !error) return data.session;

    if (error && isInvalidRefreshTokenError(error)) {
      const rotatedDisk = await readRotatedSessionOrNull(disk);
      if (rotatedDisk) {
        disk = rotatedDisk;
        continue;
      }
      const freshDisk = await readPersistedSessionOrNull();
      if (freshDisk?.refresh_token === disk.refresh_token) {
        await clearPersistedAuthSession();
      }
      return null;
    }

    if (error && !isTransientAuthConnectivityFailure(error)) {
      return null;
    }

    if (attempt < SET_SESSION_RECOVER_ATTEMPTS - 1) {
      const delayMs = SET_SESSION_RECOVER_DELAYS_MS[attempt] ?? 2_000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      disk = (await readPersistedSessionOrNull()) ?? disk;
    }
  }
  return null;
}
