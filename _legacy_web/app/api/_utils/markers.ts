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

export interface ValidationResult {
  confident: boolean;
  hasDuration: boolean;
  hasType: boolean;
}

export function validateHistoryHasDurationAndType(messages: MarkerMessage[]): ValidationResult {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content ?? "")
    .join(" ")
    .toLowerCase();

  const DURATION_NUMBER_UNITS = ["минут", "час"];

  const DURATION_PHRASES = [
    "полчаса", "пол часа", "пол-часа", "четверть часа",
    "не ограничен", "не лимитирован", "не лимит",
    "всё утро", "весь вечер", "весь день", "целый день",
    "любое время", "сколько угодно", "без ограничений",
    "всё время", "все время", "хоть сколько",
    "сколько нужно", "много времени",
  ];

  const TYPE_KEYWORDS = [
    "асан", "йог",
    "дыхан", "дыхательн", "пранаям",
    "медитац", "помедитировать", "посидеть", "успокоиться",
  ];

  const NUMBER_WORDS = [
    "один", "одну", "одна",
    "два", "две", "пару",
    "три", "четыре",
    "пять", "шесть", "семь", "восемь", "девять",
    "десять", "пятнадцать", "двадцать",
    "тридцать", "сорок", "пятьдесят", "полтора",
  ];

  const hasNumber =
    /\d+/.test(userText) ||
    NUMBER_WORDS.some((w) => userText.includes(w));

  const hasDuration =
    (hasNumber && DURATION_NUMBER_UNITS.some((u) => userText.includes(u)))
    || DURATION_PHRASES.some((p) => userText.includes(p));

  const hasType = TYPE_KEYWORDS.some((k) => userText.includes(k));

  return {
    confident: hasDuration && hasType,
    hasDuration,
    hasType,
  };
}

export function sanitizeAssistantText(text: string, locale?: string | null): string {
  let cleaned = stripReadyMarker(stripResponseMarkers(text));

  if ((locale ?? "").trim().toLowerCase().startsWith("ru") && /[А-Яа-яЁё]/.test(cleaned)) {
    cleaned = cleaned
      .replace(/\(\s*[^)\n]*\bhint\b[^)\n]*\)/gi, "")
      .replace(/^\s*\*\s*Call\s*$/gim, "")
      .replace(/\(\s*(?:[A-Za-z][A-Za-z'’.,!?;:/-]*\s+){2,}[A-Za-z][A-Za-z'’.,!?;:/-]*\s*\)/g, "");
  }

  return cleaned
    .replace(/\n\n,\s*/g, "\n\n")
    .replace(/[ \t]+,/g, ",")
    .replace(/([?.!])[ \t]*,/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
