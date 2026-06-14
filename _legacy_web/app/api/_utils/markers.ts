import {
  parseCompactCells,
  parseCompactPlanningSphereCells,
  type MatrixCell,
  type PlanningSphereCell,
} from "@legacy/app/api/_utils/lifeMatrix";

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
  recommendation: string | null;
  displayOrder: number | null;
  cells: PlanningSphereCell[];
  snippets: string[];
};

export type SummarizeEventMarker = {
  ref: string;
  outcome: string | null;
  outcomeCells: MatrixCell[];
};

export type CancelEventMarker = {
  ref: string;
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
    | "CANCEL_EVENT"
    | "MATRIX_CELLS";
  body: string;
  start: number;
  end: number;
};

const INTERNAL_MARKER_NAMES = [
  "STATE_PROPOSAL",
  "PRACTICE_PICK",
  "CORRECT_RECOMMENDATION",
  "PLANNED_EVENT",
  "SUMMARIZE_EVENT",
  "MATRIX_CELLS",
  "PLAN_TOMORROW",
  "READY_FOR_RECOMMENDATION",
] as const;

const INTERNAL_BARE_MARKER_RE = new RegExp(
  `\\[\\s*(?:${INTERNAL_MARKER_NAMES.join("|")})\\s*\\]`,
  "gi",
);

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
  const pattern = /\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|CANCEL_EVENT|MATRIX_CELLS):/gi;
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
  cancelEvents: CancelEventMarker[];
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
        recommendation: attrs.recommendation?.trim() || null,
        displayOrder: Number.isFinite(Number(attrs.display_order)) ? Number(attrs.display_order) : null,
        cells: parseCompactPlanningSphereCells(attrs.spheres?.trim() ? attrs.spheres : attrs.cells),
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

  const cancelEvents = parsedMarkers
    .filter((item) => item.name === "CANCEL_EVENT")
    .map((marker) => {
      const attrs = parseMarkerAttributes(marker.body);
      const ref = attrs.ref?.trim();
      if (!ref) return null;
      return { ref } satisfies CancelEventMarker;
    })
    .filter((item): item is CancelEventMarker => Boolean(item));

  const matrixCells = parsedMarkers
    .filter((item) => item.name === "MATRIX_CELLS")
    .flatMap((marker) => parseCompactCells(marker.body.trim()));

  const planTomorrow = /\[\s*PLAN_TOMORROW\s*\]/i.test(text);

  return { stateProposals, practicePick, recommendationCorrection, plannedEvents, summarizeEvents, cancelEvents, planTomorrow, matrixCells };
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
            recommendation: attrs.recommendation?.trim() || null,
            display_order: Number.isFinite(Number(attrs.display_order)) ? Number(attrs.display_order) : null,
            cells: parseCompactPlanningSphereCells(attrs.spheres?.trim() ? attrs.spheres : attrs.cells),
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
  if (!markers.length) return text.replace(INTERNAL_BARE_MARKER_RE, "").replace(/[ \t]+\n/g, "\n").trim();

  let out = "";
  let cursor = 0;
  for (const marker of markers) {
    out += text.slice(cursor, marker.start);
    cursor = marker.end;
  }
  out += text.slice(cursor);
  return out.replace(INTERNAL_BARE_MARKER_RE, "").replace(/[ \t]+\n/g, "\n").trim();
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
  /** True when duration minutes fit the v6 catalog range for the named practice kind. */
  catalogConsistent: boolean;
}

/** v6 dialog prompt catalog ranges (minutes). */
export function catalogDurationRangeForKind(kind: PracticeKindInferred): { min: number; max: number } {
  if (kind === "meditation") return { min: 1, max: 5 };
  if (kind === "breath") return { min: 5, max: 20 };
  return { min: 20, max: 70 };
}

export function isCatalogConsistentDurationAndKind(durationMin: number, kind: PracticeKindInferred): boolean {
  if (!Number.isFinite(durationMin)) return false;
  const range = catalogDurationRangeForKind(kind);
  const rounded = Math.max(1, Math.round(durationMin));
  return rounded >= range.min && rounded <= range.max;
}

/** Infer practice kind from duration alone (v6 duration-only heuristic). */
export function catalogKindForDurationMin(durationMin: number): PracticeKindInferred | null {
  const rounded = Math.max(1, Math.round(durationMin));
  if (rounded >= 1 && rounded <= 5) return "meditation";
  if (rounded >= 5 && rounded <= 20) return "breath";
  if (rounded >= 20) return "yoga";
  return null;
}

const CATALOG_KIND_LABELS_RU: Record<PracticeKindInferred, string> = {
  meditation: "медитация",
  breath: "дыхательная практика",
  yoga: "асаны",
};

/** Orchestrator add-on when user named type + duration that conflict with v6 catalog ranges. */
export function buildCatalogReconciliationInstruction(result: ValidationResult): string {
  if (!result.hasDuration || !result.hasType || result.catalogConsistent) return "";
  const durationMin = result.durationSec != null ? Math.round(result.durationSec / 60) : null;
  const kind = result.practiceKind;
  if (durationMin == null || kind == null) return "";

  const range = catalogDurationRangeForKind(kind);
  const kindLabel = CATALOG_KIND_LABELS_RU[kind];
  const altKind = catalogKindForDurationMin(durationMin);
  const altLabel = altKind ? CATALOG_KIND_LABELS_RU[altKind] : "другой тип практики";

  return `ВАЖНО ДЛЯ ЭТОГО ХОДА: пользователь уже назвал тип и длительность практики, но они не согласованы с каталогом приложения: ${kindLabel} — ${range.min}–${range.max} мин, запрошено ${durationMin} мин.

НЕ спрашивай, нужна ли практика вообще — пользователь уже попросил. НЕ выводи [READY_FOR_RECOMMENDATION] и [PRACTICE_PICK].

Одним коротким вопросом предложи выбор: сократить ${kindLabel} до ${range.max} мин или выбрать ${altLabel} на ${durationMin} мин. Сформулируй своими словами, смысл сохрани. Если ссылаешься на каталог или ограничения, говори «здесь» / «в приложении», не «там».`;
}

/** User answered the practice question (type + duration named), even if catalog ranges conflict. */
export function userAnsweredPracticeRequest(result: ValidationResult): boolean {
  return result.hasDuration && result.hasType;
}

const DURATION_NUMBER_UNITS = ["минут", "час", "min", "mins", "minute", "minutes", "hour", "hours"];

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

const MINIMUM_DURATION_HINT_PATTERNS: RegExp[] = [
  /коротк/i,
  /кратк/i,
  /миним/i,
  /минимальн/i,
  /небольш/i,
  /quick/i,
  /brief/i,
  /short/i,
  /minimal/i,
  /minimum/i,
];

const NUMBER_WORD_MAP: Record<string, number> = {
  "один": 1, "одну": 1, "одна": 1,
  "два": 2, "две": 2, "пару": 2,
  "три": 3, "четыре": 4,
  "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9,
  "десять": 10, "пятнадцать": 15, "двадцать": 20,
  "тридцать": 30, "сорок": 40, "пятьдесят": 50, "полтора": 1.5,
};

const TYPE_BREATH = ["дыхан", "дыхательн", "пранаям", "подыш", "дыш", "breath", "breathe", "breathwork"];
const TYPE_MEDITATION = ["медитац", "помедитировать", "посидеть", "успокоиться", "meditat", "meditate"];
const TYPE_YOGA = ["асан", "йог", "yoga", "asana"];

type TextSpan = {
  start: number;
  end: number;
};

type DurationMention = TextSpan & {
  sec: number;
};

type KindMention = TextSpan & {
  kind: PracticeKindInferred;
};

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

function addDurationMention(mentions: DurationMention[], start: number, end: number, sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return;
  mentions.push({ start, end, sec });
}

function extractKindMentions(text: string): KindMention[] {
  const mentions: KindMention[] = [];
  const patterns: Array<{ pattern: RegExp; kind: PracticeKindInferred }> = [
    { pattern: /медитац/gi, kind: "meditation" },
    { pattern: /помедитировать/gi, kind: "meditation" },
    { pattern: /посидеть/gi, kind: "meditation" },
    { pattern: /успокоиться/gi, kind: "meditation" },
    { pattern: /meditat/gi, kind: "meditation" },
    { pattern: /асан/gi, kind: "yoga" },
    { pattern: /йог/gi, kind: "yoga" },
    { pattern: /yoga/gi, kind: "yoga" },
    { pattern: /asana/gi, kind: "yoga" },
    { pattern: /дыхан/gi, kind: "breath" },
    { pattern: /дыхательн/gi, kind: "breath" },
    { pattern: /пранаям/gi, kind: "breath" },
    { pattern: /подыш/gi, kind: "breath" },
    { pattern: /дыш/gi, kind: "breath" },
    { pattern: /breathwork/gi, kind: "breath" },
    { pattern: /breathe/gi, kind: "breath" },
    { pattern: /breath/gi, kind: "breath" },
  ];
  for (const { pattern, kind } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (!value || start < 0) continue;
      mentions.push({ start, end: start + value.length, kind });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function distanceBetweenSpans(a: TextSpan, b: TextSpan): number {
  if (a.end <= b.start) return b.start - a.end;
  if (b.end <= a.start) return a.start - b.end;
  return 0;
}

function chooseKindMention(
  kindMentions: KindMention[],
  durationMentions: DurationMention[],
): KindMention | null {
  if (!kindMentions.length) return null;
  const anchor = durationMentions[durationMentions.length - 1] ?? null;
  if (!anchor) return kindMentions[kindMentions.length - 1] ?? null;

  let best: KindMention | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const mention of kindMentions) {
    const distance = distanceBetweenSpans(anchor, mention);
    if (
      !best
      || distance < bestDistance
      || (distance === bestDistance && mention.start > best.start)
    ) {
      best = mention;
      bestDistance = distance;
    }
  }
  return best;
}

function chooseDurationMention(
  mentions: DurationMention[],
  kindMentions: KindMention[],
  targetKind: PracticeKindInferred | null,
): DurationMention | null {
  if (!mentions.length) return null;
  const scopedKindMentions =
    targetKind != null
      ? kindMentions.filter((mention) => mention.kind === targetKind)
      : kindMentions;
  const anchorMentions = scopedKindMentions.length ? scopedKindMentions : kindMentions;
  if (!anchorMentions.length) return mentions[mentions.length - 1] ?? null;

  let best: DurationMention | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const mention of mentions) {
    const distance = anchorMentions.reduce((min, kind) => Math.min(min, distanceBetweenSpans(mention, kind)), Number.POSITIVE_INFINITY);
    if (
      !best
      || distance < bestDistance
      || (distance === bestDistance && mention.start > best.start)
    ) {
      best = mention;
      bestDistance = distance;
    }
  }
  return best;
}

function chooseTrailingMinuteMentionOverLeadingHour(params: {
  text: string;
  mentions: DurationMention[];
  selectedKindMention: KindMention | null;
}): DurationMention | null {
  const { text, mentions, selectedKindMention } = params;
  if (!selectedKindMention) return null;
  const leadingHour = mentions
    .filter((mention) =>
      mention.sec >= 3600
      && mention.end <= selectedKindMention.start
      && selectedKindMention.start - mention.end <= 6,
    )
    .at(-1);
  if (!leadingHour) return null;

  const trailingMinute = mentions.find((mention) =>
    mention.sec < 3600
    && mention.start >= selectedKindMention.end
    && mention.start - selectedKindMention.end <= 18,
  );
  if (!trailingMinute) return null;

  const bridgeToKind = text.slice(leadingHour.end, selectedKindMention.start);
  const bridgeToMinute = text.slice(selectedKindMention.end, trailingMinute.start);
  if (!/^[\s,:;.!?-]*$/u.test(bridgeToKind) || !/^[\s,:;.!?-]*$/u.test(bridgeToMinute)) return null;
  return trailingMinute;
}

function hasMinimumDurationHint(text: string): boolean {
  return MINIMUM_DURATION_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

function minimumDurationSecForKind(kind: PracticeKindInferred): number {
  const range = catalogDurationRangeForKind(kind);
  return range.min * 60;
}

function shouldPreferMinimumHintOverExplicitDuration(params: {
  text: string;
  bestDuration: DurationMention | null;
  selectedKindMention: KindMention | null;
  targetKind: PracticeKindInferred | null;
}): boolean {
  if (!params.bestDuration || !params.selectedKindMention || !params.targetKind) return false;
  if (!hasMinimumDurationHint(params.text)) return false;
  const distance = distanceBetweenSpans(params.bestDuration, params.selectedKindMention);
  return distance >= 18;
}

function extractDurationMentions(text: string): DurationMention[] {
  const mentions: DurationMention[] = [];

  for (const entry of DURATION_PHRASES) {
    const pattern = new RegExp(entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (!value || start < 0) continue;
      addDurationMention(mentions, start, start + value.length, entry.sec);
    }
  }

  for (const match of text.matchAll(/три\s+четверт(?:и|ь)\s*час(?:а|ов)?/gi)) {
    const value = match[0];
    const start = match.index ?? -1;
    if (!value || start < 0) continue;
    addDurationMention(mentions, start, start + value.length, 45 * 60);
  }

  for (const match of text.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*час(?:а|ов)?/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const num = Number.parseInt(match[1] ?? "", 10);
    const den = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) continue;
    addDurationMention(mentions, start, start + value.length, (num / den) * 3600);
  }

  for (const match of text.matchAll(/(?:^|\s)минут\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s|$|хот|[,.])/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const a = Number.parseInt(match[1] ?? "", 10);
    const b = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    addDurationMention(mentions, start, start + value.length, Math.round((a + b) / 2) * 60);
  }

  for (const match of text.matchAll(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(минут|мин\b)/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const a = Number.parseInt(match[1] ?? "", 10);
    const b = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    addDurationMention(mentions, start, start + value.length, Math.round((a + b) / 2) * 60);
  }

  for (const match of text.matchAll(/(минут(?:а|ы|у)?|мин\b|час(?:а|ов)?)\s*(\d{1,3}(?:[.,]\d+)?)/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const unit = match[1] ?? "";
    const num = Number.parseFloat((match[2] ?? "").replace(",", "."));
    if (!value || start < 0 || !Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час/i.test(unit) ? num * 3600 : num * 60);
  }

  for (const match of text.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*(минут(?:а|ы|у)?|мин\b|час(?:а|ов)?)/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const num = Number.parseFloat((match[1] ?? "").replace(",", "."));
    const unit = match[2] ?? "";
    if (!value || start < 0 || !Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час/i.test(unit) ? num * 3600 : num * 60);
  }

  const numberWordsAlternation = Object.keys(NUMBER_WORD_MAP)
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const wordDurationPattern = new RegExp(`(${numberWordsAlternation})\\s*(минут(?:а|ы|у)?|час(?:а|ов)?)`, "gi");
  for (const match of text.matchAll(wordDurationPattern)) {
    const start = match.index ?? -1;
    const value = match[0];
    const word = (match[1] ?? "").toLowerCase();
    const unit = match[2] ?? "";
    if (!value || start < 0) continue;
    if (/час/i.test(unit) && word === "три" && /\bчетверт/i.test(text)) continue;
    const num = NUMBER_WORD_MAP[word];
    if (!Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час/i.test(unit) ? num * 3600 : num * 60);
  }

  for (const match of text.matchAll(/(?:^|[\s,.;:!?()])(час(?:ик|а|ов)?)(?=$|[\s,.;:!?()])/gi)) {
    const value = match[1];
    const start = match.index ?? -1;
    if (!value || start < 0) continue;
    const offset = match[0].indexOf(value);
    const valueStart = start + Math.max(0, offset);
    addDurationMention(mentions, valueStart, valueStart + value.length, 3600);
  }

  return mentions
    .filter((mention, index, all) => {
      return !all.some((other, otherIndex) =>
        otherIndex !== index
        && other.start <= mention.start
        && other.end >= mention.end
        && (other.end - other.start) > (mention.end - mention.start)
      );
    })
    .sort((a, b) => a.start - b.start);
}

function inferDurationSecFromText(text: string): number | null {
  const noisyRussianTrailingMinutes = text.match(
    /(?:час(?:а|ов)?|\d{1,2}\s*час(?:а|ов)?)\s+(?:дыхан[а-яё]*|дыхательн[а-яё]*|пранаям[а-яё]*|медитац[а-яё]*|асан[а-яё]*|йог[а-яё]*)[\s,;:.!?-]*((?:\d+|[а-яё]+)\s*(?:минут(?:а|ы|у)?|мин\b))/i,
  );
  if (noisyRussianTrailingMinutes?.[1]) {
    const rescueMention = extractDurationMentions(noisyRussianTrailingMinutes[1]).find((mention) => mention.sec < 3600);
    if (rescueMention) return rescueMention.sec;
  }
  const mentions = extractDurationMentions(text);
  const kindMentions = extractKindMentions(text);
  const selectedKindMention = chooseKindMention(kindMentions, mentions);
  const targetKind = selectedKindMention?.kind ?? inferKindFromText(text, mentions);
  const rescuedTrailingMinute = chooseTrailingMinuteMentionOverLeadingHour({
    text,
    mentions,
    selectedKindMention,
  });
  if (rescuedTrailingMinute) return rescuedTrailingMinute.sec;
  const best = chooseDurationMention(mentions, kindMentions, targetKind);
  if (targetKind && hasMinimumDurationHint(text)) {
    if (shouldPreferMinimumHintOverExplicitDuration({
      text,
      bestDuration: best,
      selectedKindMention,
      targetKind,
    })) {
      return minimumDurationSecForKind(targetKind);
    }
  }
  if (best) return best.sec;
  if (targetKind && hasMinimumDurationHint(text)) {
    return minimumDurationSecForKind(targetKind);
  }
  return null;
}

function inferKindFromText(text: string, durationMentions?: DurationMention[]): PracticeKindInferred | null {
  const lower = text.toLowerCase();
  if (isBreathVersusOtherParallelOffer(lower)) return null;
  const kindMentions = extractKindMentions(text);
  return chooseKindMention(kindMentions, durationMentions ?? extractDurationMentions(text))?.kind ?? null;
}

function looksLikeClockTimeContext(text: string): boolean {
  return (
    /(?:^|[\s,.;:!?()])\d{1,2}\s*час(?:а|ов)?\s*(?:дня|утра|вечера|ночи)(?=$|[\s,.;:!?()])/i.test(text)
    || /(?:^|[\s,.;:!?()])в\s+\d{1,2}(?::\d{2})?(?=$|[\s,.;:!?()])/i.test(text)
    || /(?:^|[\s,.;:!?()])около\s+\d{1,2}(?::\d{2})?(?=$|[\s,.;:!?()])/i.test(text)
    || /(?:^|[\s,.;:!?()])(?:сегодня|завтра|послезавтра)\s+в\s+\d{1,2}(?::\d{2})?(?=$|[\s,.;:!?()])/i.test(text)
  );
}

const PRACTICE_DECLINE_PATTERNS: RegExp[] = [
  /практик\w*[\s\S]{0,56}(?:не\s+(?:хоч|буд)|не\s+нужн|не\s+буду)/i,
  /практик\w*[\s\S]{0,56}нет[\s\S]{0,24}времен/i,
  /(?:не\s+(?:хоч|буд)|не\s+буду|не\s+нужн)[\s\S]{0,56}практик/i,
  /(?:не\s+хоч|не\s+нужн|без)\w*[\s\S]{0,56}(?:асан|медитац|дыхан|пранаям|йог|практик)/i,
  /не\s+до\s+(?:каких[\s-]*либо\s+)?(?:асан|медитац|дыхан|пранаям|йог|практик)/i,
  /нет\s+времени[\s\S]{0,56}(?:на|для|под|делать|выполнять)?[\s\S]{0,24}(?:асан|медитац|дыхан|пранаям|йог|практик)/i,
  /времени[\s\S]{0,24}(?:на|для)?[\s\S]{0,16}(?:асан|медитац|дыхан|пранаям|йог|практик)[\s\S]{0,16}нет/i,
  /не\s+нужно[\s\S]{0,24}(?:предлагать|делать|давать)?[\s\S]{0,24}(?:асан|медитац|дыхан|пранаям|йог|практик)/i,
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

  let durationSec: number | null = null;
  let practiceKind: PracticeKindInferred | null = null;
  let latestConsistentPair: { durationSec: number; practiceKind: PracticeKindInferred } | null = null;
  for (const msg of userMessages) {
    const durationMentions = extractDurationMentions(msg);
    const k = inferKindFromText(msg, durationMentions);
    let d = inferDurationSecFromText(msg);
    if (k == null && d !== null && looksLikeClockTimeContext(msg)) {
      d = null;
    }
    if (d !== null) durationSec = d;
    if (k !== null) practiceKind = k;
    if (d !== null && k !== null && isCatalogConsistentDurationAndKind(Math.round(d / 60), k)) {
      latestConsistentPair = { durationSec: d, practiceKind: k };
    }
  }

  if (latestConsistentPair) {
    durationSec = latestConsistentPair.durationSec;
    practiceKind = latestConsistentPair.practiceKind;
  }

  const hasNumber =
    /\d+/.test(userText) ||
    NUMBER_WORDS.some((w) => userText.includes(w));

  const hasDuration =
    durationSec != null
    || (hasNumber && DURATION_NUMBER_UNITS.some((u) => userText.includes(u)))
    || DURATION_PHRASES.some((p) => userText.includes(p.phrase))
    || DURATION_PHRASES_NO_VALUE.some((p) => userText.includes(p));

  const hasType =
    TYPE_BREATH.some((k) => userText.includes(k))
    || TYPE_MEDITATION.some((k) => userText.includes(k))
    || TYPE_YOGA.some((k) => userText.includes(k));

  const durationMin = durationSec != null ? Math.round(durationSec / 60) : null;
  const catalogConsistent =
    durationMin != null
    && practiceKind != null
    && isCatalogConsistentDurationAndKind(durationMin, practiceKind);

  return {
    confident: hasDuration && hasType && catalogConsistent,
    hasDuration,
    hasType,
    durationSec,
    practiceKind,
    catalogConsistent,
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
