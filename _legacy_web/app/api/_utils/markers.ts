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

const XML_ATTRIBUTED_MARKER_NAMES = [
  "STATE_PROPOSAL",
  "PRACTICE_PICK",
  "CORRECT_RECOMMENDATION",
  "PLANNED_EVENT",
  "SUMMARIZE_EVENT",
  "SIMULATE_EVENT",
  "CANCEL_EVENT",
  "MATRIX_CELLS",
] as const;

const XML_ALL_MARKER_NAMES = [
  ...XML_ATTRIBUTED_MARKER_NAMES,
  "PRACTICE_DECLINED",
  "PLAN_TOMORROW",
  "READY_FOR_RECOMMENDATION",
  "BRANCH_DONE",
] as const;

const INTERNAL_BARE_MARKER_RE = new RegExp(
  `\\[\\s*(?:${INTERNAL_MARKER_NAMES.join("|")})\\s*\\]`,
  "gi",
);

const XML_MARKER_NAME_ALT = XML_ALL_MARKER_NAMES.join("|");
const XML_OPEN_OR_CLOSE_RE = new RegExp(`<\\/?\\s*(?:${XML_MARKER_NAME_ALT})\\b`, "i");
const LEAKED_PROTOCOL_ATTR_RE =
  /\b(?:display_order|short_text|time_norm|outcome_cells|card_blurb|windows_correction|duration_min)\s*=/i;
const LEAKED_SPHERES_ATTR_RE = /\bspheres\s*=\s*["']?\d/i;

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

function findUnquotedChar(text: string, startIndex: number, target: string): number {
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
    if (char === target) return index;
  }
  return -1;
}

function canonicalMarkerName(rawName: string): ParsedMarker["name"] | null {
  const name = rawName.toUpperCase();
  if (name === "SIMULATE_EVENT") return "SUMMARIZE_EVENT";
  if (
    name === "STATE_PROPOSAL"
    || name === "PRACTICE_PICK"
    || name === "CORRECT_RECOMMENDATION"
    || name === "PLANNED_EVENT"
    || name === "SUMMARIZE_EVENT"
    || name === "CANCEL_EVENT"
    || name === "MATRIX_CELLS"
  ) {
    return name;
  }
  return null;
}

function escapeMarkerAttr(value: string): string {
  return value.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}

function xmlBodyFromAttrsAndInner(attrs: string, inner: string, name: ParsedMarker["name"]): string {
  const trimmedInner = inner.replace(/\s+/g, " ").trim();
  if (!trimmedInner) return attrs.trim();
  const parsed = parseMarkerAttributes(attrs);
  if (name === "CORRECT_RECOMMENDATION" && !parsed.short_text) {
    return `${attrs} short_text="${escapeMarkerAttr(trimmedInner)}"`.trim();
  }
  if (name === "PLANNED_EVENT" && !parsed.desc) {
    return `${attrs} desc="${escapeMarkerAttr(trimmedInner)}"`.trim();
  }
  if (name === "SUMMARIZE_EVENT" && !parsed.outcome) {
    return `${attrs} outcome="${escapeMarkerAttr(trimmedInner)}"`.trim();
  }
  if (name === "PRACTICE_PICK" && !parsed.reason) {
    return `${attrs} reason="${escapeMarkerAttr(trimmedInner)}"`.trim();
  }
  if (name === "CANCEL_EVENT" && !parsed.ref) {
    return `${attrs} ref="${escapeMarkerAttr(trimmedInner)}"`.trim();
  }
  return attrs.trim();
}

function findClosingXmlTag(text: string, fromIndex: number, rawName: string): { start: number; end: number } | null {
  const pattern = new RegExp(`<\\/\\s*${rawName}\\s*>`, "ig");
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function parseXmlStyleMarkers(text: string, baseOffset = 0): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  const pattern = new RegExp(`<\\s*(${XML_ATTRIBUTED_MARKER_NAMES.join("|")})\\b`, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const rawName = match[1]?.toUpperCase();
    if (!rawName) continue;
    const name = canonicalMarkerName(rawName);
    if (!name) continue;
    const afterName = match.index + match[0].length;
    const openEnd = findUnquotedChar(text, afterName, ">");
    if (openEnd === -1) continue;
    const between = text.slice(afterName, openEnd);
    const selfClosing = /\/\s*$/.test(between);
    const attrs = between.replace(/\/\s*$/, "").trim();
    let end = openEnd + 1;
    let inner = "";
    if (!selfClosing) {
      const close = findClosingXmlTag(text, openEnd + 1, rawName);
      if (close) {
        inner = text.slice(openEnd + 1, close.start);
        end = close.end;
        markers.push(...parseXmlStyleMarkers(inner, baseOffset + openEnd + 1));
      }
    }
    markers.push({
      name,
      body: xmlBodyFromAttrsAndInner(attrs, inner, name),
      start: baseOffset + match.index,
      end: baseOffset + end,
    });
    pattern.lastIndex = end;
  }
  return markers;
}

function parseBracketMarkers(text: string): ParsedMarker[] {
  const markers: ParsedMarker[] = [];
  // SIMULATE_EVENT is a known LLM typo/alias for SUMMARIZE_EVENT — parse + strip it the same way.
  const pattern = /\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|SIMULATE_EVENT|CANCEL_EVENT|MATRIX_CELLS):/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const rawName = match[1]?.toUpperCase();
    const name = rawName ? canonicalMarkerName(rawName) : null;
    if (!name) continue;
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMarkerEnd(text, bodyStart);
    if (bodyEnd !== -1) {
      markers.push({
        name,
        body: text.slice(bodyStart, bodyEnd),
        start: match.index,
        end: bodyEnd + 1,
      });
      pattern.lastIndex = bodyEnd + 1;
      continue;
    }
    // Hybrid leak: `[PLANNED_EVENT: attrs></PLANNED_EVENT>` (square open, XML close).
    const openEnd = findUnquotedChar(text, bodyStart, ">");
    if (openEnd === -1) continue;
    const close = findClosingXmlTag(text, openEnd + 1, rawName ?? name);
    const end = close ? close.end : openEnd + 1;
    const between = text.slice(bodyStart, openEnd).replace(/\/\s*$/, "");
    markers.push({
      name,
      body: xmlBodyFromAttrsAndInner(between, close ? text.slice(openEnd + 1, close.start) : "", name),
      start: match.index,
      end,
    });
    pattern.lastIndex = end;
  }
  return markers;
}

function parseMarkers(text: string): ParsedMarker[] {
  return [...parseBracketMarkers(text), ...parseXmlStyleMarkers(text)]
    .sort((a, b) => a.start - b.start || (b.end - a.end) - (a.end - b.end));
}

function outermostMarkerRanges(markers: ParsedMarker[]): ParsedMarker[] {
  const sorted = [...markers].sort((a, b) => a.start - b.start || (b.end - a.end) - (a.end - b.end));
  const out: ParsedMarker[] = [];
  let coverEnd = -1;
  for (const marker of sorted) {
    if (marker.start < coverEnd) continue;
    out.push(marker);
    coverEnd = marker.end;
  }
  return out;
}

function stripIncompleteSquareMarkers(text: string): string {
  const pattern = /\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|SIMULATE_EVENT|CANCEL_EVENT|MATRIX_CELLS):/gi;
  const ranges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const rawName = match[1]?.toUpperCase();
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMarkerEnd(text, bodyStart);
    if (bodyEnd !== -1) {
      pattern.lastIndex = bodyEnd + 1;
      continue;
    }
    const rest = text.slice(match.index);
    const xmlCloseMatch = rest.match(new RegExp(`<\\/\\s*(?:${rawName ?? XML_MARKER_NAME_ALT})\\s*>`, "i"));
    const xmlClose = xmlCloseMatch?.index ?? -1;
    const openEnd = findUnquotedChar(text, bodyStart, ">");
    let cut = rest.length;
    if (xmlClose >= 0 && xmlCloseMatch) {
      cut = xmlClose + xmlCloseMatch[0].length;
    } else if (openEnd >= 0) {
      cut = openEnd + 1 - match.index;
    } else {
      const nextBreak = rest.search(/\n\n/);
      if (nextBreak >= 0) cut = nextBreak;
    }
    ranges.push({ start: match.index, end: match.index + cut });
    break;
  }
  if (!ranges.length) return text;
  let out = text;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, range.start)}${out.slice(range.end)}`;
  }
  return out;
}

/** True when visible assistant text still contains protocol markup the user must never see. */
export function visibleTextHasLeakedDialogMarkup(text: string): boolean {
  const value = (text ?? "").trim();
  if (!value) return false;
  if (XML_OPEN_OR_CLOSE_RE.test(value)) return true;
  if (/\[\s*(?:STATE_PROPOSAL|PRACTICE_PICK|PRACTICE_DECLINED|CORRECT_RECOMMENDATION|PLANNED_EVENT|SUMMARIZE_EVENT|SIMULATE_EVENT|CANCEL_EVENT|MATRIX_CELLS|PLAN_TOMORROW|READY_FOR_RECOMMENDATION|BRANCH_DONE)\b/i.test(value)) {
    return true;
  }
  return LEAKED_PROTOCOL_ATTR_RE.test(value) || LEAKED_SPHERES_ATTR_RE.test(value);
}

/** Residual XML/attribute fragments after well-formed markers were stripped. */
export function stripLeakedDialogMarkup(text: string): string {
  let t = stripIncompleteSquareMarkers(text.replace(/\r\n/g, "\n"));
  t = t.replace(new RegExp(`<\\/\\s*(?:${XML_MARKER_NAME_ALT})\\s*>`, "gi"), "");
  t = t.replace(/\b(?:display_order|short_text|time_norm|outcome_cells|card_blurb|windows_correction|duration_min)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>]+)/gi, "");
  t = t.replace(/\b(?:desc|recommendation|spheres|cells|ref|outcome|id|reason|chakra)\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  t = t.replace(/\bspheres\s*=\s*\d[\d.:;]*/gi, "");
  const xmlOpen = new RegExp(`<\\s*(?:${XML_MARKER_NAME_ALT})\\b`, "gi");
  let match: RegExpExecArray | null;
  const ranges: Array<{ start: number; end: number }> = [];
  while ((match = xmlOpen.exec(t))) {
    const openEnd = findUnquotedChar(t, match.index + match[0].length, ">");
    if (openEnd === -1) {
      ranges.push({ start: match.index, end: t.length });
      break;
    }
    ranges.push({ start: match.index, end: openEnd + 1 });
    xmlOpen.lastIndex = openEnd + 1;
  }
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    t = `${t.slice(0, range.start)}${t.slice(range.end)}`;
  }
  return t
    .replace(/<\/?\s*>/g, "")
    .replace(/(?:^|\n)\s*>\s*(?=\n|$)/g, "\n")
    .replace(/^\s*>\s*/, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
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

  const planTomorrow = /\[\s*PLAN_TOMORROW\s*\]/i.test(text) || /<\s*PLAN_TOMORROW\b/i.test(text);

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
  const markers = outermostMarkerRanges(parseMarkers(text));
  if (!markers.length) {
    return stripLeakedDialogMarkup(text.replace(INTERNAL_BARE_MARKER_RE, ""));
  }

  let out = "";
  let cursor = 0;
  for (const marker of markers) {
    out += text.slice(cursor, marker.start);
    cursor = marker.end;
  }
  out += text.slice(cursor);
  return stripLeakedDialogMarkup(out.replace(INTERNAL_BARE_MARKER_RE, ""));
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

const DURATION_NUMBER_UNITS = ["минут", "час", "min", "mins", "minute", "minutes", "minuto", "minuti", "hour", "hours", "ora", "ore"];

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
  /court/i,
  /courte/i,
  /breve/i,
  /kurz/i,
  /klein/i,
  /pequen/i,
  /cort/i,
  /curt/i,
  /minim[aeo]/i,
  /kort/i,
];

const NUMBER_WORD_MAP: Record<string, number> = {
  "один": 1, "одну": 1, "одна": 1,
  "два": 2, "две": 2, "пару": 2,
  "три": 3, "четыре": 4,
  "пять": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9,
  "десять": 10, "пятнадцать": 15, "двадцать": 20,
  "тридцать": 30, "сорок": 40, "пятьдесят": 50, "полтора": 1.5,
  "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
  "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
  "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
  "un": 1, "una": 1, "uno": 1,
  "due": 2, "tre": 3, "quattro": 4, "cinque": 5,
  "sei": 6, "sette": 7, "otto": 8, "nove": 9,
  "dieci": 10, "quindici": 15, "venti": 20,
  "trenta": 30, "quaranta": 40, "cinquanta": 50,
  "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5,
  "sept": 7, "huit": 8, "neuf": 9, "dix": 10,
  "quinze": 15, "vingt": 20, "trente": 30, "quarante": 40, "cinquante": 50,
  "ein": 1, "eine": 1, "eins": 1, "zwei": 2, "drei": 3, "vier": 4, "funf": 5, "fuenf": 5,
  "sechs": 6, "sieben": 7, "acht": 8, "neun": 9, "zehn": 10, "funfzehn": 15, "fuenfzehn": 15,
  "zwanzig": 20, "dreissig": 30, "dreißig": 30, "vierzig": 40, "funfzig": 50, "fuenfzig": 50,
  "um": 1, "uma": 1, "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5,
  "sete": 7, "oito": 8, "vinte": 20, "quarenta": 40,
  "een": 1, "twee": 2, "drie": 3, "vijf": 5, "zes": 6,
  "zeven": 7, "negen": 9, "tien": 10, "vijftien": 15, "twintig": 20,
  "dertig": 30, "veertig": 40, "vijftig": 50,
};

const TYPE_BREATH = [
  "дыхан", "дыхательн", "пранаям", "подыш", "дыш",
  "breath", "breathe", "breathwork",
  "respiraz", "respiro", "respiracion", "respiracao",
  "respiration", "atem", "atmen", "adem", "ademhaling",
];
const TYPE_MEDITATION = [
  "медитац", "помедитировать", "посидеть", "успокоиться",
  "meditat", "meditate", "meditaz", "meditation", "meditacion", "meditacao",
];
const TYPE_YOGA = ["асан", "йог", "yoga", "asana", "asanas"];

const MINUTE_UNITS_PATTERN = String.raw`(?:минут(?:а|ы|у)?|мин\b|minute(?:s)?|minut(?:e|en)?|minuut|minuten|minuto(?:s)?|minuti|minutos?)`;
const HOUR_UNITS_PATTERN = String.raw`(?:час(?:а|ов)?|hour(?:s)?|ora|ore|heure(?:s)?|stunde(?:n)?|hora(?:s)?|uur|uren)`;

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

function normalizeLocaleParsingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[àáâãäå]/g, "a")
    .replace(/æ/g, "ae")
    .replace(/ç/g, "c")
    .replace(/[èéêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/ñ/g, "n")
    .replace(/[òóôõö]/g, "o")
    .replace(/œ/g, "oe")
    .replace(/[ùúûü]/g, "u")
    .replace(/[ýÿ]/g, "y")
    .replace(/ß/g, "ss");
}

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
  const normalizedText = normalizeLocaleParsingText(text);
  const mentions: KindMention[] = [];
  const patterns: Array<{ pattern: RegExp; kind: PracticeKindInferred }> = [
    { pattern: /медитац/gi, kind: "meditation" },
    { pattern: /помедитировать/gi, kind: "meditation" },
    { pattern: /посидеть/gi, kind: "meditation" },
    { pattern: /успокоиться/gi, kind: "meditation" },
    { pattern: /meditat/gi, kind: "meditation" },
    { pattern: /meditaz/gi, kind: "meditation" },
    { pattern: /meditacion/gi, kind: "meditation" },
    { pattern: /meditacao/gi, kind: "meditation" },
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
    { pattern: /respiraz/gi, kind: "breath" },
    { pattern: /respiro/gi, kind: "breath" },
    { pattern: /respiracion/gi, kind: "breath" },
    { pattern: /respiracao/gi, kind: "breath" },
    { pattern: /respiration/gi, kind: "breath" },
    { pattern: /atmen/gi, kind: "breath" },
    { pattern: /atem/gi, kind: "breath" },
    { pattern: /ademhaling/gi, kind: "breath" },
    { pattern: /adem/gi, kind: "breath" },
  ];
  for (const { pattern, kind } of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (!value || start < 0) continue;
      mentions.push({ start, end: start + value.length, kind });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

function hasGenericYogaCue(text: string): boolean {
  const normalized = normalizeLocaleParsingText(text);
  return /\byoga\b/i.test(normalized)
    && !/\basana(?:s)?\b/i.test(normalized)
    && !TYPE_MEDITATION.some((stem) => normalized.includes(stem))
    && !TYPE_BREATH.some((stem) => normalized.includes(stem));
}

function normalizePracticeKindForCatalog(params: {
  text: string;
  practiceKind: PracticeKindInferred | null;
  durationSec: number | null;
}): PracticeKindInferred | null {
  const { text, practiceKind, durationSec } = params;
  if (practiceKind !== "yoga" || durationSec == null) return practiceKind;
  if (!hasGenericYogaCue(text)) return practiceKind;
  const routedKind = catalogKindForDurationMin(Math.round(durationSec / 60));
  return routedKind ?? practiceKind;
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
  const normalizedText = normalizeLocaleParsingText(text);
  const mentions: DurationMention[] = [];

  for (const entry of DURATION_PHRASES) {
    const pattern = new RegExp(entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of normalizedText.matchAll(pattern)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (!value || start < 0) continue;
      addDurationMention(mentions, start, start + value.length, entry.sec);
    }
  }

  for (const match of normalizedText.matchAll(/три\s+четверт(?:и|ь)\s*час(?:а|ов)?|three\s+quarters?\s+of\s+an?\s+hour|trois\s+quarts?\s+d[' ]heure|dreiviertel\s+stunde|tres\s+cuartos?\s+de\s+hora|tres\s+quartos?\s+de\s+hora|driekwart\s+uur/gi)) {
    const value = match[0];
    const start = match.index ?? -1;
    if (!value || start < 0) continue;
    addDurationMention(mentions, start, start + value.length, 45 * 60);
  }

  for (const match of normalizedText.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:час(?:а|ов)?|hour(?:s)?|heure(?:s)?|stunde(?:n)?|hora(?:s)?|uur|uren)/gi)) {
    const start = match.index ?? -1;
    const value = match[0];
    const num = Number.parseInt(match[1] ?? "", 10);
    const den = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) continue;
    addDurationMention(mentions, start, start + value.length, (num / den) * 3600);
  }

  for (const match of normalizedText.matchAll(new RegExp(String.raw`(?:^|\s)${MINUTE_UNITS_PATTERN}\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s|$|хот|[,.])`, "gi"))) {
    const start = match.index ?? -1;
    const value = match[0];
    const a = Number.parseInt(match[1] ?? "", 10);
    const b = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    addDurationMention(mentions, start, start + value.length, Math.round((a + b) / 2) * 60);
  }

  for (const match of normalizedText.matchAll(new RegExp(String.raw`(\d{1,2})\s*[-–]\s*(\d{1,2})\s*${MINUTE_UNITS_PATTERN}`, "gi"))) {
    const start = match.index ?? -1;
    const value = match[0];
    const a = Number.parseInt(match[1] ?? "", 10);
    const b = Number.parseInt(match[2] ?? "", 10);
    if (!value || start < 0 || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    addDurationMention(mentions, start, start + value.length, Math.round((a + b) / 2) * 60);
  }

  for (const match of normalizedText.matchAll(new RegExp(String.raw`(${MINUTE_UNITS_PATTERN}|${HOUR_UNITS_PATTERN})\s*(\d{1,3}(?:[.,]\d+)?)`, "gi"))) {
    const start = match.index ?? -1;
    const value = match[0];
    const unit = match[1] ?? "";
    const num = Number.parseFloat((match[2] ?? "").replace(",", "."));
    if (!value || start < 0 || !Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час|hour|ora|ore|heure|stunde|hora|uur|uren/i.test(unit) ? num * 3600 : num * 60);
  }

  for (const match of normalizedText.matchAll(new RegExp(String.raw`(\d{1,3}(?:[.,]\d+)?)\s*(${MINUTE_UNITS_PATTERN}|${HOUR_UNITS_PATTERN})`, "gi"))) {
    const start = match.index ?? -1;
    const value = match[0];
    const num = Number.parseFloat((match[1] ?? "").replace(",", "."));
    const unit = match[2] ?? "";
    if (!value || start < 0 || !Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час|hour|ora|ore|heure|stunde|hora|uur|uren/i.test(unit) ? num * 3600 : num * 60);
  }

  const numberWordsAlternation = Object.keys(NUMBER_WORD_MAP)
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const wordDurationPattern = new RegExp(`(${numberWordsAlternation})\\s*(${MINUTE_UNITS_PATTERN}|${HOUR_UNITS_PATTERN})`, "gi");
  for (const match of normalizedText.matchAll(wordDurationPattern)) {
    const start = match.index ?? -1;
    const value = match[0];
    const word = (match[1] ?? "").toLowerCase();
    const unit = match[2] ?? "";
    if (!value || start < 0) continue;
    if (/час/i.test(unit) && word === "три" && /\bчетверт/i.test(normalizedText)) continue;
    const num = NUMBER_WORD_MAP[word];
    if (!Number.isFinite(num) || num <= 0) continue;
    addDurationMention(mentions, start, start + value.length, /час|hour|ora|ore|heure|stunde|hora|uur|uren/i.test(unit) ? num * 3600 : num * 60);
  }

  for (const match of normalizedText.matchAll(/(?:^|[\s,.;:!?()])(час(?:ик|а|ов)?|hour|ora|heure|stunde|uur)(?=$|[\s,.;:!?()])/gi)) {
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
  const normalizedText = normalizeLocaleParsingText(text);
  const noisyRussianTrailingMinutes = normalizedText.match(
    /(?:час(?:а|ов)?|\d{1,2}\s*час(?:а|ов)?)\s+(?:дыхан[а-яё]*|дыхательн[а-яё]*|пранаям[а-яё]*|медитац[а-яё]*|асан[а-яё]*|йог[а-яё]*)[\s,;:.!?-]*((?:\d+|[а-яё]+)\s*(?:минут(?:а|ы|у)?|мин\b))/i,
  );
  if (noisyRussianTrailingMinutes?.[1]) {
    const rescueMention = extractDurationMentions(noisyRussianTrailingMinutes[1]).find((mention) => mention.sec < 3600);
    if (rescueMention) return rescueMention.sec;
  }
  const mentions = extractDurationMentions(normalizedText);
  const kindMentions = extractKindMentions(normalizedText);
  const selectedKindMention = chooseKindMention(kindMentions, mentions);
  const targetKind = selectedKindMention?.kind ?? inferKindFromText(normalizedText, mentions);
  const rescuedTrailingMinute = chooseTrailingMinuteMentionOverLeadingHour({
    text: normalizedText,
    mentions,
    selectedKindMention,
  });
  if (rescuedTrailingMinute) return rescuedTrailingMinute.sec;
  const best = chooseDurationMention(mentions, kindMentions, targetKind);
  if (targetKind && hasMinimumDurationHint(normalizedText)) {
    if (shouldPreferMinimumHintOverExplicitDuration({
      text: normalizedText,
      bestDuration: best,
      selectedKindMention,
      targetKind,
    })) {
      return minimumDurationSecForKind(targetKind);
    }
  }
  if (best) return best.sec;
  if (targetKind && hasMinimumDurationHint(normalizedText)) {
    return minimumDurationSecForKind(targetKind);
  }
  return null;
}

function inferKindFromText(text: string, durationMentions?: DurationMention[]): PracticeKindInferred | null {
  const lower = normalizeLocaleParsingText(text);
  if (isBreathVersusOtherParallelOffer(lower)) return null;
  const kindMentions = extractKindMentions(lower);
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
    .map((m) => normalizeLocaleParsingText(m.content ?? ""));
  const userText = userMessages.join(" ");

  const NUMBER_WORDS = Object.keys(NUMBER_WORD_MAP);

  let durationSec: number | null = null;
  let practiceKind: PracticeKindInferred | null = null;
  let latestConsistentPair: { durationSec: number; practiceKind: PracticeKindInferred } | null = null;
  for (const msg of userMessages) {
    const durationMentions = extractDurationMentions(msg);
    let k = inferKindFromText(msg, durationMentions);
    let d = inferDurationSecFromText(msg);
    if (k == null && d !== null && looksLikeClockTimeContext(msg)) {
      d = null;
    }
    k = normalizePracticeKindForCatalog({ text: msg, practiceKind: k, durationSec: d });
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
  cleaned = stripLeakedDialogMarkup(cleaned);

  if ((locale ?? "").trim().toLowerCase().startsWith("ru") && /[А-Яа-яЁё]/.test(cleaned)) {
    cleaned = cleaned
      .replace(/\(\s*[^)\n]*\bhint\b[^)\n]*\)/gi, "")
      .replace(/^\s*\*\s*Call\s*$/gim, "")
      .replace(/\(\s*(?:[A-Za-z][A-Za-z'’.,!?;:/-]*\s+){2,}[A-Za-z][A-Za-z'’.,!?;:/-]*\s*\)/g, "");
  }

  cleaned = stripDialogScaffoldMarkdown(cleaned);
  cleaned = stripLeakedDialogMarkup(cleaned);

  return cleaned
    .replace(/\n\n,\s*/g, "\n\n")
    .replace(/[ \t]+,/g, ",")
    .replace(/([?.!])[ \t]*,/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}
