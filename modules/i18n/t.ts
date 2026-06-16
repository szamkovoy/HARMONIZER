import type { AppLocale } from "@/modules/i18n/localeStore";
import deCatalog from "@/modules/i18n/catalog/de.json";
import enCatalog from "@/modules/i18n/catalog/en.json";
import esCatalog from "@/modules/i18n/catalog/es.json";
import frCatalog from "@/modules/i18n/catalog/fr.json";
import itCatalog from "@/modules/i18n/catalog/it.json";
import nlCatalog from "@/modules/i18n/catalog/nl.json";
import ptCatalog from "@/modules/i18n/catalog/pt.json";
import ruCatalog from "@/modules/i18n/catalog/ru.json";

type Catalog = Record<string, string>;

/**
 * Catalog source of truth is Russian. Targets are filled by the sync gate
 * (scripts/i18n-sync.mjs). Lookups fall back: requested → en → ru → key.
 */
const CATALOGS: Partial<Record<AppLocale, Catalog>> = {
  ru: ruCatalog as Catalog,
  en: enCatalog as Catalog,
  de: deCatalog as Catalog,
  fr: frCatalog as Catalog,
  it: itCatalog as Catalog,
  es: esCatalog as Catalog,
  pt: ptCatalog as Catalog,
  nl: nlCatalog as Catalog,
};

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function lookup(locale: AppLocale, key: string): string | undefined {
  return CATALOGS[locale]?.[key] ?? CATALOGS.en?.[key] ?? CATALOGS.ru?.[key];
}

/** Translate a flat dotted key, interpolating `{var}` placeholders. */
export function t(locale: AppLocale, key: string, params?: Record<string, string | number>): string {
  const template = lookup(locale, key);
  return template == null ? key : interpolate(template, params);
}

/**
 * The locale's own CLDR plural category for `count` (Russian has
 * one/few/many/other, English one/other, etc.). Built on `Intl.PluralRules`, so
 * every target language is handled correctly without per-language code.
 */
export function pluralCategory(locale: AppLocale, count: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    return "other";
  }
}

/**
 * Plural-aware translate. Picks `${baseKey}.${category}` using the locale's own
 * plural rules, falling back to `${baseKey}.other`. `{count}` is provided.
 */
export function tCount(
  locale: AppLocale,
  baseKey: string,
  count: number,
  params?: Record<string, string | number>,
): string {
  const category = pluralCategory(locale, count);
  const key = lookup(locale, `${baseKey}.${category}`) != null ? `${baseKey}.${category}` : `${baseKey}.other`;
  return t(locale, key, { count, ...params });
}
