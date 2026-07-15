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
 */
import { useEffect, useState } from "react";

import { requireSupabase } from "@/services/supabase";

const CONFIG_KEY = "account_links_enabled";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedValue: boolean | null = null;
let cachedAt = 0;
let inFlight: Promise<boolean> | null = null;

async function fetchAccountLinksEnabled(): Promise<boolean> {
  try {
    const { data, error } = await requireSupabase()
      .from("app_config")
      .select("value")
      .eq("key", CONFIG_KEY)
      .maybeSingle();
    if (error) throw error;
    return data?.value === true || data?.value === "true";
  } catch {
    return cachedValue ?? false;
  }
}

export async function getAccountLinksEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedValue !== null && now - cachedAt < CACHE_TTL_MS) return cachedValue;
  if (!inFlight) {
    inFlight = fetchAccountLinksEnabled()
      .then((value) => {
        cachedValue = value;
        cachedAt = Date.now();
        return value;
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
