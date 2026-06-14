import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { asContentLocale } from "@/modules/i18n/localeCodes";
import { applyFlatChakraOverlay } from "@/modules/i18n/typed/merge";

export type ChakraLocale = AppContentLocale;

const SHORT_LABELS: Record<"ru" | "en", Record<number, string>> = {
  ru: {
    1: "витальность",
    2: "кайфушность",
    3: "сила",
    4: "любовь",
    5: "самовыражение",
    6: "мудрость",
    7: "высшее Я",
  },
  en: {
    1: "vitality",
    2: "bliss",
    3: "strength",
    4: "love",
    5: "self-expression",
    6: "wisdom",
    7: "higher Self",
  },
};

const NOMINATIVE: Record<"ru" | "en", Record<number, string>> = {
  ru: {
    1: "первая чакра",
    2: "вторая чакра",
    3: "третья чакра",
    4: "четвёртая чакра",
    5: "пятая чакра",
    6: "шестая чакра",
    7: "седьмая чакра",
  },
  en: {
    1: "first chakra",
    2: "second chakra",
    3: "third chakra",
    4: "fourth chakra",
    5: "fifth chakra",
    6: "sixth chakra",
    7: "seventh chakra",
  },
};

const GENITIVE: Record<"ru" | "en", Record<number, string>> = {
  ru: {
    1: "первой чакры",
    2: "второй чакры",
    3: "третьей чакры",
    4: "четвёртой чакры",
    5: "пятой чакры",
    6: "шестой чакры",
    7: "седьмой чакры",
  },
  en: {
    1: "the first chakra",
    2: "the second chakra",
    3: "the third chakra",
    4: "the fourth chakra",
    5: "the fifth chakra",
    6: "the sixth chakra",
    7: "the seventh chakra",
  },
};

const NUMERIC_DISPLAY: Record<"ru" | "en", readonly string[]> = {
  ru: [
    "Первая чакра",
    "Вторая чакра",
    "Третья чакра",
    "Четвертая чакра",
    "Пятая чакра",
    "Шестая чакра",
    "Седьмая чакра",
  ],
  en: [
    "First chakra",
    "Second chakra",
    "Third chakra",
    "Fourth chakra",
    "Fifth chakra",
    "Sixth chakra",
    "Seventh chakra",
  ],
};

export function coerceChakraLocale(locale: string | undefined | null): ChakraLocale {
  return asContentLocale(locale) ?? "ru";
}

function labelFromMaps(
  locale: ChakraLocale,
  maps: Record<"ru" | "en", Record<number, string>>,
  chakraNumber: number,
  group: "short" | "nom" | "gen",
): string {
  const overlay = applyFlatChakraOverlay(locale);
  const fromOverlay = overlay?.[group]?.[chakraNumber];
  if (fromOverlay) return fromOverlay;
  const inline: "ru" | "en" = locale === "ru" ? "ru" : "en";
  return maps[inline][chakraNumber] ?? maps.ru[chakraNumber] ?? "";
}

export function capitalizeChakraLabel(value: string): string {
  if (!value.trim()) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Short state label for legends — always sentence-initial cap (Vitality, Higher Self). */
export function chakraShortLabelDisplay(locale: ChakraLocale, chakraNumber: number): string {
  return capitalizeChakraLabel(chakraShortLabel(locale, chakraNumber));
}

export function chakraShortLabel(locale: ChakraLocale, chakraNumber: number): string {
  return labelFromMaps(locale, SHORT_LABELS, chakraNumber, "short") || String(chakraNumber);
}

export function chakraLabel(locale: ChakraLocale, chakraNumber: number): string {
  return labelFromMaps(locale, NOMINATIVE, chakraNumber, "nom") || `${chakraNumber} chakra`;
}

export function chakraLabelGenitive(locale: ChakraLocale, chakraNumber: number): string {
  return labelFromMaps(locale, GENITIVE, chakraNumber, "gen") || `${chakraNumber} chakra`;
}

export function chakraNumericDisplayLabel(locale: ChakraLocale, chakraNumber: number): string {
  const overlay = applyFlatChakraOverlay(locale);
  const fromOverlay = overlay?.display?.[chakraNumber];
  if (fromOverlay) return fromOverlay;
  const inline: "ru" | "en" = locale === "ru" ? "ru" : "en";
  return NUMERIC_DISPLAY[inline][chakraNumber - 1] ?? NUMERIC_DISPLAY.ru[chakraNumber - 1] ?? String(chakraNumber);
}

/** Chakra tag for practice cards: «4 чакра» / «4th chakra». */
export function chakraTagLabel(locale: ChakraLocale, chakraNumber: number): string {
  if (locale !== "ru") {
    const suffix = chakraNumber === 1 ? "st" : chakraNumber === 2 ? "nd" : chakraNumber === 3 ? "rd" : "th";
    return `${chakraNumber}${suffix} chakra`;
  }
  return `${chakraNumber} чакра`;
}

export function formatChakraList(locale: ChakraLocale, chakraIds: readonly number[]): string {
  const unique = [...new Set(chakraIds.filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
  if (!unique.length) return locale === "ru" ? "энергетические центры" : "energy centres";
  return unique.map((id) => chakraTagLabel(locale, id)).join(locale === "ru" ? ", " : ", ");
}
