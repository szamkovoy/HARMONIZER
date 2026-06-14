import { useCallback } from "react";

import { useAppLocale } from "@/modules/i18n/useAppLocale";
import { t as translate, tCount as translateCount } from "@/modules/i18n/t";

/** Hook giving a `t`/`tc` bound to the active app locale. */
export function useTranslate() {
  const { locale } = useAppLocale();
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
  const tc = useCallback(
    (baseKey: string, count: number, params?: Record<string, string | number>) =>
      translateCount(locale, baseKey, count, params),
    [locale],
  );
  return { t, tc, locale };
}
