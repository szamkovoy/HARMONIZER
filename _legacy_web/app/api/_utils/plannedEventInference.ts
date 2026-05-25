import type { DateTime } from "luxon";

import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import { validateHistoryHasDurationAndType } from "@legacy/app/api/_utils/markers";
import { parseEventTime } from "@legacy/app/api/_utils/timeParser";

type HistoryMessage = {
  role: string;
  content?: string | null;
  transcript?: string | null;
};

function userText(message: HistoryMessage): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

function splitEventSegments(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/(?<=[.!?])\s+|\s+[,;]\s+|\s+—\s+|\s+–\s+|\s+поэтому\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 6);

  return parts.length > 0 ? parts : [normalized];
}

function stripMatchedPhrase(text: string, matchedPhrase: string | null): string {
  if (!matchedPhrase?.trim()) return text.trim();
  const escaped = matchedPhrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "i"), "").replace(/\s+/g, " ").trim();
}

function normalizeDescription(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDurationOnlyReply(text: string): boolean {
  return /^\d{1,2}\s*минут(?:у|ы|а|)?\.?$/i.test(text.trim());
}

function isPracticeOnlySegment(text: string, nowLocal: DateTime, tz: string, locale: string): boolean {
  if (isDurationOnlyReply(text)) return true;
  const validation = validateHistoryHasDurationAndType([{ role: "user", content: text }]);
  const parsed = parseEventTime({
    phrase: text,
    nowLocal,
    tz,
    locale,
  });
  if (validation.confident) {
    if (parsed.resolution === "fallback_default" || !parsed.matchedPhrase) return true;
    if (/^\d{1,2}\s*(?:-|–|—|до)\s*\d{1,2}$/.test(parsed.matchedPhrase.trim())) return true;
  }
  return false;
}

function buildEventDescription(segment: string, matchedPhrase: string | null): string | null {
  let description = stripMatchedPhrase(segment, matchedPhrase)
    .replace(/^(?:у меня|мне|я)\s+/i, "")
    .replace(/^(?:сегодня|завтра|послезавтра)\s+/i, "")
    .trim();

  if (!description) {
    description = stripMatchedPhrase(segment, matchedPhrase);
  }

  description = description.replace(/\s+/g, " ").replace(/[,.;:!?]+$/g, "").trim();
  return description.length >= 4 ? description : null;
}

function dedupeKey(desc: string, expectedLocalIso: string): string {
  return `${normalizeDescription(desc)}|${expectedLocalIso.slice(0, 16)}`;
}

export function filterNewPlannedEvents(
  events: PlannedEventMarker[],
  existing: Array<{ description: string }>,
): PlannedEventMarker[] {
  const existingNorm = new Set(existing.map((row) => normalizeDescription(row.description)));
  return events.filter((event) => !existingNorm.has(normalizeDescription(event.desc)));
}

export function mergePlannedEventMarkers(
  modelEvents: PlannedEventMarker[],
  inferredEvents: PlannedEventMarker[],
): PlannedEventMarker[] {
  const merged: PlannedEventMarker[] = [];
  const seen = new Set<string>();

  for (const event of [...modelEvents, ...inferredEvents]) {
    const key = `${normalizeDescription(event.desc)}|${(event.time ?? event.timeNorm ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return merged;
}

export function inferPlannedEventsFromUserHistory(params: {
  history: HistoryMessage[];
  pendingUserMessage?: string | null;
  nowLocal: DateTime;
  tz: string;
  locale: string;
}): PlannedEventMarker[] {
  const userTexts = [
    ...params.history.filter((message) => message.role === "user").map(userText),
    ...(params.pendingUserMessage?.trim() ? [params.pendingUserMessage.trim()] : []),
  ].filter(Boolean);

  const inferred: PlannedEventMarker[] = [];
  const seen = new Set<string>();

  for (const text of userTexts) {
    const segmentCandidates: Array<{ event: PlannedEventMarker; expectedKey: string; descLen: number }> = [];

    for (const segment of splitEventSegments(text)) {
      if (isPracticeOnlySegment(segment, params.nowLocal, params.tz, params.locale)) continue;

      const parsed = parseEventTime({
        phrase: segment,
        nowLocal: params.nowLocal,
        tz: params.tz,
        locale: params.locale,
      });
      if (parsed.resolution === "fallback_default" || !parsed.matchedPhrase) continue;
      if (parsed.resolution === "daypart_default" && segment.split(/\s+/).filter(Boolean).length < 4) continue;

      const desc = buildEventDescription(segment, parsed.matchedPhrase);
      if (!desc) continue;

      const expectedKey = parsed.expectedLocal.toFormat("yyyy-MM-dd'T'HH:mm");
      segmentCandidates.push({
        event: {
          desc,
          time: parsed.matchedPhrase,
          timeNorm: null,
          cells: [],
          snippets: [segment.slice(0, 240)],
        },
        expectedKey,
        descLen: desc.length,
      });
    }

    const bestByTime = new Map<string, { event: PlannedEventMarker; descLen: number }>();
    for (const candidate of segmentCandidates) {
      const existing = bestByTime.get(candidate.expectedKey);
      if (!existing || candidate.descLen < existing.descLen) {
        bestByTime.set(candidate.expectedKey, { event: candidate.event, descLen: candidate.descLen });
      }
    }

    for (const { event } of bestByTime.values()) {
      const key = dedupeKey(event.desc, event.time ?? "");
      if (seen.has(key)) continue;
      seen.add(key);
      inferred.push(event);
    }
  }

  return inferred;
}
