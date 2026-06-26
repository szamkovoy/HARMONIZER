import type { AppContentLocale } from "./contentLocales";
import { normalizeChakraNamesInText } from "./chakraText";
import { getMathLevelStrings } from "./mathLevelI18n";

const TECHNICAL_TONE_KEYS = ["harmonic", "dissonant", "ambivalent_strong", "neutral"] as const;

const CONCLUSION_HEADER_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /§\s*6\.?\s*ЗАКЛЮЧЕНИЕ\s+С\s+МОСТИКОМ/giu, replacement: "§6. ЗАКЛЮЧЕНИЕ" },
  { pattern: /§\s*6\.?\s*CONCLUSION\s+WITH\s+(?:A\s+)?BRIDGE/giu, replacement: "§6. CONCLUSION" },
  { pattern: /§\s*6\.?\s*SCHLUSS\s+MIT\s+ÜBERLEITUNG/giu, replacement: "§6. SCHLUSS" },
  { pattern: /§\s*6\.?\s*CONCLUSION\s+AVEC\s+PONT/giu, replacement: "§6. CONCLUSION" },
  { pattern: /§\s*6\.?\s*CONCLUSIONE\s+CON\s+PONTE/giu, replacement: "§6. CONCLUSIONE" },
  { pattern: /§\s*6\.?\s*CONCLUSIÓN\s+CON\s+PUENTE/giu, replacement: "§6. CONCLUSIÓN" },
  { pattern: /§\s*6\.?\s*CONCLUSÃO\s+COM\s+PONTE/giu, replacement: "§6. CONCLUSÃO" },
  { pattern: /§\s*6\.?\s*CONCLUSIE\s+MET\s+BRUG/giu, replacement: "§6. CONCLUSIE" },
];
const GLOBAL_LONG_SECTION_MARKERS = ["§1.", "§2.", "§3.", "§4.", "§5.", "§6."] as const;
const GLOBAL_LONG_CHAKRA_PATTERNS = [
  /\bchakra(?:s)?\b/iu,
  /чакр/iu,
  /анахат|манипур|сахасрар|вишуд|аджн|свадх|муладхар/iu,
] as const;

function preserveInitialCapital(label: string, match: string): string {
  if (!match) return label;
  const first = match.charAt(0);
  if (first !== first.toUpperCase()) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function normalizeTechnicalTermsInText(text: string | null | undefined, locale: AppContentLocale): string {
  if (typeof text !== "string" || !text.trim()) return text ?? "";
  const toneLabel = getMathLevelStrings(locale).toneLabel;
  let next = text;
  for (const key of TECHNICAL_TONE_KEYS) {
    const localized = toneLabel(key);
    if (!localized || localized === key) continue;
    next = next.replace(new RegExp(`(?<![\\p{L}])${key}(?![\\p{L}])`, "giu"), (match) =>
      preserveInitialCapital(localized, match),
    );
    next = next.replace(new RegExp(`[«""]\\s*${key}\\s*[»""]`, "giu"), (match) => {
      const quoteOpen = match.charAt(0);
      const quoteClose = match.charAt(match.length - 1);
      return `${quoteOpen}${preserveInitialCapital(localized, key)}${quoteClose}`;
    });
  }
  return next;
}

export function normalizeLongExplanationSectionHeaders(text: string | null | undefined): string {
  if (typeof text !== "string" || !text.trim()) return text ?? "";
  let next = text;
  for (const { pattern, replacement } of CONCLUSION_HEADER_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function normalizeRecommendationText(text: string | null | undefined, locale: AppContentLocale): string {
  if (typeof text !== "string" || !text.trim()) return text ?? "";
  let next = normalizeChakraNamesInText(text, locale);
  next = normalizeTechnicalTermsInText(next, locale);
  next = normalizeLongExplanationSectionHeaders(next);
  return next;
}

export function hasStructuredGlobalLongExplanation(text: string | null | undefined): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const normalized = normalizeLongExplanationSectionHeaders(text);
  return GLOBAL_LONG_SECTION_MARKERS.every((marker) => normalized.includes(marker));
}

export function hasLegacyGlobalChakraMentions(text: string | null | undefined): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  return GLOBAL_LONG_CHAKRA_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCurrentGlobalLongExplanation(text: string | null | undefined): boolean {
  if (!hasStructuredGlobalLongExplanation(text)) return false;
  return !hasLegacyGlobalChakraMentions(text);
}

export function normalizeRecommendationFields<T extends Record<string, unknown>>(
  payload: T,
  locale: AppContentLocale,
  fields: readonly string[] = ["slogan", "short_text", "long_explanation"],
): T {
  const next: T = { ...payload };
  const mutableNext = next as Record<string, unknown>;
  for (const field of fields) {
    if (typeof mutableNext[field] === "string") {
      mutableNext[field] = normalizeRecommendationText(mutableNext[field] as string, locale);
    }
  }
  if (mutableNext.math_level && typeof mutableNext.math_level === "object") {
    const mathLevel = { ...(mutableNext.math_level as Record<string, unknown>) };
    if (typeof mathLevel.markdown === "string") {
      mathLevel.markdown = normalizeRecommendationText(mathLevel.markdown, locale);
    }
    mutableNext.math_level = mathLevel;
  }
  return next;
}
