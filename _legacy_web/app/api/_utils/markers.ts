import { parseCompactCells, type MatrixCell } from "@legacy/app/api/_utils/lifeMatrix";

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
  cardBlurb?: string | null;
};

export type RecommendationCorrectionMarker = {
  short_text?: string;
  windows_correction?: string;
};

export type PlannedEventMarker = {
  desc: string;
  time: string | null;
  timeNorm: string | null;
  cells: MatrixCell[];
  snippets: string[];
};

export type SummarizeEventMarker = {
  ref: string;
  outcome: string | null;
  outcomeCells: MatrixCell[];
};

type MarkerMessage = {
  role: "user" | "assistant" | "system";
  content?: string | null;
};

type ParsedMarker = {
  name:
    | "STATE_PROPOSAL"
    | "PRACTICE_PICK"
    | "CORRECT_RECOMMENDATION"
    | "PLANNED_EVENT"
    | "SUMMARIZE_EVENT"
    | "MATRIX_CELLS";
  body: string;
  start: number;
  end: number;
};

function closingQuoteFor(openingQuote: string): string {
  if (openingQuote === "«") return "»";
  if (openingQuote === "“") return "”";
  return openingQuote;
}

function isAttributeBoundary(source: string, index: number): boolean {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
  if (cursor >= source.length || source[cursor] === ",") return true;
  return /^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(source.slice(cursor));
}

function parseMarkerAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /[\s,]/.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;

    const keyMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(cursor));
    if (!keyMatch) {
      cursor += 1;
      continue;
    }
    const key = keyMatch[0];
    cursor += key.length;

    while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "=") continue;
    cursor += 1;

    while (cursor < source.length && /\s/.test(source[cursor] ?? "")) cursor += 1;
    const openingQuote = source[cursor];
    if (!openingQuote || ![`"`, `'`, "«", "“"].includes(openingQuote)) continue;
    const closingQuote = closingQuoteFor(openingQuote);
    cursor += 1;

    const valueStart = cursor;
    let valueEnd = -1;
    while (cursor < source.length) {
      if (source[cursor] === closingQuote && isAttributeBoundary(source, cursor + 1)) {
        valueEnd = cursor;
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    if (valueEnd === -1) break;
    attrs[key.toLowerCase()] = source.slice(valueStart, valueEnd).trim();
  }
  return attrs;
}

function findMarkerEnd(text: string, startIndex: number): number {
  let closingQuote: string | null = null;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (closingQuote) {
      if (char === closingQuote) closingQuote = null;
      continue;
    }
    if (char === `"` || char === `'` || char === "«" || char === "“") {
      closingQuote = closingQuoteFor(char);
      continue;
    }
    if (char === "]") return index;
  }
  return -1;
}

function parseMarkers(text: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  const pattern = /\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|MATRIX_CELLS):/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const name = match[1]?.toUpperCase() as ParsedMarker["name"] | undefined;
    if (!name) continue;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMarkerEnd(text, bodyStart);
    if (bodyEnd === -1) continue;
    markers.push({
      name,
      body: text.slice(bodyStart, bodyEnd),
      start: match.index,
      end: bodyEnd + 1,
    });
    pattern.lastIndex = bodyEnd + 1;
  }
  return markers;
}

export function parseResponseMarkers(text: string): {
  stateProposals: StateProposalMarker[];
  practicePick: PracticePickMarker | null;
  recommendationCorrection: RecommendationCorrectionMarker | null;
  plannedEvents: PlannedEventMarker[];
  summarizeEvents: SummarizeEventMarker[];
  planTomorrow: boolean;
  matrixCells: MatrixCell[];
} {
  const parsedMarkers = parseMarkers(text);
  const stateProposals: StateProposalMarker[] = [];
  for (const marker of parsedMarkers.filter((item) => item.name === "STATE_PROPOSAL")) {
    const attrs = parseMarkerAttributes(marker.body);
    const planet = attrs.planet?.trim();
    const label = attrs.label?.trim();
    const polarity = attrs.polarity?.trim();
    if (!planet || !label || (polarity !== "positive" && polarity !== "negative")) continue;
    stateProposals.push({
      proposed_planet: planet,
      proposed_label: label,
      proposed_polarity: polarity,
      trigger_phrase: attrs.trigger_phrase?.trim() ?? null,
    });
  }

  const practiceAttrs = parseMarkerAttributes(parsedMarkers.find((item) => item.name === "PRACTICE_PICK")?.body ?? "");
  const practiceId = practiceAttrs.id?.trim();
  const rawDuration = practiceAttrs.duration_min?.trim();
  const rawChakra = practiceAttrs.chakra?.trim();
  const parsedDuration = rawDuration ? Number(rawDuration) : NaN;
  const parsedChakra = rawChakra ? Number(rawChakra) : NaN;
  const practicePick = practiceId
    ? {
        id: practiceId,
        reason: practiceAttrs.reason?.trim(),
        durationMin: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
        chakra: Number.isInteger(parsedChakra) && parsedChakra >= 1 && parsedChakra <= 7 ? parsedChakra : null,
        cardBlurb: practiceAttrs.card_blurb?.trim() || null,
      }
    : null;

  const correctionAttrs = parseMarkerAttributes(parsedMarkers.find((item) => item.name === "CORRECT_RECOMMENDATION")?.body ?? "");
  const recommendationCorrection = Object.keys(correctionAttrs).length
    ? {
        short_text: correctionAttrs.short_text?.trim(),
        windows_correction: correctionAttrs.windows_correction?.trim(),
      }
    : null;

  const plannedEvents = parsedMarkers
    .filter((item) => item.name === "PLANNED_EVENT")
    .map((marker) => {
      const attrs = parseMarkerAttributes(marker.body);
      const desc = attrs.desc?.trim();
      if (!desc) return null;
      return {
        desc,
        time: attrs.time?.trim() || null,
        timeNorm: attrs.time_norm?.trim() || null,
        cells: parseCompactCells(attrs.cells),
        snippets: (attrs.snippets ?? "")
          .split(";")
          .map((item) => item.trim())
          .filter(Boolean),
      } satisfies PlannedEventMarker;
    })
    .filter((item): item is PlannedEventMarker => Boolean(item));

  const summarizeEvents = parsedMarkers
    .filter((item) => item.name === "SUMMARIZE_EVENT")
    .map((marker) => {
      const attrs = parseMarkerAttributes(marker.body);
      const ref = attrs.ref?.trim();
      if (!ref) return null;
      return {
        ref,
        outcome: attrs.outcome?.trim() || null,
        outcomeCells: parseCompactCells(attrs.outcome_cells),
      } satisfies SummarizeEventMarker;
    })
    .filter((item): item is SummarizeEventMarker => Boolean(item));

  const matrixCells = parsedMarkers
    .filter((item) => item.name === "MATRIX_CELLS")
    .flatMap((marker) => parseCompactCells(marker.body.trim()));

  const planTomorrow = /\[\s*PLAN_TOMORROW\s*\]/i.test(text);

  return { stateProposals, practicePick, recommendationCorrection, plannedEvents, summarizeEvents, planTomorrow, matrixCells };
}

export type DebugRawMarker = {
  type: string;
  raw: string;
  parsed?: unknown;
  parse_error?: string;
};

function parseDebugMarkerBody(type: string, body: string): { parsed?: unknown; parse_error?: string } {
  try {
    switch (type) {
      case "MATRIX_CELLS":
        return { parsed: parseCompactCells(body.trim()) };
      case "PLANNED_EVENT": {
        const attrs = parseMarkerAttributes(body);
        const desc = attrs.desc?.trim();
        if (!desc) return { parse_error: "missing desc" };
        return {
          parsed: {
            desc,
            time: attrs.time?.trim() || null,
            time_norm: attrs.time_norm?.trim() || null,
            cells: parseCompactCells(attrs.cells),
            snippets: (attrs.snippets ?? "")
              .split(";")
              .map((item) => item.trim())
              .filter(Boolean),
          },
        };
      }
      case "SUMMARIZE_EVENT": {
        const attrs = parseMarkerAttributes(body);
        const ref = attrs.ref?.trim();
        if (!ref) return { parse_error: "missing ref" };
        return {
          parsed: {
            ref,
            outcome: attrs.outcome?.trim() || null,
            outcome_cells: parseCompactCells(attrs.outcome_cells),
          },
        };
      }
      case "PRACTICE_PICK": {
        const attrs = parseMarkerAttributes(body);
        const id = attrs.id?.trim();
        if (!id) return { parse_error: "missing id" };
        const rawDuration = attrs.duration_min?.trim();
        const rawChakra = attrs.chakra?.trim();
        const parsedDuration = rawDuration ? Number(rawDuration) : NaN;
        const parsedChakra = rawChakra ? Number(rawChakra) : NaN;
        return {
          parsed: {
            id,
            reason: attrs.reason?.trim() || null,
            duration_min: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null,
            chakra: Number.isInteger(parsedChakra) && parsedChakra >= 1 && parsedChakra <= 7 ? parsedChakra : null,
            card_blurb: attrs.card_blurb?.trim() || null,
          },
        };
      }
      case "CORRECT_RECOMMENDATION": {
        const attrs = parseMarkerAttributes(body);
        return {
          parsed: {
            short_text: attrs.short_text?.trim() || null,
            windows_correction: attrs.windows_correction?.trim() || null,
          },
        };
      }
      case "STATE_PROPOSAL": {
        const attrs = parseMarkerAttributes(body);
        return { parsed: attrs };
      }
      default:
        return { parsed: body.trim() || null };
    }
  } catch (error) {
    return { parse_error: error instanceof Error ? error.message : String(error) };
  }
}

/** Extracts all invisible markers from raw model output for debug dialog export. */
export function extractRawMarkersForDebug(text: string): DebugRawMarker[] {
  const out: DebugRawMarker[] = [];
  const parsedMarkers = parseMarkers(text);
  for (const marker of parsedMarkers) {
    const raw = text.slice(marker.start, marker.end);
    const { parsed, parse_error } = parseDebugMarkerBody(marker.name, marker.body);
    out.push({
      type: marker.name,
      raw,
      ...(parse_error ? { parse_error } : { parsed }),
    });
  }

  const readyMatch = /\[\s*READY_FOR_RECOMMENDATION\s*\]/i.exec(text);
  if (readyMatch) {
    out.push({ type: "READY_FOR_RECOMMENDATION", raw: readyMatch[0], parsed: true });
  }

  const planTomorrowMatch = /\[\s*PLAN_TOMORROW\s*\]/i.exec(text);
  if (planTomorrowMatch) {
    out.push({ type: "PLAN_TOMORROW", raw: planTomorrowMatch[0], parsed: true });
  }

  return out;
}

export function stripResponseMarkers(text: string): string {
  const markers = parseMarkers(text);
  if (!markers.length) return text.replace(/\[\s*PLAN_TOMORROW\s*\]/gi, "").replace(/[ \t]+\n/g, "\n").trim();

  let out = "";
  let cursor = 0;
  for (const marker of markers) {
    out += text.slice(cursor, marker.start);
    cursor = marker.end;
  }
  out += text.slice(cursor);
  return out.replace(/\[\s*PLAN_TOMORROW\s*\]/gi, "").replace(/[ \t]+\n/g, "\n").trim();
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

const PRACTICE_DECLINE_PATTERNS: RegExp[] = [
  /практик\w*[\s\S]{0,56}(?:не\s+(?:хоч|буд)|не\s+нужн|не\s+буду)/i,
  /(?:не\s+(?:хоч|буд)|не\s+буду|не\s+нужн)[\s\S]{0,56}практик/i,
  /никак\w*\s+практик/i,
  /практик\w*\s+совсем\s+не\s+нужн/i,
  /(?:не\s+хоч|не\s+буд)\w*\s+(?:сейчас\s+)?(?:выполнять\s+)?(?:асан|медитац|дыхан|пранаям|йог)/i,
  /(?:некогда|не\s+сейчас)\b/i,
  /(?:no|not)\s+(?:time|now)\s+(?:for\s+)?practice/i,
  /(?:don['’]t|do not)\s+want\s+(?:any\s+)?practice/i,
];

/** True when user clearly declined any practice for this session (not merely one type). */
export function userDeclinedPracticeInHistory(userTexts: string[]): boolean {
  const combined = userTexts.map((t) => t.trim()).filter(Boolean).join("\n").toLowerCase();
  if (!combined) return false;
  return PRACTICE_DECLINE_PATTERNS.some((pattern) => pattern.test(combined));
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
