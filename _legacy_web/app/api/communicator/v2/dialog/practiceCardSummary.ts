/**
 * Текст для карточки практики в UI.
 * Приоритет: валидированный model-generated `card_blurb` -> server fallback.
 *
 * Локали: все 8 через `asContentLocale`; RU/EN хранят более детальные breath-copy,
 * остальные локали получают короткие locale-native fallback тексты вместо EN leakage.
 */

import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";
import { asContentLocale, SOURCE_LOCALE } from "@legacy/app/api/_utils/contentLocales";

export type PracticeKindForCard = "breath" | "meditation" | "yoga";

const MODEL_CARD_BLURB_MIN_LENGTH = 100;
const MODEL_CARD_BLURB_MAX_LENGTH = 700;

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

const GENERIC_CARD_TEXT: Record<AppContentLocale, Record<PracticeKindForCard, string>> = {
  ru: {
    meditation: "Короткая медитация мягко собирает внимание, успокаивает внутренний шум и помогает вернуться к более ровному состоянию.",
    breath: "Короткая дыхательная практика помогает выровнять ритм, разгрузить нервную систему и вернуть больше внутренней устойчивости.",
    yoga: "Эта серия асан помогает перевести внутреннюю работу в телесную опору и сделать состояние дня более устойчивым.",
  },
  en: {
    meditation: "A short meditation gathers attention, softens inner noise, and helps you return to a steadier state.",
    breath: "A short breathing practice can steady the rhythm, calm the nervous system, and restore more inner stability.",
    yoga: "This asana sequence helps anchor the inner work in the body and make the day's state more stable.",
  },
  de: {
    meditation: "Diese kurze Meditation sammelt die Aufmerksamkeit, beruhigt den inneren Lärm und hilft, wieder in einen ruhigeren Zustand zu kommen.",
    breath: "Diese kurze Atempraxis stabilisiert den Rhythmus, entlastet das Nervensystem und gibt mehr innere Stabilität.",
    yoga: "Diese Asana-Sequenz verankert die innere Arbeit im Körper und macht den Zustand des Tages stabiler.",
  },
  fr: {
    meditation: "Cette courte meditation rassemble l'attention, calme le bruit interieur et aide a revenir vers un etat plus stable.",
    breath: "Cette courte pratique respiratoire retablit le rythme, apaise le systeme nerveux et rend plus de stabilite interieure.",
    yoga: "Cette sequence d'asanas aide a ancrer le travail interieur dans le corps et a rendre l'etat du jour plus stable.",
  },
  it: {
    meditation: "Questa breve meditazione raccoglie l'attenzione, calma il rumore interiore e aiuta a tornare a uno stato piu stabile.",
    breath: "Questa breve pratica di respirazione riequilibra il ritmo, calma il sistema nervoso e restituisce piu stabilita interiore.",
    yoga: "Questa sequenza di asana aiuta a radicare il lavoro interiore nel corpo e a rendere piu stabile lo stato della giornata.",
  },
  es: {
    meditation: "Esta meditacion breve recoge la atencion, calma el ruido interior y ayuda a volver a un estado mas estable.",
    breath: "Esta practica breve de respiracion regula el ritmo, calma el sistema nervioso y devuelve mas estabilidad interior.",
    yoga: "Esta secuencia de asanas ayuda a llevar el trabajo interior al cuerpo y a hacer mas estable el estado del dia.",
  },
  pt: {
    meditation: "Esta meditacao curta recolhe a atencao, acalma o ruido interior e ajuda a voltar a um estado mais estavel.",
    breath: "Esta pratica curta de respiracao regula o ritmo, acalma o sistema nervoso e devolve mais estabilidade interior.",
    yoga: "Esta sequencia de asanas ajuda a ancorar o trabalho interior no corpo e a tornar o estado do dia mais estavel.",
  },
  nl: {
    meditation: "Deze korte meditatie bundelt de aandacht, maakt innerlijke ruis stiller en helpt om terug te keren naar een stabielere staat.",
    breath: "Deze korte adempraktijk brengt het ritme terug, kalmeert het zenuwstelsel en geeft meer innerlijke stabiliteit.",
    yoga: "Deze asana-reeks helpt het innerlijke werk in het lichaam te verankeren en de staat van de dag stabieler te maken.",
  },
};

const GENERIC_REASON_TEXT: Record<AppContentLocale, Record<PracticeKindForCard, string>> = {
  ru: {
    meditation: "Эта короткая медитация поможет собрать внимание и войти в день спокойнее: меньше суеты, больше тихой ясности.",
    breath: "Эта дыхательная практика поможет выровнять нервную систему и мягко поддержать фокус дня.",
    yoga: "Эта практика поможет дать телу опору и сделать фокус дня более живым и устойчивым в реальных действиях.",
  },
  en: {
    meditation: "This short meditation can gather attention and bring a calmer, clearer tone to the rest of the day.",
    breath: "This breathing practice can steady the nervous system and gently support the day's focus.",
    yoga: "This practice can give the body more support and make the day's focus easier to live in action.",
  },
  de: {
    meditation: "Diese kurze Meditation sammelt die Aufmerksamkeit und bringt mehr Ruhe und Klarheit in den weiteren Tag.",
    breath: "Diese Atempraxis stabilisiert das Nervensystem und unterstuetzt sanft den Fokus des Tages.",
    yoga: "Diese Praxis gibt dem Korper mehr Halt und macht den Fokus des Tages im Handeln greifbarer.",
  },
  fr: {
    meditation: "Cette courte meditation aide a rassembler l'attention et a donner plus de calme et de clarte pour la suite de la journee.",
    breath: "Cette pratique respiratoire apaise le systeme nerveux et soutient doucement le focus de la journee.",
    yoga: "Cette pratique donne plus d'appui au corps et rend le focus de la journee plus concret dans l'action.",
  },
  it: {
    meditation: "Questa breve meditazione aiuta a raccogliere l'attenzione e a portare piu calma e chiarezza al resto della giornata.",
    breath: "Questa pratica di respirazione stabilizza il sistema nervoso e sostiene con delicatezza il focus della giornata.",
    yoga: "Questa pratica da piu appoggio al corpo e rende il focus della giornata piu concreto nelle azioni.",
  },
  es: {
    meditation: "Esta meditacion breve ayuda a recoger la atencion y a dar mas calma y claridad al resto del dia.",
    breath: "Esta practica de respiracion calma el sistema nervioso y sostiene con suavidad el foco del dia.",
    yoga: "Esta practica da mas apoyo al cuerpo y vuelve mas concreto el foco del dia en las acciones.",
  },
  pt: {
    meditation: "Esta meditacao curta ajuda a recolher a atencao e a trazer mais calma e clareza para o resto do dia.",
    breath: "Esta pratica de respiracao acalma o sistema nervoso e sustenta com suavidade o foco do dia.",
    yoga: "Esta pratica da mais apoio ao corpo e torna o foco do dia mais concreto nas acoes.",
  },
  nl: {
    meditation: "Deze korte meditatie helpt de aandacht te bundelen en meer rust en helderheid in de rest van de dag te brengen.",
    breath: "Deze adempraktijk kalmeert het zenuwstelsel en ondersteunt op een zachte manier de focus van de dag.",
    yoga: "Deze praktijk geeft het lichaam meer steun en maakt de focus van de dag concreter in wat je doet.",
  },
};

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
  if (resolved !== SOURCE_LOCALE && resolved !== "en") {
    return GENERIC_CARD_TEXT[resolved][params.kind];
  }
  if (params.kind === "yoga") return GENERIC_CARD_TEXT[resolved].yoga;
  if (params.kind === "meditation") return GENERIC_CARD_TEXT[resolved].meditation;

  const slug = params.slug.trim();
  return resolved === "en"
    ? BREATH_CARD_EN[slug] ?? BREATH_CARD_EN.coherent
    : BREATH_CARD_RU[slug] ?? BREATH_CARD_RU.coherent;
}

export function buildPracticeAssistantReason(params: {
  kind: PracticeKindForCard;
  chakraIds: readonly number[];
  locale: string | null | undefined;
}): string {
  const resolved = asContentLocale(params.locale) ?? SOURCE_LOCALE;
  return GENERIC_REASON_TEXT[resolved][params.kind];
}
