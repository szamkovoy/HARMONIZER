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
 * протухший access_token) отравлял бы кэш на 5 минут и кнопка пропадала.
 * Кэшируем только явное значение (строка с `value` пришла). При «неизвестно»
 * возвращаем прежний кэш (если был) или fail-safe `false`, не продлевая TTL.
 *
 * Миграция `20260719000000_app_config_anon_read_account_links.sql` открывает
 * select по этому ключу для `anon` — фетч работает и без активной сессии.
 */
import { useEffect, useState } from "react";

import { requireSupabase } from "@/services/supabase";

const CONFIG_KEY = "account_links_enabled";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedValue: boolean | null = null;
let cachedAt = 0;
let inFlight: Promise<boolean> | null = null;

/**
 * Возвращает явное значение флага или `null`, если его не удалось прочитать
 * (нет строки / ошибка сети) — в этом случае кэш не должен обновляться.
 */
async function fetchAccountLinksEnabled(): Promise<boolean | null> {
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

export async function getAccountLinksEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now - cachedAt < CACHE_TTL_MS) return cachedValue;
  if (!inFlight) {
    inFlight = fetchAccountLinksEnabled()
      .then((value) => {
        // Кэшируем только явное значение. «Неизвестно» — оставляем прежний кэш
        // (если был) и не продлеваем TTL, чтобы следующий вызов попробовал снова.
        if (value !== null) {
          cachedValue = value;
          cachedAt = Date.now();
        }
        return cachedValue ?? false;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** true → кнопки «Личный кабинет» показываются. До загрузки/при ошибке — false. */
export function useAccountLinksEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cachedValue ?? false);
  useEffect(() => {
    let cancelled = false;
    void getAccountLinksEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
