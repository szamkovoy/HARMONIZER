import type { AppContentLocale } from "../contentLocales";
import de from "../../../../data/dialog_scaffold/de.json";
import en from "../../../../data/dialog_scaffold/en.json";
import es from "../../../../data/dialog_scaffold/es.json";
import fr from "../../../../data/dialog_scaffold/fr.json";
import it from "../../../../data/dialog_scaffold/it.json";
import nl from "../../../../data/dialog_scaffold/nl.json";
import pt from "../../../../data/dialog_scaffold/pt.json";
import ru from "../../../../data/dialog_scaffold/ru.json";

export type DialogScaffoldBundle = typeof en;

const CATALOG: Record<AppContentLocale, DialogScaffoldBundle> = {
  ru,
  en,
  de,
  fr,
  it,
  es,
  pt,
  nl,
};

export function getDialogScaffoldStrings(locale: AppContentLocale): DialogScaffoldBundle {
  return CATALOG[locale] ?? en;
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

export function chakraOrdinalLabel(locale: AppContentLocale, chakraNumber: number): string {
  const s = getDialogScaffoldStrings(locale);
  const key = `chakraOrdinal_${chakraNumber}` as keyof DialogScaffoldBundle;
  const value = s[key];
  return typeof value === "string" ? value : String(chakraNumber);
}

export function chakraAttentionPrefixFor(locale: AppContentLocale, chakraNumber: number): string {
  const ordinal = chakraOrdinalLabel(locale, chakraNumber);
  if (!ordinal) return "";
  return interpolate(getDialogScaffoldStrings(locale).chakraAttention, { ordinal });
}

export function summaryClarifyVariant(
  locale: AppContentLocale,
  domain: "work" | "rest" | "social" | "creative" | "tiny" | "generic",
  seed: number,
): string {
  const s = getDialogScaffoldStrings(locale);
  const variants: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const key = `summaryClarify_${domain}_${index}` as keyof DialogScaffoldBundle;
    const value = s[key];
    if (typeof value === "string" && value.trim()) variants.push(value);
  }
  if (!variants.length) {
    return s.summaryClarify_generic_0;
  }
  return variants[seed % variants.length]!;
}

export function greetingPhrase(
  locale: AppContentLocale,
  timeOfDay: "morning" | "midday" | "evening" | "night",
): string {
  const s = getDialogScaffoldStrings(locale);
  const map = {
    morning: s.greeting_morning,
    midday: s.greeting_midday,
    evening: s.greeting_evening,
    night: s.greeting_night,
  };
  return map[timeOfDay];
}
