/**
 * Короткий текст для карточки практики в UI (1–2 предложения).
 * Не дублирует длинный therapist-style `reason` из маркера модели — тот остаётся
 * только внутри диалога; в карточку кладём структурированное краткое описание.
 *
 * Локали: ru / en. Дальше мультиязычие — вынести строки в JSON/i18n или params в БД.
 */

export type PracticeKindForCard = "breath" | "meditation" | "yoga";

const CHAKRA_NAME_RU: Record<number, string> = {
  1: "Муладхара",
  2: "Свадхистана",
  3: "Манипура",
  4: "Анахата",
  5: "Вишуддха",
  6: "Аджна",
  7: "Сахасрара",
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

function userRef(userMessage: string, locale: "ru" | "en"): string {
  const s = userMessage.replace(/\s+/g, " ").trim();
  if (!s) return locale === "en" ? "what you shared" : "том, что вы написали";
  const max = 100;
  const cut = s.length > max ? `${s.slice(0, max)}…` : s;
  return cut;
}

export function buildPracticeCardSummary(params: {
  kind: PracticeKindForCard;
  slug: string;
  chakraIds: readonly number[];
  locale: string | null | undefined;
  userMessage: string;
}): string {
  const locale: "ru" | "en" = params.locale?.toLowerCase().startsWith("en") ? "en" : "ru";
  const ref = userRef(params.userMessage, locale);
  const ch = chakraLine(params.chakraIds, locale);

  if (params.kind === "yoga") {
    if (locale === "en") {
      return `This asana sequence focuses on ${ch}—gentle work through the body tends to hold longer than a single conversation. It connects with ${ref}.`;
    }
    return `Эта серия асан опирается на зону ${ch}: через тело вы возвращаете устойчивость — эффект обычно глубже, чем от одного разговора. Рядом с тем, о чём вы написали: «${ref}».`;
  }

  if (params.kind === "meditation") {
    if (locale === "en") {
      return `A short meditation shifts attention inward—calm, imagery, and balance for the mind. It can hold what matters in: ${ref}.`;
    }
    return `Короткая медитация — спокойная работа с вниманием и образом, без давления на результат. Может мягко поддержать то, что вы переживаете в теме: «${ref}».`;
  }

  const slug = params.slug.trim();
  const breath =
    locale === "en"
      ? BREATH_CARD_EN[slug] ?? BREATH_CARD_EN.coherent
      : BREATH_CARD_RU[slug] ?? BREATH_CARD_RU.coherent;

  if (locale === "en") {
    return `${breath} It meets you where you are with: ${ref}.`;
  }
  return `${breath} Рядом с вашим запросом: «${ref}».`;
}
