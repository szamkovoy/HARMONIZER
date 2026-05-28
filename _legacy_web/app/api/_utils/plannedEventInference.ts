import { DateTime } from "luxon";

import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import { validateHistoryHasDurationAndType } from "@legacy/app/api/_utils/markers";
import { parseEventTime } from "@legacy/app/api/_utils/timeParser";

type HistoryMessage = {
  role: string;
  content?: string | null;
  transcript?: string | null;
};

const MAX_HISTORY_MESSAGES_FOR_PLANNING_INFERENCE = 4;

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

  if (parts.length === 0) return [normalized];

  const shiftTrailingTimeLead = [...parts];
  for (let index = 0; index < shiftTrailingTimeLead.length - 1; index += 1) {
    const current = shiftTrailingTimeLead[index]!;
    const next = shiftTrailingTimeLead[index + 1]!;
    const match = current.match(/^(.*?)(?:\s+|^)((?:сегодня|завтра|послезавтра)\s+)?(утром|днем|днём|вечером|ночью)$/i);
    if (!match) continue;
    const head = (match[1] ?? "").trim();
    const carry = `${match[2] ?? ""}${match[3] ?? ""}`.trim();
    if (!head || !carry) continue;
    shiftTrailingTimeLead[index] = head;
    shiftTrailingTimeLead[index + 1] = `${carry} ${next}`.trim();
  }

  const merged: string[] = [];
  for (let index = 0; index < shiftTrailingTimeLead.length; index += 1) {
    let current = shiftTrailingTimeLead[index]!;
    while (index + 1 < shiftTrailingTimeLead.length) {
      const next = shiftTrailingTimeLead[index + 1]!;
      if (
        /^(?:(?:сегодня|завтра|послезавтра)\s+)?(?:утром|днем|днём|вечером|ночью)\b/i.test(current)
        || /^(?:перед|после)\b/i.test(current)
        || /^(?:может быть|возможно|наверное|думаю|ну|да)\b/i.test(current)
      ) {
        current = `${current} ${next}`.trim();
        index += 1;
        continue;
      }
      break;
    }
    if (
      /^(?:относительно|насчет|насч[её]т|по поводу)\b/i.test(current)
      && index + 1 < shiftTrailingTimeLead.length
    ) {
      merged.push(`${current} ${shiftTrailingTimeLead[index + 1]!}`.trim());
      index += 1;
      continue;
    }
    if (
      merged.length > 0
      && /^(?:примерно|около)\s+в\s+\d{1,2}(?:[:.]\d{2})\b/i.test(current)
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${current}`.trim();
      continue;
    }
    merged.push(current);
  }

  return merged;
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

const EVENT_IDENTITY_STOPWORDS = new Set([
  "сегодня",
  "завтра",
  "послезавтра",
  "потому",
  "потомучто",
  "во",
  "первых",
  "воервых",
  "да",
  "ну",
  "а",
  "и",
  "или",
  "но",
  "что",
  "это",
  "этот",
  "эта",
  "эту",
  "очень",
  "просто",
  "правда",
  "не",
  "знаю",
  "получится",
  "сложится",
  "временем",
  "потом",
  "позже",
  "будет",
  "нужно",
  "надо",
  "мне",
  "меня",
  "моих",
  "моим",
  "моему",
  "хочу",
  "хотел",
  "хотела",
  "хотелбы",
  "хотелабы",
  "предстоит",
  "договорились",
  "некоторое",
  "некоторую",
  "некоторый",
  "вообще",
  "потом",
  "далее",
  "время",
  "времени",
  "пройдет",
  "пройдёт",
  "пройти",
  "проходит",
  "пойду",
  "пойти",
  "иду",
  "идти",
  "пойдет",
  "пойдёт",
  "пойдем",
  "пойдём",
  "схожу",
  "сходить",
  "поеду",
  "поехать",
  "ехать",
  "собираюсь",
]);

function identityStem(token: string): string {
  const normalized = token.toLowerCase().replace(/ё/g, "е");
  if (/^(?:встреч|встрет)/.test(normalized)) return "встреч";
  if (/^(?:клиент)/.test(normalized)) return "клиент";
  if (/^(?:позавтрак|завтрак)/.test(normalized)) return "завтрак";
  if (/^(?:театр|спектак)/.test(normalized)) return "театр";
  if (/^(?:фильм|кино|сериал)/.test(normalized)) return "фильм";
  if (/^(?:магаз)/.test(normalized)) return "магаз";
  if (/^(?:удоч|спиннинг)/.test(normalized)) return "рыбал";
  return normalized.slice(0, 6);
}

function eventIdentityTokens(value: string): string[] {
  const seen = new Set<string>();
  for (const rawToken of normalizeDescription(value).split(/\s+/)) {
    const token = rawToken.trim();
    if (!token || token.length < 4) continue;
    if (EVENT_IDENTITY_STOPWORDS.has(token)) continue;
    seen.add(identityStem(token));
  }
  return [...seen];
}

export function samePlannedEventIdentity(left: string, right: string): boolean {
  if (normalizeDescription(left) === normalizeDescription(right)) return true;
  const leftTokens = eventIdentityTokens(left);
  const rightTokens = eventIdentityTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token));
  if (overlap.length >= 2) return true;
  return overlap.length === 1 && (leftTokens.length === 1 || rightTokens.length === 1);
}

export type ExistingPlannedEventLike = {
  id?: string;
  description: string;
  expected_at: string;
  planned_local_date: string;
  time_resolution: string;
};

export type PlannedEventExistingMatchResult = "same" | "ambiguous_time_conflict" | null;

export function matchPlannedEventAgainstExisting(params: {
  existing: ExistingPlannedEventLike;
  incomingDescription: string;
  incomingParsedTime: ReturnType<typeof parseEventTime>;
  timezone: string;
}): PlannedEventExistingMatchResult {
  if (!samePlannedEventIdentity(params.existing.description, params.incomingDescription)) return null;
  if (params.existing.planned_local_date !== params.incomingParsedTime.expectedLocal.toFormat("yyyy-MM-dd")) return null;
  const existingLocal = DateTime.fromISO(params.existing.expected_at, { zone: params.timezone }).setZone(params.timezone);
  if (!existingLocal.isValid) return null;
  const sameMinute =
    existingLocal.toFormat("yyyy-MM-dd'T'HH:mm")
    === params.incomingParsedTime.expectedLocal.toFormat("yyyy-MM-dd'T'HH:mm");
  const oneSideHasLooseTime =
    params.existing.time_resolution !== "explicit"
    || params.incomingParsedTime.resolution !== "explicit";
  if (sameMinute || oneSideHasLooseTime) return "same";
  return "ambiguous_time_conflict";
}

function isDurationOnlyReply(text: string): boolean {
  return /^\d{1,2}\s*минут(?:у|ы|а|)?\.?$/i.test(text.trim());
}

function stripTrailingPracticeClause(text: string): string {
  const match = text.match(/^(.*?)(?:[,;]\s*|\s+)(?:а\s+пока|а\s+потом|а\s+позже|и\s+потом)(?=$|[\s,.;:!?()])([\s\S]*)$/i);
  if (!match) return text;
  const head = match[1]?.trim() ?? text;
  const tail = match[2] ?? "";
  if (/(?:предлож|практик|медитац|дыха|дыхательн|асан|йог)/i.test(tail)) {
    return head;
  }
  return text;
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

function hasStrongPlanningCue(text: string): boolean {
  return /(?:^|[\s,.;:!?()])(?:(?:хочу|планирую|собираюсь|соберусь|предстоит|намечен(?:о|а|ы)?|нужно|надо|пора)|хотел(?:\s+бы)?|хотела(?:\s+бы)?|погуляю|посмотрю|выберу|поеду|пойду|лягу|лечь)(?=$|[\s,.;:!?()])/i.test(text);
}

function looksLikeCompletedOutcomeSegment(text: string): boolean {
  return /(?:^|[\s,.;:!?()])(?:выспал(?:ся|ась|ись)|успел(?:а|и)?|купил(?:а|и)?|куплен(?:о|а|ы)?|получил(?:а|и)?|удалось|удался|удалась|удались|сложил(?:ось|ся)|прош[её]л(?:а|и)?|отдохнул(?:а|и)?|лег(?:ла|ли)?|л[её]г(?:ла|ли)?|рад(?:ует|овал(?:а|и)?)|довол(?:ен|ьна|ьны))/i.test(text);
}

function isCausalSupportingSegment(
  text: string,
  parsed: ReturnType<typeof parseEventTime>,
): boolean {
  if (parsed.matchedPhrase) return false;
  if (!/^\s*(?:потому\s+что|так\s+как)(?=$|[\s,.;:!?()])/i.test(text)) return false;
  return /(?:^|[\s,.;:!?()])(?:нужно|надо|важно|полезно)(?=$|[\s,.;:!?()])/i.test(text);
}

function isGenericWorkloadSegment(
  text: string,
  parsed: ReturnType<typeof parseEventTime>,
): boolean {
  if (parsed.matchedPhrase || parsed.resolution !== "fallback_default") return false;
  return /^(?:да,\s*)?(?:нужно\s+)?поработать(?:,\s*много\s+дел)?(?:,\s*я\s+не\s+знаю\s+как\s+пойд[её]т\s+вс[её])?\.?$/i.test(text.trim());
}

function inferImplicitTimeNorm(segment: string, locale: string): string | null {
  const lower = segment.toLowerCase();
  const localeSafe = locale.toLowerCase().startsWith("en") ? "en" : "ru";
  const hasTomorrow = /(?:^|[\s,.;:!?()])завтра(?=$|[\s,.;:!?()])/i.test(segment);
  const hasDayAfterTomorrow = /(?:^|[\s,.;:!?()])послезавтра(?=$|[\s,.;:!?()])/i.test(segment);
  const dayToken =
    hasDayAfterTomorrow ? (localeSafe === "en" ? "day after tomorrow" : "послезавтра")
      : hasTomorrow ? (localeSafe === "en" ? "tomorrow" : "завтра")
        : (localeSafe === "en" ? "today" : "сегодня");

  // Leisure-like plans without an explicit time are safer to place in the evening.
  if (/(?:фильм|кино|сериал|театр|спектакл|концерт|ужин|ресторан|отдохн|отдых|свидан|вечер)/i.test(lower)) {
    return localeSafe === "en" ? `${dayToken} evening` : `${dayToken} вечером`;
  }

  if (/(?:позавтрак|завтрак|завтрака)/i.test(lower)) {
    return localeSafe === "en" ? `${dayToken} morning` : `${dayToken} утром`;
  }

  return null;
}

function buildEventDescription(segment: string, matchedPhrase: string | null): string | null {
  let description = stripMatchedPhrase(segment, matchedPhrase)
    .replace(/^(?:у меня|мне|я)\s+/i, "")
    .replace(/^(?:сегодня|завтра|послезавтра)\s+/i, "")
    .replace(/^(?:и\s+главное|главное|а\s+до\s+этого|до\s+этого)\s*,?\s*/i, "")
    .trim();

  if (!description) {
    description = stripMatchedPhrase(segment, matchedPhrase);
  }

  description = stripTrailingPracticeClause(description)
    .replace(/^(?:да|ну)\s*,?\s*/i, "")
    .replace(/^(?:а\s+еще|а\s+ещё)\s+/i, "")
    .replace(/^(?:я\s+)?(?:думаю|надеюсь)\s*,?\s*что\s+/i, "")
    .replace(/^(?:я\s+)?(?:думаю|надеюсь)\s*,?\s*/i, "")
    .replace(/^(?:у меня|мне|я)\s+/i, "")
    .replace(/^(?:сегодня\s+)?предстоит\s+[^,]+,\s*/i, "")
    .replace(/^(?:потому\s+что\s*,?\s*)?(?:во-?\s*первых\s*,?\s*)?/i, "")
    .replace(/^(?:относительно|насчет|насч[её]т|по поводу)\s+/i, "")
    .replace(/(?:[,;]\s*|\s+)(?:а\s+пока|а\s+потом|а\s+позже|и\s+потом)(?=$|[\s,.;:!?()]).*(?:предлож|практик|медитац|дыхат|дыхательн|асан|йог)/i, "")
    .replace(/(?:[,;]\s*|\s+)(?:правда\s+не\s+знаю|если\s+получится|там\s+видно\s+будет).*/i, "")
    .replace(/(?:[,;]\s*|\s+)сложится\s+со\s+временем\s+или\s+нет.*$/i, "")
    .replace(/(^|[\s,.;:!?()])(?:примерно|где[-\s]*то|около)(?=$|[\s,.;:!?()])/gi, "$1")
    .replace(/^(?:я\s+)?(?:хотелось\s+бы|хочу|планирую|собираюсь|хотел(?:\s+бы)?|хотела(?:\s+бы)?)\s+/i, "")
    .replace(/(?:^|[\s,.;:!?()])(?:сегодня|завтра|послезавтра)(?=$|[\s,.;:!?()])/gi, " ")
    .replace(/(^|[\s,.;:!?()])(?:во-?\s*первых|во-?\s*вторых)(?=$|[\s,.;:!?()])/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/[,.;:!?]+$/g, "")
    .trim();
  if (/^лечь$/i.test(description)) description = "лечь спать";
  return description.length >= 4 ? description : null;
}

function dedupeKey(desc: string, expectedLocalIso: string): string {
  return `${normalizeDescription(desc)}|${expectedLocalIso.slice(0, 16)}`;
}

export function filterNewPlannedEvents(
  events: PlannedEventMarker[],
  existing: ExistingPlannedEventLike[],
  options?: {
    nowLocal?: DateTime;
    relativeNowLocal?: DateTime;
    tz?: string;
    locale?: string;
  },
): PlannedEventMarker[] {
  if (!existing.length) return events;
  const timezone = options?.tz;
  const nowLocal = options?.nowLocal;
  const locale = options?.locale;
  return events.filter((event) => {
    const exactDescriptionMatch = existing.some((row) => normalizeDescription(row.description) === normalizeDescription(event.desc));
    if (exactDescriptionMatch) return false;
    if (!timezone || !nowLocal || !locale) return true;
    const incomingParsedTime = parseEventTime({
      phrase: event.timeNorm ?? event.time ?? event.desc,
      nowLocal,
      relativeNowLocal: options?.relativeNowLocal,
      tz: timezone,
      locale,
    });
    return !existing.some((row) => matchPlannedEventAgainstExisting({
      existing: row,
      incomingDescription: event.desc,
      incomingParsedTime,
      timezone,
    }) === "same");
  });
}

export function mergePlannedEventMarkers(
  modelEvents: PlannedEventMarker[],
  inferredEvents: PlannedEventMarker[],
  options?: {
    nowLocal?: DateTime;
    relativeNowLocal?: DateTime;
    tz?: string;
    locale?: string;
  },
): PlannedEventMarker[] {
  const merged: PlannedEventMarker[] = [];

  for (const event of [...modelEvents, ...inferredEvents]) {
    const duplicate = merged.some((existing) => {
      if (!samePlannedEventIdentity(existing.desc, event.desc)) return false;
      if (!options?.nowLocal || !options.tz || !options.locale) return true;
      const existingParsed = parseEventTime({
        phrase: existing.timeNorm ?? existing.time ?? existing.desc,
        nowLocal: options.nowLocal,
        relativeNowLocal: options.relativeNowLocal,
        tz: options.tz,
        locale: options.locale,
      });
      const incomingParsed = parseEventTime({
        phrase: event.timeNorm ?? event.time ?? event.desc,
        nowLocal: options.nowLocal,
        relativeNowLocal: options.relativeNowLocal,
        tz: options.tz,
        locale: options.locale,
      });
      const sameLocalDay = existingParsed.expectedLocal.hasSame(incomingParsed.expectedLocal, "day");
      const sameMinute =
        existingParsed.expectedLocal.toFormat("yyyy-MM-dd'T'HH:mm")
        === incomingParsed.expectedLocal.toFormat("yyyy-MM-dd'T'HH:mm");
      const oneSideHasLooseTime =
        existingParsed.resolution !== "explicit"
        || incomingParsed.resolution !== "explicit";
      return sameLocalDay && (sameMinute || oneSideHasLooseTime);
    });
    if (duplicate) continue;
    merged.push(event);
  }

  return merged;
}

export function inferPlannedEventsFromUserHistory(params: {
  history: HistoryMessage[];
  pendingUserMessage?: string | null;
  nowLocal: DateTime;
  relativeNowLocal?: DateTime;
  tz: string;
  locale: string;
}): PlannedEventMarker[] {
  const userTexts = [
    ...params.history.filter((message) => message.role === "user").map(userText),
    ...(params.pendingUserMessage?.trim() ? [params.pendingUserMessage.trim()] : []),
  ]
    .filter(Boolean)
    .slice(-MAX_HISTORY_MESSAGES_FOR_PLANNING_INFERENCE);

  const inferred: PlannedEventMarker[] = [];
  const seen = new Set<string>();

  for (const text of userTexts) {
    const segmentCandidates: Array<{ event: PlannedEventMarker; expectedKey: string; descLen: number }> = [];

    for (const segment of splitEventSegments(text)) {
      if (isPracticeOnlySegment(segment, params.nowLocal, params.tz, params.locale)) continue;
      if (looksLikeCompletedOutcomeSegment(segment) && !hasStrongPlanningCue(segment)) continue;

      const parsed = parseEventTime({
        phrase: segment,
        nowLocal: params.nowLocal,
        relativeNowLocal: params.relativeNowLocal,
        tz: params.tz,
        locale: params.locale,
      });
      if (isCausalSupportingSegment(segment, parsed)) continue;
      if (isGenericWorkloadSegment(segment, parsed)) continue;
      const hasPlanningCue = hasStrongPlanningCue(segment);
      const implicitTimeNorm = parsed.matchedPhrase ? null : inferImplicitTimeNorm(segment, params.locale);
      if ((parsed.resolution === "fallback_default" || !parsed.matchedPhrase) && !hasPlanningCue && !implicitTimeNorm) continue;
      if (parsed.resolution === "daypart_default" && !hasPlanningCue && !implicitTimeNorm && segment.split(/\s+/).filter(Boolean).length < 4) continue;

      const desc = buildEventDescription(segment, parsed.matchedPhrase);
      if (!desc) continue;

      const effectiveTimeSource = implicitTimeNorm ?? desc;
      const effectiveParsed = parsed.matchedPhrase
        ? parsed
        : parseEventTime({
            phrase: effectiveTimeSource,
            nowLocal: params.nowLocal,
            relativeNowLocal: params.relativeNowLocal,
            tz: params.tz,
            locale: params.locale,
          });

      const expectedKey = effectiveParsed.expectedLocal.toFormat("yyyy-MM-dd'T'HH:mm");
      segmentCandidates.push({
        event: {
          desc,
          time: parsed.matchedPhrase?.trim() ?? null,
          timeNorm: implicitTimeNorm,
          cells: [],
          snippets: [segment.slice(0, 240)],
        },
        expectedKey,
        descLen: desc.length,
      });
    }

    const bestByTimeAndIdentity: Array<{ expectedKey: string; event: PlannedEventMarker; descLen: number }> = [];
    for (const candidate of segmentCandidates) {
      const existingIndex = bestByTimeAndIdentity.findIndex((existing) =>
        existing.expectedKey === candidate.expectedKey
        && samePlannedEventIdentity(existing.event.desc, candidate.event.desc),
      );
      if (existingIndex < 0) {
        bestByTimeAndIdentity.push({ expectedKey: candidate.expectedKey, event: candidate.event, descLen: candidate.descLen });
        continue;
      }
      if (candidate.descLen < bestByTimeAndIdentity[existingIndex]!.descLen) {
        bestByTimeAndIdentity[existingIndex] = {
          expectedKey: candidate.expectedKey,
          event: candidate.event,
          descLen: candidate.descLen,
        };
      }
    }

    for (const { expectedKey, event } of bestByTimeAndIdentity) {
      const key = dedupeKey(event.desc, expectedKey);
      if (seen.has(key)) continue;
      seen.add(key);
      inferred.push(event);
    }
  }

  return inferred;
}
