/**
 * Текст для карточки практики в UI.
 * Приоритет: валидированный model-generated `card_blurb` -> server fallback.
 *
 * Локали: все 8 через `asContentLocale`; RU — ru-копии, остальные — en-fallback для breath slug blurbs.
 */

import { chakraLabelRu } from "@/modules/chakra/labels";

import { asContentLocale, SOURCE_LOCALE } from "@legacy/app/api/_utils/contentLocales";

export type PracticeKindForCard = "breath" | "meditation" | "yoga";

const MODEL_CARD_BLURB_MIN_LENGTH = 100;
const MODEL_CARD_BLURB_MAX_LENGTH = 700;

const CHAKRA_NAME_RU: Record<number, string> = {
  1: chakraLabelRu(1),
  2: chakraLabelRu(2),
  3: chakraLabelRu(3),
  4: chakraLabelRu(4),
  5: chakraLabelRu(5),
  6: chakraLabelRu(6),
  7: chakraLabelRu(7),
};

const CHAKRA_NAME_EN: Record<number, string> = {
  1: "Muladhara",
  2: "Svadhisthana",
  3: "Manipura",
  4: "Anahata",
  5: "Vishuddha",
  6: "Ajna",
  7: "Sahasrara",
};

/** Краткие карточные тексты по slug дыхательных практик (RU) — согласованы с семью типами в каталоге. */
const BREATH_CARD_RU: Record<string, string> = {
  coherent:
    "Когерентное дыхание мягко синхронизирует ритм вдоха и выдоха с вариабельностью сердечного ритма и помогает снять напряжение нервной системы.",
  "nadi-shodhana":
    "Нади Шодхана выравнивает потоки между полушариями и каналами — хороший выбор, когда нужна ясность и внутренняя симметрия.",
  "surya-bhedana":
    "Сурья Бхедана «подогревает» и бодрит через правую ноздрю — когда нужно включиться и преодолеть заторможенность.",
  "chandra-bhedana":
    "Чандра Бхедана охлаживает и успокаивает через левую ноздрю — когда эмоции горячие или нужно быстрее выйти в покой.",
  square:
    "Дыхание «Квадрат» выстраивает ровный ритм фаз — опора концентрации и спокойствия под нагрузкой.",
  "triangle-up":
    "Треугольник вверх насыщает кислородом и помогает вернуть ясность ума после интеллектуальной усталости.",
  "triangle-down":
    "Треугольник вниз даёт глубокий сброс напряжения — «аварийный тормоз», когда застряли тревога или навязчивые мысли.",
};

const BREATH_CARD_EN: Record<string, string> = {
  coherent:
    "Coherent breathing gently aligns inhale/exhale with heart-rate variability and helps the nervous system settle.",
  "nadi-shodhana":
    "Nadi Shodhana balances the hemispheres and channels—useful when you need clarity and inner symmetry.",
  "surya-bhedana":
    "Surya Bhedana warms and energises through the right nostril—good when you need activation and focus.",
  "chandra-bhedana":
    "Chandra Bhedana cools and calms through the left nostril—helpful when emotions run hot or you need rest.",
  square:
    "Square breathing steadies the four phases—a anchor for calm focus under pressure.",
  "triangle-up":
    "Triangle (apex up) boosts oxygenation and can sharpen thinking after mental fatigue.",
  "triangle-down":
    "Triangle (apex down) offers a deep reset—an “emergency brake” when anxiety or rumination spikes.",
};

function chakraLine(ids: readonly number[], locale: "ru" | "en"): string {
  const map = locale === "en" ? CHAKRA_NAME_EN : CHAKRA_NAME_RU;
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))];
  if (!unique.length) return locale === "en" ? "the body’s energy centres" : "энергетические центры";
  return unique.map((id) => map[id] ?? String(id)).join(locale === "en" ? ", " : " и ");
}

function chakraZoneRu(ids: readonly number[]): string {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))];
  const genitive: Record<number, string> = {
    1: "первой чакры",
    2: "второй чакры",
    3: "третьей чакры",
    4: "четвёртой чакры",
    5: "пятой чакры",
    6: "шестой чакры",
    7: "седьмой чакры",
  };
  if (!unique.length) return "ключевых энергетических центров";
  if (unique.length === 1) return genitive[unique[0]!] ?? "целевой чакры";
  return unique.map((id) => genitive[id] ?? `${id}-й чакры`).join(" и ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasUnsafeCardBlurbMarkup(value: string): boolean {
  return /<[^>]+>/.test(value) || /\[(?:STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|READY_FOR_RECOMMENDATION)\b/i.test(value);
}

export function normalizeModelPracticeCardBlurb(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  if (normalized.length < MODEL_CARD_BLURB_MIN_LENGTH || normalized.length > MODEL_CARD_BLURB_MAX_LENGTH) return null;
  if (hasUnsafeCardBlurbMarkup(normalized)) return null;
  return normalized;
}

export function buildPracticeCardSummary(params: {
  kind: PracticeKindForCard;
  slug: string;
  chakraIds: readonly number[];
  locale: string | null | undefined;
  userMessage: string;
  modelCardBlurb?: string | null;
}): string {
  void params.userMessage;
  const modelCardBlurb = normalizeModelPracticeCardBlurb(params.modelCardBlurb);
  if (modelCardBlurb) return modelCardBlurb;

  const resolved = asContentLocale(params.locale) ?? SOURCE_LOCALE;
  const locale = resolved === SOURCE_LOCALE ? "ru" : "en";
  const ch = chakraLine(params.chakraIds, locale);

  if (params.kind === "yoga") {
    if (locale === "en") {
      return `This asana sequence focuses on ${ch}—gentle work through the body tends to hold longer than a single conversation.`;
    }
    return `Эта серия асан опирается на зону ${chakraZoneRu(params.chakraIds)}: через тело вы возвращаете устойчивость — эффект обычно глубже, чем от одного разговора.`;
  }

  if (params.kind === "meditation") {
    if (locale === "en") {
      return `A short meditation shifts attention inward—calm, imagery, and balance for the mind.`;
    }
    return `Короткая медитация — спокойная работа с вниманием и образом, без давления на результат.`;
  }

  const slug = params.slug.trim();
  return locale === "en"
    ? BREATH_CARD_EN[slug] ?? BREATH_CARD_EN.coherent
    : BREATH_CARD_RU[slug] ?? BREATH_CARD_RU.coherent;
}

export function buildPracticeAssistantReason(params: {
  kind: PracticeKindForCard;
  chakraIds: readonly number[];
  locale: string | null | undefined;
}): string {
  const resolved = asContentLocale(params.locale) ?? SOURCE_LOCALE;
  const locale = resolved === SOURCE_LOCALE ? "ru" : "en";
  const ch = chakraLine(params.chakraIds, locale);
  if (locale === "en") {
    if (params.kind === "meditation") {
      return `This short meditation can help you collect attention and enter the day through ${ch}: less rush, more quiet clarity.`;
    }
    if (params.kind === "breath") {
      return `This breathing practice can steady the nervous system and support ${ch}, so the day's recommendations are easier to live from inside.`;
    }
    return `This asana practice can anchor ${ch} through the body, so the day's focus becomes more than an idea.`;
  }
  if (params.kind === "meditation") {
    return `Эта короткая медитация поможет собрать внимание и войти в день спокойнее: меньше суеты, больше тихой ясности.`;
  }
  if (params.kind === "breath") {
    return `Эта дыхательная практика поможет выровнять нервную систему и мягко поддержать фокус дня.`;
  }
  return `Хороший выбор: после разговора важно не только понять направление дня, но и дать телу опору. Эта практика поможет собрать энергию и легче удержать ясность в реальных действиях.`;
}
