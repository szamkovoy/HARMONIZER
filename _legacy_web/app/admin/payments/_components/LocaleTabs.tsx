"use client";

import { Languages, Loader2 } from "lucide-react";

import { adminFetch } from "../../_lib/adminApi";
import { WIDGET_LOCALES, type WidgetLocale } from "../../../../lib/paymentWidget/copy";

/** Locale tabs: a dot marks locales that already have text. */
export function LocaleTabs(props: {
  value: WidgetLocale;
  onChange: (locale: WidgetLocale) => void;
  filled: (locale: WidgetLocale) => boolean;
  onTranslate?: () => void;
  translating?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {WIDGET_LOCALES.map((locale) => {
        const on = locale === props.value;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => props.onChange(locale)}
            className={`relative rounded-lg px-2.5 py-1 text-xs font-semibold uppercase transition-colors ${
              on ? "bg-emerald-600 text-white" : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {locale}
            {props.filled(locale) ? (
              <span
                className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${on ? "bg-white" : "bg-emerald-500"}`}
              />
            ) : null}
          </button>
        );
      })}
      {props.onTranslate ? (
        <button
          type="button"
          disabled={props.translating}
          onClick={props.onTranslate}
          className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
        >
          {props.translating ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />}
          {props.translating ? "Перевожу…" : "Перевести с русского"}
        </button>
      ) : null}
    </div>
  );
}

/** Translate named Russian texts into the other 7 locales (Gemini, /api/admin/translate). */
export async function translateFieldsFromRu(
  fields: Record<string, string>,
): Promise<Partial<Record<WidgetLocale, Record<string, string>>>> {
  const res = await adminFetch<{ translations: Record<string, Record<string, string>> }>(
    "/api/admin/translate",
    { method: "POST", body: JSON.stringify({ type: "fields", source_locale: "ru", fields }) },
  );
  return res.translations as Partial<Record<WidgetLocale, Record<string, string>>>;
}
