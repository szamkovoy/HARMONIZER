import {
  asContentLocale,
  SOURCE_LOCALE,
  type AppContentLocale,
} from "@/modules/i18n/localeCodes";
import { GENERATED_TYPED_OVERLAYS } from "@/modules/i18n/typed/generated-overlays";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function overlayFor(moduleId: string, locale: AppContentLocale): Record<string, unknown> | null {
  const moduleOverlays = GENERATED_TYPED_OVERLAYS[moduleId];
  if (!moduleOverlays) return null;
  const direct = moduleOverlays[locale];
  return direct && Object.keys(direct).length ? direct : null;
}

/** Flat dotted-key overlay (e.g. chakra short.1) → string map. */
function flattenOverlayStrings(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenOverlayStrings(value as Record<string, unknown>, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

/** Replace string leaves in `base` using flat dotted paths; functions stay from base. */
function applyFlatStringOverlay<T extends object>(base: T, overlayFlat: Record<string, string>): T {
  const walk = (node: unknown, prefix: string): unknown => {
    if (typeof node === "string") {
      return overlayFlat[prefix] ?? node;
    }
    if (!isPlainObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") {
        out[key] = overlayFlat[path] ?? value;
      } else if (isPlainObject(value)) {
        out[key] = walk(value, path);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  return walk(base, "") as T;
}

/**
 * Apply typed-module overlay JSON for locales beyond inline RU/EN tables.
 * Overlays are merged by flat dotted path (robust to JSON nesting shape).
 */
export function mergeTypedLocale<T extends object>(
  moduleId: string,
  base: T,
  locale: string | undefined | null,
): T {
  const code = asContentLocale(locale);
  if (!code || code === SOURCE_LOCALE || code === "en") {
    return base;
  }

  const overlay = overlayFor(moduleId, code);
  if (overlay) return applyFlatStringOverlay(base, flattenOverlayStrings(overlay));

  const enOverlay = overlayFor(moduleId, "en");
  if (enOverlay) return applyFlatStringOverlay(base, flattenOverlayStrings(enOverlay));

  return base;
}

/** @deprecated Use mergeTypedLocale — kept for callers that pass nested overlay objects. */
export function deepMergeTyped<T extends object>(base: T, overlay: Record<string, unknown>): T {
  return applyFlatStringOverlay(base, flattenOverlayStrings(overlay));
}

export function applyFlatChakraOverlay(
  locale: string | undefined | null,
): {
  short: Record<number, string>;
  nom: Record<number, string>;
  gen: Record<number, string>;
  display: Record<number, string>;
} | null {
  const code = asContentLocale(locale);
  if (!code || code === SOURCE_LOCALE || code === "en") return null;
  const raw = overlayFor("chakra", code);
  if (!raw) return null;

  const short: Record<number, string> = {};
  const nom: Record<number, string> = {};
  const gen: Record<number, string> = {};
  const display: Record<number, string> = {};

  for (const [key, value] of Object.entries(flattenOverlayStrings(raw))) {
    const [group, num] = key.split(".");
    const n = Number.parseInt(num ?? "", 10);
    if (!Number.isFinite(n)) continue;
    if (group === "short") short[n] = value;
    if (group === "nom") nom[n] = value;
    if (group === "gen") gen[n] = value;
    if (group === "display") display[n] = value;
  }

  return { short, nom, gen, display };
}
