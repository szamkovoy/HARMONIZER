/**
 * Kill-switch кнопок «Личный кабинет» (комплаенс App Review).
 *
 * Значение хранится в таблице `public.app_config` (key = 'account_links_enabled').
 * На время модерации сборки выставляется `false` — все кнопки перехода на сайт
 * скрываются, остаётся только «Закрыть». После прохождения ревью значение
 * переключается на `true` без выпуска новой сборки.
 *
 * Fail-safe: при любой ошибке чтения (сеть, отсутствие строки) считаем
 * ссылки выключенными — это безопаснее для модерации, чем случайно показать их.
 *
 * Важно: «нет строк» и сетевая ошибка НЕ кэшируются как свежее `false` — иначе
 * транзиентный сбой (холодный старт без сессии, окно sign-out/sign-in,
 * протухший access_token, PostgREST schema cache 503) отравлял бы кэш на 5 минут
 * и кнопка пропадала. Кэшируем только явное значение. При «неизвестно»
 * возвращаем прежний in-memory / персистентный кэш или fail-safe `false`,
 * не продлевая TTL.
 *
 * Персист последнего явного значения убирает «кнопка появляется через несколько
 * секунд» при повторном заходе на Профиль, пока идёт сетевой refetch.
 *
 * Миграция `20260719000000_app_config_anon_read_account_links.sql` открывает
 * select по этому ключу для `anon` — фетч работает и без активной сессии.
 */
import { useEffect, useState } from "react";

import { readAccountFlag, writeAccountFlag } from "@/modules/account/core/accountFlagsStore";
import { requireSupabase } from "@/services/supabase";

const CONFIG_KEY = "account_links_enabled";
const PERSIST_KEY = "accountLinksEnabled";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_RETRY_DELAYS_MS = [400, 900] as const;

let cachedValue: boolean | null = null;
let cachedAt = 0;
let inFlight: Promise<boolean> | null = null;
let persistHydration: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hydratePersistedValue(): Promise<void> {
  if (cachedValue !== null) return;
  if (!persistHydration) {
    persistHydration = (async () => {
      const raw = await readAccountFlag(PERSIST_KEY);
      if (cachedValue !== null) return;
      if (raw === "true") cachedValue = true;
      else if (raw === "false") cachedValue = false;
    })().finally(() => {
      persistHydration = null;
    });
  }
  await persistHydration;
}

async function persistValue(value: boolean): Promise<void> {
  await writeAccountFlag(PERSIST_KEY, value ? "true" : "false");
}

/**
 * Возвращает явное значение флага или `null`, если его не удалось прочитать
 * (нет строки / ошибка сети) — в этом случае кэш не должен обновляться.
 */
async function fetchAccountLinksEnabledOnce(): Promise<boolean | null> {
  try {
    const { data, error } = await requireSupabase()
      .from("app_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return data.value === true || data.value === "true";
  } catch {
    return null;
  }
}

/** Несколько попыток — PostgREST иногда отвечает schema-cache 503. */
async function fetchAccountLinksEnabled(): Promise<boolean | null> {
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    const value = await fetchAccountLinksEnabledOnce();
    if (value !== null) return value;
    if (attempt >= FETCH_RETRY_DELAYS_MS.length) break;
    await sleep(FETCH_RETRY_DELAYS_MS[attempt] ?? 900);
  }
  return null;
}

export async function getAccountLinksEnabled(): Promise<boolean> {
  await hydratePersistedValue();
  const now = Date.now();
  if (cachedValue !== null && cachedAt > 0 && now - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }
  if (!inFlight) {
    inFlight = fetchAccountLinksEnabled()
      .then(async (value) => {
        // Кэшируем только явное значение. «Неизвестно» — оставляем прежний кэш
        // (если был) и не продлеваем TTL, чтобы следующий вызов попробовал снова.
        if (value !== null) {
          cachedValue = value;
          cachedAt = Date.now();
          await persistValue(value);
        }
        return cachedValue ?? false;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** true → кнопки «Личный кабинет» показываются. До загрузки — персист или false. */
export function useAccountLinksEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cachedValue ?? false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydratePersistedValue();
      if (!cancelled && cachedValue !== null) setEnabled(cachedValue);
      const value = await getAccountLinksEnabled();
      if (!cancelled) setEnabled(value);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
