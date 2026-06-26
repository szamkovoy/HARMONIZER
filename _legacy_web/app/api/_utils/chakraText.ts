import type { AppContentLocale } from "./contentLocales";

const CHAKRA_LABELS: Record<AppContentLocale, Record<number, string>> = {
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
  de: {
    1: "erstes Chakra",
    2: "zweites Chakra",
    3: "drittes Chakra",
    4: "viertes Chakra",
    5: "fuenftes Chakra",
    6: "sechstes Chakra",
    7: "siebtes Chakra",
  },
  fr: {
    1: "premier chakra",
    2: "deuxieme chakra",
    3: "troisieme chakra",
    4: "quatrieme chakra",
    5: "cinquieme chakra",
    6: "sixieme chakra",
    7: "septieme chakra",
  },
  it: {
    1: "primo chakra",
    2: "secondo chakra",
    3: "terzo chakra",
    4: "quarto chakra",
    5: "quinto chakra",
    6: "sesto chakra",
    7: "settimo chakra",
  },
  es: {
    1: "primer chakra",
    2: "segundo chakra",
    3: "tercer chakra",
    4: "cuarto chakra",
    5: "quinto chakra",
    6: "sexto chakra",
    7: "septimo chakra",
  },
  pt: {
    1: "primeiro chakra",
    2: "segundo chakra",
    3: "terceiro chakra",
    4: "quarto chakra",
    5: "quinto chakra",
    6: "sexto chakra",
    7: "setimo chakra",
  },
  nl: {
    1: "eerste chakra",
    2: "tweede chakra",
    3: "derde chakra",
    4: "vierde chakra",
    5: "vijfde chakra",
    6: "zesde chakra",
    7: "zevende chakra",
  },
};

const CHAKRA_PATTERNS: Array<{ chakraNumber: number; pattern: RegExp }> = [
  { chakraNumber: 1, pattern: /(?<![\p{L}])(?:муладхар(?:а|ы|е|у|ой)?|muladhara)(?![\p{L}])/giu },
  {
    chakraNumber: 2,
    pattern: /(?<![\p{L}])(?:свадхистхан(?:а|ы|е|у|ой)?|свадхистан(?:а|ы|е|у|ой)?|svadhisthana|svadhistana|swadhisthana)(?![\p{L}])/giu,
  },
  { chakraNumber: 3, pattern: /(?<![\p{L}])(?:манипур(?:а|ы|е|у|ой)?|manipura)(?![\p{L}])/giu },
  { chakraNumber: 4, pattern: /(?<![\p{L}])(?:анахат(?:а|ы|е|у|ой)?|anahata)(?![\p{L}])/giu },
  { chakraNumber: 5, pattern: /(?<![\p{L}])(?:вишудд?х(?:а|ы|е|у|ой)?|vishuddha|vishudha)(?![\p{L}])/giu },
  { chakraNumber: 6, pattern: /(?<![\p{L}])(?:аджн(?:а|ы|е|у|ой)?|ajna)(?![\p{L}])/giu },
  { chakraNumber: 7, pattern: /(?<![\p{L}])(?:сахасрар(?:а|ы|е|у|ой)?|sahasrara)(?![\p{L}])/giu },
];

function preserveInitialCapital(label: string, match: string): string {
  if (!match) return label;
  const first = match.charAt(0);
  if (first !== first.toUpperCase()) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function chakraLabel(locale: AppContentLocale, chakraNumber: number): string {
  return CHAKRA_LABELS[locale]?.[chakraNumber] ?? CHAKRA_LABELS.ru[chakraNumber] ?? `${chakraNumber} chakra`;
}

export function normalizeChakraNamesInText(text: string | null | undefined, locale: AppContentLocale): string {
  if (typeof text !== "string" || !text.trim()) return text ?? "";
  let next = text;
  for (const matcher of CHAKRA_PATTERNS) {
    const replacement = chakraLabel(locale, matcher.chakraNumber);
    next = next.replace(matcher.pattern, (match) => preserveInitialCapital(replacement, match));
  }
  return next;
}

export function normalizeChakraNamesInFields<T extends Record<string, unknown>>(
  payload: T,
  locale: AppContentLocale,
  fields: readonly string[] = ["slogan", "short_text", "long_explanation"],
): T {
  const next: T = { ...payload };
  const mutableNext = next as Record<string, unknown>;
  for (const field of fields) {
    if (typeof mutableNext[field] === "string") {
      mutableNext[field] = normalizeChakraNamesInText(mutableNext[field] as string, locale);
    }
  }
  return next;
}
