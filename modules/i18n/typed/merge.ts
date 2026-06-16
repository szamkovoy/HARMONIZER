import {
  asContentLocale,
  SOURCE_LOCALE,
  type AppContentLocale,
} from "@/modules/i18n/localeCodes";
import { GENERATED_TYPED_OVERLAYS } from "@/modules/i18n/typed/generated-overlays";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge string leaves; overlay wins. Skips functions in base. */
export function deepMergeTyped<T extends object>(base: T, overlay: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMergeTyped(out[key] as Record<string, unknown>, value);
    } else if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out as T;
}

function overlayFor(moduleId: string, locale: AppContentLocale): Record<string, unknown> | null {
  const moduleOverlays = GENERATED_TYPED_OVERLAYS[moduleId];
  if (!moduleOverlays) return null;
  const direct = moduleOverlays[locale];
  return direct && Object.keys(direct).length ? direct : null;
}

/**
 * Apply typed-module overlay JSON for locales beyond inline RU/EN tables.
 * Fallback: requested locale → EN overlay → RU/EN base passed in.
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
  if (overlay) return deepMergeTyped(base, overlay);

  const enOverlay = overlayFor(moduleId, "en");
  if (enOverlay) return deepMergeTyped(base, enOverlay);

  return base;
}

/** Flat dotted-key overlay (e.g. chakra short.1) → maps by group */
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
