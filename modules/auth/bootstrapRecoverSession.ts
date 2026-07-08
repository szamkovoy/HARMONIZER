import type { Session } from "@supabase/supabase-js";

import {
  isInvalidRefreshTokenError,
  isTransientAuthConnectivityFailure,
} from "./authNetworkErrors";
import {
  clearPersistedAuthSession,
  readPersistedAuthSessionFromStorage,
  requireSupabase,
} from "@/services/supabase";

const SET_SESSION_RECOVER_ATTEMPTS = 6;
/** Паузы между попытками (сумма ~9 с) — пережить кратковременный RN «Network request failed» на cold start. */
const SET_SESSION_RECOVER_DELAYS_MS = [450, 750, 1200, 1700, 2200, 2800] as const;

/**
 * Если SDK отдал null (ошибка refresh / lock), но в SecureStore ещё лежит сессия GoTrue,
 * пробуем `setSession` с повтором — это единственный публичный путь синхронизировать in-memory
 * клиент Supabase с хранилищем без гонки с параллельным `getSession()` на старте.
 */
export async function recoverAuthSessionFromPersistedStorageWithRetries(): Promise<Session | null> {
  const supabase = requireSupabase();
  const auth = supabase.auth as { initialize?: () => Promise<unknown> };
  if (typeof auth.initialize === "function") {
    try {
      await auth.initialize();
    } catch {
      /* ignore */
    }
  }

  const disk = await readPersistedAuthSessionFromStorage();
  if (!disk?.refresh_token || !disk?.access_token || !disk.user?.id) return null;

  for (let attempt = 0; attempt < SET_SESSION_RECOVER_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.auth.setSession({
      access_token: disk.access_token,
      refresh_token: disk.refresh_token,
    });
    if (data.session && !error) return data.session;
    if (error && isInvalidRefreshTokenError(error)) {
      await clearPersistedAuthSession();
      return null;
    }
    if (error && !isTransientAuthConnectivityFailure(error)) {
      return null;
    }
    if (attempt < SET_SESSION_RECOVER_ATTEMPTS - 1) {
      const delayMs = SET_SESSION_RECOVER_DELAYS_MS[attempt] ?? 2_000;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}
