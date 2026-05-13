export type StateProposalMarker = {
  proposed_planet: string;
  proposed_label: string;
  proposed_polarity: "positive" | "negative";
  trigger_phrase?: string | null;
};

export type PracticePickMarker = {
  id: string;
  reason?: string;
  durationMin?: number | null;
  chakra?: number | null;
};

export type RecommendationCorrectionMarker = {
  short_text?: string;
  windows_correction?: string;
};

type MarkerMessage = {
  role: "user" | "assistant" | "system";
  content?: string | null;
};

function attr(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`${name}\\s*=\\s*["“”']([^"“”']+)["“”']`, "i"));
  return match?.[1]?.trim();
}

export function parseResponseMarkers(text: string): {
  stateProposals: StateProposalMarker[];
  practicePick: PracticePickMarker | null;
  recommendationCorrection: RecommendationCorrectionMarker | null;
} {
  const stateProposals: StateProposalMarker[] = [];
  for (const match of text.matchAll(/\[STATE_PROPOSAL:\s*([^\]]+)\]/gi)) {
    const raw = match[1] ?? "";
    const planet = attr(raw, "planet");
    const label = attr(raw, "label");
    const polarity = attr(raw, "polarity");
    if (!planet || !label || (polarity !== "positive" && polarity !== "negative")) continue;
    stateProposals.push({
      proposed_planet: planet,
      proposed_label: label,
      proposed_polarity: polarity,
      trigger_phrase: attr(raw, "trigger_phrase") ?? null,
    });
  }

  const practiceRaw = text.match(/\[PRACTICE_PICK:\s*([^\]]+)\]/i)?.[1] ?? "";
  const practiceId = attr(practiceRaw, "id");
  const rawDuration = attr(practiceRaw, "duration_min");
  const rawChakra = attr(practiceRaw, "chakra");
  const parsedDuration = rawDuration ? Number(rawDuration) : NaN;
  const parsedChakra = rawChakra ? Number(rawChakra) : NaN;
  const practicePick = practiceId
    ? {
        id: practiceId,
        reason: attr(practiceRaw, "reason"),
        durationMin: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
        chakra: Number.isInteger(parsedChakra) && parsedChakra >= 1 && parsedChakra <= 7 ? parsedChakra : null,
      }
    : null;

  const correctionRaw = text.match(/\[CORRECT_RECOMMENDATION:\s*([^\]]+)\]/i)?.[1] ?? "";
  const recommendationCorrection = correctionRaw
    ? {
        short_text: attr(correctionRaw, "short_text"),
        windows_correction: attr(correctionRaw, "windows_correction"),
      }
    : null;

  return { stateProposals, practicePick, recommendationCorrection };
}

export function stripResponseMarkers(text: string): string {
  return text
    .replace(/\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION):[^\]]+\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function containsReadyMarker(text: string): boolean {
  return /\[\s*ready_for_recommendation\s*\]/i.test(text);
}

export function stripReadyMarker(text: string): string {
  return text.replace(/\[\s*ready_for_recommendation\s*\]/gi, "").trim();
}

export type PracticeKindInferred = "breath" | "meditation" | "yoga";

export interface ValidationResult {
  confident: boolean;
  hasDuration: boolean;
  hasType: boolean;
  durationSec: number | null;
  practiceKind: PracticeKindInferred | null;
}

const DURATION_NUMBER_UNITS = ["минут", "час"];

const DURATION_PHRASES: Array<{ phrase: string; sec: number }> = [
  { phrase: "полчаса", sec: 30 * 60 },
  { phrase: "пол часа", sec: 30 * 60 },
  { phrase: "пол-часа", sec: 30 * 60 },
  { phrase: "четверть часа", sec: 15 * 60 },
];

const DURATION_PHRASES_NO_VALUE = [
  "не ограничен", "не лимитирован", "не лимит",
  "всё утро", "весь вечер", "весь день", "целый день",
  "любое время", "сколько угодно", "без ограничений",
  "всё время", "все время", "хоть сколько",
  "сколько нужно", "много времени",
];

const NUMBER_WORD_MAP: Record<string, number> = {
  "один": 1, "одну": 1, "одна": 1,
  "два": 2, "две": 2, "пару": 2,
  "три": 3, "четыре": 4,
  "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9,
  "десять": 10, "пятнадцать": 15, "двадцать": 20,
  "тридцать": 30, "сорок": 40, "пятьдесят": 50, "полтора": 1.5,
};

const TYPE_BREATH = ["дыхан", "дыхательн", "пранаям", "подыш", "дыш"];
const TYPE_MEDITATION = ["медитац", "помедитировать", "посидеть", "успокоиться"];
const TYPE_YOGA = ["асан", "йог"];

/** «Подышать или через тело» — не выбор только дыхания; не перетираем ранее сказанное «йога/асаны». */
function isBreathVersusOtherParallelOffer(lower: string): boolean {
  const hasBreathCue = /(?:дыхан|дыхательн|пранаям|подышат)/.test(lower);
  // JS `\b` is ASCII-only for «word» chars — Cyrillic «тело» / «или» never get boundaries; use explicit delimiters.
  const hasBodyViaTelo = /(?:через\s+)?тел(?:о|а|ом|е)?(?:\s|$|[,.!?…])/i.test(lower);
  const hasOtherCue =
    hasBodyViaTelo || /асан/.test(lower) || /йог/.test(lower) || /медитац/.test(lower);
  if (!hasBreathCue || !hasOtherCue) return false;
  return /(?:^|[\s,.;:!?()])или(?:$|[\s,.;:!?()])/i.test(lower);
}

function inferDurationSecFromText(text: string): number | null {
  for (const entry of DURATION_PHRASES) {
    if (text.includes(entry.phrase)) return entry.sec;
  }

  // «Три четверти часа» = 45 мин (без \b — JS \b не считает кириллицу «словом»).
  if (/три\s+четверт[иь]\s*час/i.test(text)) return 45 * 60;

  const rangeMinutPrefix = text.match(/(?:^|\s)минут\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s|$|хот|[,.])/i);
  if (rangeMinutPrefix) {
    const a = Number.parseInt(rangeMinutPrefix[1] ?? "", 10);
    const b = Number.parseInt(rangeMinutPrefix[2] ?? "", 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return Math.round((a + b) / 2) * 60;
    }
  }
  const rangeWithUnit = text.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(минут|мин\b)/i);
  if (rangeWithUnit) {
    const a = Number.parseInt(rangeWithUnit[1] ?? "", 10);
    const b = Number.parseInt(rangeWithUnit[2] ?? "", 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return Math.round((a + b) / 2) * 60;
    }
  }

  const digitMatch = text.match(/(\d{1,3})\s*(минут|мин\b|час)/i);
  if (digitMatch) {
    const num = Number.parseInt(digitMatch[1] ?? "", 10);
    if (Number.isFinite(num) && num > 0) {
      return /час/i.test(digitMatch[2] ?? "") ? num * 3600 : num * 60;
    }
  }

  if (!digitMatch && /(?:^|\s)час(?:\s|$|ик|а|ов)/i.test(text)) return 3600;

  for (const [word, num] of Object.entries(NUMBER_WORD_MAP)) {
    for (const unit of DURATION_NUMBER_UNITS) {
      if (!text.includes(word) || !text.includes(unit)) continue;
      if (/час/.test(unit) && word === "три" && /\bчетверт/i.test(text)) continue;
      return /час/.test(unit) ? num * 3600 : num * 60;
    }
  }

  return null;
}

function inferKindFromText(text: string): PracticeKindInferred | null {
  const lower = text.toLowerCase();
  if (TYPE_MEDITATION.some((k) => lower.includes(k))) return "meditation";
  if (TYPE_YOGA.some((k) => lower.includes(k))) return "yoga";
  if (isBreathVersusOtherParallelOffer(lower)) return null;
  if (TYPE_BREATH.some((k) => lower.includes(k))) return "breath";
  return null;
}

export function validateHistoryHasDurationAndType(messages: MarkerMessage[]): ValidationResult {
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => (m.content ?? "").toLowerCase());
  const userText = userMessages.join(" ");

  const NUMBER_WORDS = Object.keys(NUMBER_WORD_MAP);

  const hasNumber =
    /\d+/.test(userText) ||
    NUMBER_WORDS.some((w) => userText.includes(w));

  const hasDuration =
    (hasNumber && DURATION_NUMBER_UNITS.some((u) => userText.includes(u)))
    || DURATION_PHRASES.some((p) => userText.includes(p.phrase))
    || DURATION_PHRASES_NO_VALUE.some((p) => userText.includes(p));

  const hasType =
    TYPE_BREATH.some((k) => userText.includes(k))
    || TYPE_MEDITATION.some((k) => userText.includes(k))
    || TYPE_YOGA.some((k) => userText.includes(k));

  let durationSec: number | null = null;
  let practiceKind: PracticeKindInferred | null = null;
  for (const msg of userMessages) {
    const d = inferDurationSecFromText(msg);
    if (d !== null) durationSec = d;
    const k = inferKindFromText(msg);
    if (k !== null) practiceKind = k;
  }

  return {
    confident: hasDuration && hasType,
    hasDuration,
    hasType,
    durationSec,
    practiceKind,
  };
}

/** Убирает «служебную» разметку диалога: `---` и целиком блоки `**…**` (заголовки секций модель кладёт туда — без разворачивания в текст). */
export function stripDialogScaffoldMarkdown(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = t.replace(/^\s*-{3,}\s*$/gm, "");
  for (let i = 0; i < 16; i++) {
    const prev = t;
    t = t.replace(/\*\*[^*]+\*\*/g, "");
    if (t === prev) break;
  }
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export function sanitizeAssistantText(text: string, locale?: string | null): string {
  let cleaned = stripReadyMarker(stripResponseMarkers(text));

  if ((locale ?? "").trim().toLowerCase().startsWith("ru") && /[А-Яа-яЁё]/.test(cleaned)) {
    cleaned = cleaned
      .replace(/\(\s*[^)\n]*\bhint\b[^)\n]*\)/gi, "")
      .replace(/^\s*\*\s*Call\s*$/gim, "")
      .replace(/\(\s*(?:[A-Za-z][A-Za-z'’.,!?;:/-]*\s+){2,}[A-Za-z][A-Za-z'’.,!?;:/-]*\s*\)/g, "");
  }

  cleaned = stripDialogScaffoldMarkdown(cleaned);

  return cleaned
    .replace(/\n\n,\s*/g, "\n\n")
    .replace(/[ \t]+,/g, ",")
    .replace(/([?.!])[ \t]*,/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
