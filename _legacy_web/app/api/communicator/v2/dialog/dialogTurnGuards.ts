import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import {
  validateHistoryHasDurationAndType,
  type ValidationResult,
} from "@legacy/app/api/_utils/markers";
import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";
import { ALL_CONTENT_LOCALES, SOURCE_LOCALE } from "@legacy/app/api/_utils/contentLocales";
import {
  getDialogScaffoldStrings,
  interpolate,
  summaryClarifyVariant,
} from "@legacy/app/api/_utils/dialogScaffold";
import {
  filterClosureEchoPlanningMarkers,
  isPlanningDoneLikeDescription,
  isPlanningGatheringClosureTurn,
  type ClosureHistoryMessage,
} from "@legacy/app/api/_utils/planningDonePhrases";
import {
  isAddFlowPlanningScaffoldDescription,
  isMetaPlanningIntentDescription,
  samePlannedEventIdentity,
} from "@legacy/app/api/_utils/plannedEventInference";
import type { DialogFsmState } from "@legacy/app/api/communicator/v2/dialog/dialogFsm";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

export function textFromMessage(message: Pick<MessageRecord, "content" | "transcript">): string {
  return String(message.content ?? message.transcript ?? "").trim();
}

function messageBranches(message: Pick<MessageRecord, "meta">): string[] {
  const rawMeta = message.meta as { branches?: unknown; dialog_branches?: unknown } | null | undefined;
  const rawBranches = rawMeta?.branches ?? rawMeta?.dialog_branches;
  return Array.isArray(rawBranches)
    ? rawBranches.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

export function lastAssistantMessage(history: MessageRecord[]): MessageRecord | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "assistant") return message;
  }
  return null;
}

export function lastAssistantText(history: MessageRecord[]): string {
  const message = lastAssistantMessage(history);
  return message ? textFromMessage(message) : "";
}

export function historyHasPracticePicked(history: MessageRecord[]): boolean {
  return history.some((message) => {
    if (message.role !== "assistant") return false;
    const meta = message.meta as { practicePicked?: unknown; practice_picked?: unknown } | null | undefined;
    return Boolean(meta?.practicePicked ?? meta?.practice_picked);
  });
}

export function collectPlanningBranchUserHistory(history: MessageRecord[]): Array<{ role: "user"; content: string }> {
  return collectPlanningBranchDialogHistory(history)
    .filter((message): message is { role: "user"; content: string } => message.role === "user" && Boolean(message.content?.trim()))
    .map((message) => ({ role: "user", content: String(message.content).trim() }));
}

export function collectPlanningBranchDialogHistory(history: MessageRecord[]): ClosureHistoryMessage[] {
  const collected: ClosureHistoryMessage[] = [];
  let activeBranch: string | null = null;
  for (const message of history) {
    if (message.role === "assistant") {
      const branches = messageBranches(message);
      if (branches.length > 0) activeBranch = branches[0] ?? null;
      if (activeBranch === "planning") {
        collected.push({
          role: "assistant",
          content: message.content,
          transcript: message.transcript,
        });
      }
      continue;
    }
    if (message.role === "user" && activeBranch === "planning") {
      const content = textFromMessage(message);
      if (content) collected.push({ role: "user", content });
    }
  }
  return collected;
}

export function assistantAskedPlanningClosure(history: MessageRecord[]): boolean {
  const text = lastAssistantText(history).trim();
  if (!text || !/[?？]/.test(text)) return false;
  const normalized = text.toLowerCase();
  const asksToAddMore =
    /(?:добав|ещ[её]|что-то\s+ещ[её]|anything\s+else|something\s+else|add\s+more|add\s+another|aggiung|qualcos['’]altro|altro|plus\s+rien|encore|weiter|noch\s+etwas|meer|más|mais)/iu.test(normalized);
  const asksToClose =
    /(?:хватит|достаточно|закры|заверш|собер(?:е|ё)м\s+план|finish|done|close|wrap\s+up|va\s+bene\s+cos[ìi]|chiud|finir|suffi|plan|piano|enough|terminer|clore|reicht|genug|cerrar|fechar)/iu.test(normalized);
  return asksToAddMore || asksToClose;
}

export function userSignalsPlanningDone(text: string, history: MessageRecord[] = []): boolean {
  const closureHistory: ClosureHistoryMessage[] = history.map((message) => ({
    role: message.role,
    content: message.content,
    transcript: message.transcript,
  }));
  return isPlanningGatheringClosureTurn(text, closureHistory);
}

const PRACTICE_OFFER_RE =
  /(?:практик|медитаци|дыхан|пранаям|асан|йог|mindfulness|meditation|breath(?:ing)?|asana|yoga practice)/i;

export function assistantOfferedPractice(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (!PRACTICE_OFFER_RE.test(normalized)) return false;
  return /\?/.test(normalized) || /(?:хотите|хочешь|предлож|offer|would you like|want me to)/i.test(normalized);
}

/**
 * After an empty-plan close the model often offers practice without a numbered
 * wrap-up list. That must still lock planning so the next user reply (type +
 * duration) is coerced into the practice branch — otherwise meditation/breath
 * requests stay on planning and the model improvises a text practice.
 */
export function assistantAcknowledgedEmptyPlanAndOfferedPractice(text: string): boolean {
  if (!assistantOfferedPractice(text)) return false;
  return /(?:без\s+плана|без\s+планов|ничего\s+(?:не\s+)?планир|планов\s+нет|no\s+plans?|without\s+a?\s*plan|nothing\s+to\s+plan|ohne\s+plan|sans\s+plan|senza\s+pian|sin\s+plan|sem\s+plano|zonder\s+plan)/i.test(
    text,
  );
}

export function isPracticeLikePlannedEventDesc(desc: string): boolean {
  const normalized = desc.trim().toLowerCase();
  if (!normalized) return false;
  return /(?:медитаци|дыхан|пранаям|асан|йог|практик|mindfulness|meditation|breath(?:ing)?|pranayama|asana)/i.test(
    normalized,
  );
}

export function filterPracticeLikePlannedEvents(markers: PlannedEventMarker[]): PlannedEventMarker[] {
  return markers.filter((marker) => !isPracticeLikePlannedEventDesc(marker.desc));
}

export function filterPlanningDoneLikePlannedEvents(markers: PlannedEventMarker[]): PlannedEventMarker[] {
  return markers.filter((marker) => !isPlanningDoneLikeDescription(marker.desc));
}

export function filterPersistablePlanningMarkers(
  markers: PlannedEventMarker[],
  options?: { closureUserMessage?: string | null; addFlow?: boolean },
): PlannedEventMarker[] {
  const isScaffold = options?.addFlow
    ? isAddFlowPlanningScaffoldDescription
    : isMetaPlanningIntentDescription;
  return filterPlanningDescBlobMarkers(
    filterClosureEchoPlanningMarkers(
      filterPlanningDoneLikePlannedEvents(
        filterPracticeLikePlannedEvents(
          markers.filter((marker) => !isScaffold(marker.desc)),
        ),
      ),
      options?.closureUserMessage,
    ),
  );
}

const PLANNING_DESC_BLOB_MIN_LENGTH = 55;

function normalizePlanningDesc(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeMultiActionPlanningBlob(desc: string): boolean {
  const trimmed = desc.trim();
  if (trimmed.length <= 50) return false;
  const commaSegments = trimmed
    .split(/[,;]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 4);
  return commaSegments.length >= 3;
}

const USER_SPEECH_PLANNING_CUE_RE =
  /(?:i\s+want(?:ed)?|i(?:['’]d|\s+would)\s+like|during the day|хочу|планирую|собираюсь|voglio|vorrei|je\s+(?:veux|voudrais)|ich\s+(?:will|möchte|moechte)|quiero|quero|ik\s+wil)/i;

const COORDINATED_TIME_SHIFT_IN_DESC_RE =
  /,?\s+(?:and|und|et|e|y|en|и)\s+(?:in the (?:morning|afternoon|evening)|at night|tonight|later|then|this (?:morning|evening|afternoon)|вечером|утром|днем|днём|ночью|am (?:abend|morgen)|le soir|la sera|por la (?:noche|tarde)|à noite|'s avonds)/i;

function looksLikeUserSpeechPlanningBlob(desc: string): boolean {
  const trimmed = desc.trim();
  if (trimmed.length < PLANNING_DESC_BLOB_MIN_LENGTH) return false;
  if (USER_SPEECH_PLANNING_CUE_RE.test(trimmed)) return true;
  if (COORDINATED_TIME_SHIFT_IN_DESC_RE.test(trimmed)) return true;
  return looksLikeMultiActionPlanningBlob(trimmed);
}

/** Keep model/target-locale wording unless it is a raw user-speech blob. */
function preferEssencePlanningDesc(current: string, fallback: string): string {
  const a = current.trim();
  const b = fallback.trim();
  if (!a) return b;
  if (!b) return a;
  const aBlob = looksLikeUserSpeechPlanningBlob(a);
  const bBlob = looksLikeUserSpeechPlanningBlob(b);
  if (aBlob && !bBlob) return b;
  if (bBlob && !aBlob) return a;
  if (aBlob && bBlob) return a.length <= b.length ? a : b;
  return a;
}

function isSupersededPlanningDescBlob(
  marker: PlannedEventMarker,
  markers: PlannedEventMarker[],
): boolean {
  const desc = marker.desc.trim();
  if (!desc) return false;
  const others = markers.filter((item) => item !== marker);
  if (others.length === 0) return false;

  const normalizedLong = normalizePlanningDesc(desc);
  if (!normalizedLong) return false;

  const hasMoreSpecificSibling = others.some((other) => {
    const otherDesc = other.desc.trim();
    if (!otherDesc || otherDesc.length >= desc.length) return false;
    if (samePlannedEventIdentity(desc, otherDesc)) return true;
    const normalizedOther = normalizePlanningDesc(otherDesc);
    if (normalizedOther && normalizedLong.includes(normalizedOther)) return true;
    return normalizedOther
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .some((token) => normalizedLong.includes(token));
  });

  if (hasMoreSpecificSibling) {
    return desc.length >= PLANNING_DESC_BLOB_MIN_LENGTH || looksLikeMultiActionPlanningBlob(desc);
  }
  return false;
}

/** Drop model-emitted planning blobs when shorter sibling markers cover the same turn. */
export function filterPlanningDescBlobMarkers(markers: PlannedEventMarker[]): PlannedEventMarker[] {
  if (markers.length < 2) return markers;
  return markers.filter((marker) => !isSupersededPlanningDescBlob(marker, markers));
}

/**
 * User declines the practice offer. JS word boundaries (\b) never match around
 * Cyrillic, so whitespace/fragment patterns are used. Bare negation is accepted
 * only when the message does not itself request a practice (type/duration), so
 * "Нет, лучше дыхание 5 минут" still routes to validation, not decline.
 */
export function userDeclinesPractice(text: string): boolean {
  const normalized = normalizeLocaleGuardText(text.trim());
  if (!normalized) return false;
  if (
    /(?:не\s*надо|не\s*хочу|не\s*предлаг\w*|без\s*практик|не\s*буду|ничего\s+не\s+(?:надо|нужно)|пропуст|потом|позже|не\s*сейчас|обойд[её]мся|обойтись|некогда|нет\s+времени|в\s+другой\s+раз|не\s+сегодня|skip|no\s*practice|not\s*now|maybe\s*later|without\s*(?:a\s*)?practice|don'?t\s*(?:offer|suggest)|no\s+time|there\s+is\s+no\s+time|don'?t\s+have\s+time|another\s+time|some\s+other\s+time|not\s+this\s+time|i['’]?ll\s+skip|skip\s+(?:it|today|this)|keine\s+zeit|nicht\s+jetzt|spaeter|spater|überspring|uberspring|pas\s+le\s+temps|pas\s+maintenant|plus\s+tard|une\s+autre\s+fois|non\s+ho\s+tempo|non\s+ora|un['’]?altra\s+volta|piu\s+tardi|no\s+tengo\s+tiempo|no\s+ahora|en\s+otro\s+momento|mas\s+tarde|nao\s+tenho\s+tempo|agora\s+nao|outra\s+hora|geen\s+tijd|niet\s+nu|een\s+andere\s+keer)/i.test(
      normalized,
    )
  ) {
    return true;
  }
  const mentionsPractice =
    /(?:медитац|дыхан|пранаям|асан|йог|минут|practice|meditation|breath|yoga|asana|\bmin\b|atmung|respiration|respirazione|respiracion|ademhaling)/i.test(
      normalized,
    );
  if (!mentionsPractice && /^(?:нет|нету|неа|no|nope|nein|non|nao|nee)[.!?,…\s]/i.test(`${normalized} `)) {
    return true;
  }
  return false;
}

export function userDeclinesPracticeOffer(text: string): boolean {
  return userDeclinesPractice(text);
}

export function userAffirmsPracticeOffer(userMessage: string, history: MessageRecord[]): boolean {
  if (userDeclinesPracticeOffer(userMessage)) return false;
  const validation = validateHistoryHasDurationAndType([
    ...history.filter((message) => message.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);
  if (validation.confident) return true;
  const normalized = userMessage.trim().toLowerCase();
  if (!normalized) return false;
  const affirms = /(?:^|[\s,.!?])(?:да|ага|угу|конечно|хочу|давай|предлож|please|yes|sure|ok|okay)(?:[\s,.!?]|$)/i.test(
    ` ${normalized} `,
  );
  if (!affirms) return false;
  return PRACTICE_OFFER_RE.test(normalized);
}

export function assistantFinalizeWithoutMarkers(history: MessageRecord[]): boolean {
  const text = lastAssistantText(history);
  if (!text) return false;
  return /(?:^|\n)\s*\d+\.\s/m.test(text) && assistantOfferedPractice(text);
}

export function coerceFsmBeforeTurn(params: {
  fsm: DialogFsmState;
  history: MessageRecord[];
  userMessage: string;
  isInitiate: boolean;
}): DialogFsmState {
  const { fsm, history, userMessage, isInitiate } = params;
  if (isInitiate || fsm.noPractice) return fsm;

  if (fsm.branch === "planning") {
    // Only treat this as "answering a practice offer" when planning has actually
    // finalized — either with markers (planningFinalized) or visibly as a numbered
    // wrap-up that offered a practice (assistantFinalizeWithoutMarkers). We must NOT
    // use a loose assistantOfferedPractice() here: the summarizing FINAL message
    // mentions past practices ("из практик… три коротких медитации") and ends with a
    // question, which would falsely lock planning and skip the whole planning branch
    // when the user's first planning reply merely contains a word like "потом".
    const planningLocked =
      fsm.planningFinalized
      || assistantFinalizeWithoutMarkers(history)
      || assistantAcknowledgedEmptyPlanAndOfferedPractice(lastAssistantText(history));
    const answeringPracticeOffer =
      planningLocked && (userAffirmsPracticeOffer(userMessage, history) || userDeclinesPracticeOffer(userMessage));
    if (answeringPracticeOffer) {
      const practiceIndex = fsm.flow.indexOf("practice");
      if (practiceIndex >= 0) {
        return {
          ...fsm,
          branch: "practice",
          branchIndex: practiceIndex,
          planningFinalized: true,
        };
      }
    }
  }

  return fsm;
}

export function isPostDialogTurn(fsm: DialogFsmState | null, isInitiate: boolean): boolean {
  return Boolean(fsm && fsm.branch === "done" && !isInitiate);
}

export function isGratitudeOrShortAck(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || normalized.length > 80) return false;
  return /^(?:спасибо|благодарю|thanks|thank you|thx|ok|ок|понятно|ясно|хорошо|отлично|супер|👍|🙏)(?:[!.,\s]|$)/i.test(
    normalized,
  );
}

export function buildPostDialogReply(params: {
  locale: AppContentLocale;
  userMessage: string;
  hadPractice: boolean;
}): string {
  const { locale, userMessage, hadPractice } = params;
  const s = getDialogScaffoldStrings(locale);
  if (isGratitudeOrShortAck(userMessage)) {
    return hadPractice ? s.postDialog_thanksPractice : s.postDialog_thanksNoPractice;
  }
  return hadPractice ? s.postDialog_hadPractice : s.postDialog_noPractice;
}

/** Word-boundary clamp for a salvaged planning label: never breaks a word mid-token, no ellipsis. */
function clampPlanningDesc(desc: string, max = 60): string {
  const clean = desc.trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 20 ? head.slice(0, lastSpace) : head;
  return cut.replace(/[\s,;:.…–—-]+$/u, "").trim();
}

/**
 * Best-effort life-sphere inference for a SALVAGED planned event — used only
 * when the model finalized visibly but forgot the invisible [PLANNED_EVENT]
 * marker (so we have no model-provided spheres). Keyword-based, RU/EN,
 * Cyrillic-safe (no \b). Falls back to sphere 1 (body/home/safety) and NEVER
 * the old hardcoded sphere-4 default, which mislabeled chores/rest as
 * "friends/family/relationships" in the Day-tab spheres chart.
 */
export function inferPlanningSpheresFromText(text: string): PlannedEventMarker["cells"] {
  const t = text.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const scored: number[] = [];
  if (has(/(дом|дач|убор|убра|порядок|крыш|краси|ремонт|кос(и|я)|трав|колодец|безопас|здоров|сон|спать|выспат|лечь|тел(?:о|а|у|ом|е)|home|chore|clean|repair|garden|sleep)/)) scored.push(1);
  if (has(/(отдых|релакс|расслаб|прогул|погул|велосипед|катан|купан|плав|озер|море|пляж|природ|кафе|перекус|вкус|ужин|обед|удовольств|бан[яи]|саун|rest|relax|walk|swim|bike|beach|nature|cafe|lunch|dinner)/)) scored.push(2);
  if (has(/(работ|задач|проект|деньг|бизнес|результат|дедлайн|клиент|совещ|заработ|карьер|work|task|project|money|deadline|client|meeting)/)) scored.push(3);
  // Family/relationships — match родные/родной/… but NOT родник (substring false positive).
  if (has(/(друз|семь|близк|родител|жена|муж[ае]|свидан|отношени|помир|родственн|родн(?:ы[ейхм]|ая|ое|ой|ый)|friend|family|relationship|date\b)/)) scored.push(4);
  if (has(/(творч|рисов|музык|стих|песн|самовыраж|искусств|creativ|paint|music|poem|art)/)) scored.push(5);
  if (has(/(учеб|обуч|изуч|познан|курс|лекц|разобрат|исследов|study|learn|course|research)/)) scored.push(6);
  if (has(/(вер[ауы]|молит|духов|медита|смысл\s+жизни|призван|сакрал|паломн|faith|pray|spiritual|medita|sacred|pilgrim)/)) scored.push(7);
  if (!scored.length) return [{ sphere: 1, weight: 1 }];
  const top = scored.slice(0, 2);
  const weight = top.length === 1 ? 1 : 0.5;
  return top.map((sphere) => ({ sphere, weight }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Salvage planning markers when the model finalized visibly but forgot invisible markers. */
export function extractPlanningMarkersFromVisibleFinalize(
  text: string,
  locale: AppContentLocale,
): PlannedEventMarker[] {
  const recommendationLabels = Array.from(new Set([
    getDialogScaffoldStrings(locale).recommendationLabel.trim(),
    ...ALL_CONTENT_LOCALES.map((candidateLocale) => getDialogScaffoldStrings(candidateLocale).recommendationLabel.trim()),
    "Recommendation",
  ]))
    .filter(Boolean)
    .map((label) => escapeRegExp(label))
    .join("|");
  const pattern = new RegExp(
    [
      String.raw`(?:^|\n)\s*(\d+)[.)]\s*([^\n]+?)\s*`,
      String.raw`\n\s*(?:[-*]\s*)?(?:\*\*|__)?`,
      `(?:${recommendationLabels})`,
      String.raw`(?:\*\*|__)?\s*:\s*`,
      String.raw`([^\n]+(?:\n(?!\s*(?:\d+[.)]|\n))[^\\n]+)*)`,
    ].join(""),
    "gim",
  );
  const markers: PlannedEventMarker[] = [];
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const displayOrder = Number(match[1]);
    const desc = match[2]?.trim() ?? "";
    const recommendation = match[3]?.replace(/\s+/g, " ").trim() ?? "";
    if (!desc || isPracticeLikePlannedEventDesc(desc)) {
      match = pattern.exec(text);
      continue;
    }
    markers.push({
      desc: clampPlanningDesc(desc),
      time: null,
      timeNorm: null,
      recommendation,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : markers.length + 1,
      cells: inferPlanningSpheresFromText(desc),
      snippets: [],
    });
    match = pattern.exec(text);
  }
  return markers;
}

/**
 * Final planning turns can contain both:
 * 1) incremental marker-backed actions from the current turn, often without
 *    `recommendation`, and
 * 2) a visible numbered finalize that *does* contain the recommendations.
 *
 * Merge both sources so persistence keeps the reliable invisible markers while
 * backfilling missing recommendation_text from the visible finalize.
 */
export function mergePlanningMarkersWithVisibleFinalize(
  parsedMarkers: PlannedEventMarker[],
  salvagedMarkers: PlannedEventMarker[],
  options?: {
    preferCurrentByDisplayOrder?: boolean;
    /** When false, only backfill matching rows — do not invent new actions from salvage. */
    allowSalvageOnlyAdditions?: boolean;
  },
): PlannedEventMarker[] {
  const allowSalvageOnlyAdditions = options?.allowSalvageOnlyAdditions !== false;
  if (parsedMarkers.length === 0) {
    return allowSalvageOnlyAdditions ? [...salvagedMarkers] : [];
  }
  if (salvagedMarkers.length === 0) return [...parsedMarkers];

  if (options?.preferCurrentByDisplayOrder) {
    const orderedParsed = [...parsedMarkers]
      .map((marker, index) => ({ marker: { ...marker }, order: Number.isInteger(marker.displayOrder) ? Number(marker.displayOrder) : index + 1 }))
      .sort((left, right) => left.order - right.order);
    const orderedSalvaged = [...salvagedMarkers]
      .map((marker, index) => ({ marker: { ...marker }, order: Number.isInteger(marker.displayOrder) ? Number(marker.displayOrder) : index + 1 }))
      .sort((left, right) => left.order - right.order);
    const sameLayout =
      orderedParsed.length >= 2
      && orderedParsed.length === orderedSalvaged.length
      && orderedParsed.every((entry, index) => entry.order === orderedSalvaged[index]?.order);
    if (sameLayout) {
      return orderedParsed.map(({ marker }, index) => {
        const salvaged = orderedSalvaged[index]!.marker;
        return {
          ...marker,
          ...salvaged,
          desc: preferEssencePlanningDesc(salvaged.desc, marker.desc),
          recommendation: salvaged.recommendation?.trim() ? salvaged.recommendation : marker.recommendation,
          cells: salvaged.cells.length > 0 ? salvaged.cells : marker.cells,
          snippets: salvaged.snippets.length > 0 ? salvaged.snippets : marker.snippets,
          displayOrder: salvaged.displayOrder ?? marker.displayOrder ?? index + 1,
        };
      });
    }
  }

  const merged = parsedMarkers.map((marker) => ({ ...marker }));
  for (const salvaged of salvagedMarkers) {
    const matchIndex = merged.findIndex((marker) => samePlannedEventIdentity(marker.desc, salvaged.desc));
    if (matchIndex < 0) {
      if (allowSalvageOnlyAdditions) merged.push({ ...salvaged });
      continue;
    }
    const current = merged[matchIndex]!;
    merged[matchIndex] = {
      ...current,
      recommendation: current.recommendation?.trim() ? current.recommendation : salvaged.recommendation,
      displayOrder: current.displayOrder ?? salvaged.displayOrder,
      cells: current.cells.length > 0 ? current.cells : salvaged.cells,
      snippets: current.snippets.length > 0 ? current.snippets : salvaged.snippets,
    };
  }
  return merged;
}

export function mergeHistoryPlanningMarkers(
  accumulatedMarkers: PlannedEventMarker[],
  currentMarkers: PlannedEventMarker[],
  options?: { preferCurrentByDisplayOrder?: boolean; allowSalvageOnlyAdditions?: boolean },
): PlannedEventMarker[] {
  if (accumulatedMarkers.length === 0) return [...currentMarkers];
  if (currentMarkers.length === 0) return [...accumulatedMarkers];
  return mergePlanningMarkersWithVisibleFinalize(accumulatedMarkers, currentMarkers, options);
}

/**
 * Day-tab «Добавить действие»: model [PLANNED_EVENT] markers (+ already-persisted
 * rows for this conversation) are authoritative. Keyword inference from raw user
 * text must NOT invent extra actions the model already omitted in its visible reply.
 */
export function resolveAddFlowPlanningMarkers(params: {
  existingConversationMarkers: PlannedEventMarker[];
  modelMarkers: PlannedEventMarker[];
}): PlannedEventMarker[] {
  if (params.modelMarkers.length > 0) {
    return mergeHistoryPlanningMarkers(params.existingConversationMarkers, params.modelMarkers, {
      preferCurrentByDisplayOrder: true,
      allowSalvageOnlyAdditions: true,
    });
  }
  // Model forgot markers this turn — keep what is already saved; do not invent.
  return [...params.existingConversationMarkers];
}

/**
 * Detects that the user is reporting a planned action did NOT happen, so the
 * summarizing branch can close that event immediately — no clarifying question,
 * nothing written to the matrix — and bridge to the next one.
 *
 * History: this used to be a bare "нет"/"no"-only backstop with everything
 * nuanced delegated to the LLM. In practice the model was inconsistent — for
 * "Книгу не почитал" / "На тренировку я не пошёл" it kept asking about the
 * lived state instead of closing — so we now also match a curated set of
 * unambiguous non-occurrence phrasings. The set is intentionally narrow:
 * negated occurrence/action verbs ("не пошёл", "не почитал", "не успел", "не
 * получилось"), idioms ("не до того", "не было времени", "не хватило сил"),
 * and clear skip/cancel/forget verbs — plus their English equivalents. We avoid
 * bare "не было" (matches occurred answers like "ничего особенного не было") and
 * generic negated verbs (to keep occurred-but-thin answers out).
 */
const NON_OCCURRENCE_RU =
  /(?:не\s+(?:получи|сложи|вышл|удал|состоя|успе|смог|могла|дош|добра|доеха|сходи|пош[ёе]л|пошл|ходи|езди|поеха|съезди|встрети|позвони|почита|прочита|чита|написа|сдела|занима|заня|погуля|посети|купи|выбра|присту|добрал)|так\s+и\s+не\s+|не\s+до\s+(?:того|этого|них)|не\s+хвати(?:ло)?\s+(?:времени|сил|возможност)|не\s+было\s+(?:времени|сил|возможност|настроени)|не\s+дошли\s+руки|пропусти[лвт]|отмени[лвт]|перен[её]с|отложи[лвт]|забы(?:л|ла|лось))/i;
const NON_OCCURRENCE_EN =
  /(?:did\s*n[o']?t|didn['’]?t|couldn['’]?t|wasn['’]?t\s+able|never\s+got|no\s+time|ran\s+out\s+of\s+time|skipped?|put\s+it\s+off|postponed?|cancel(?:l?ed)?|forgot)/i;
const NON_OCCURRENCE_IT =
  /(?:non\s+(?:ho|l['’]?ho|sono|ci\s+sono)\s+(?:letto|letta|fatto|fatta|fatti|riuscit[oa]|andat[oa]|arrivat[oa]|avuto|potuto)|non\s+(?:sono\s+riuscit[oa]|ci\s+sono\s+riuscit[oa]|ce\s+l['’]?ho\s+fatt[oa]|ha\s+funzionato)|non\s+ha\s+funzionato|non\s+(?:c['’]era|cera)\s+tempo|non\s+avevo\s+tempo|non\s+ne\s+ho\s+avuto\s+tempo|non\s+me\s+la\s+sono\s+sentita|non\s+ce\s+l['’]?ho\s+fatta|non\s+ce\s+l['’]?ho\s+fatto|ho\s+saltato|saltat[oa]|rimandat[oa]|rinviat[oa]|dimenticat[oa])/i;
const NON_OCCURRENCE_FR =
  /(?:je\s+n['’]ai\s+pas\s+(?:lu|fait|pu|reussi|reussi|reussi|réussi)|je\s+ne\s+suis\s+pas\s+(?:alle|allee|arrive|arrivee)|je\s+n['’]y\s+suis\s+pas\s+arrive|je\s+ne\s+l['’]ai\s+pas\s+fait|pas\s+eu\s+le\s+temps|je\s+n['’]avais\s+pas\s+le\s+temps|annul[eé]|report[eé]|oubli[eé]|rat[eé])/i;
const NON_OCCURRENCE_DE =
  /(?:ich\s+habe\s+(?:es\s+)?nicht\s+(?:gelesen|gemacht|geschafft|getan)|ich\s+bin\s+nicht\s+(?:gegangen|hingegangen)|ich\s+kam\s+nicht\s+dazu|keine\s+zeit|ich\s+hatte\s+keine\s+zeit|nicht\s+geschafft|abgesagt|verschoben|vergessen|ubersprungen|übersprungen)/i;
const NON_OCCURRENCE_ES =
  /(?:no\s+(?:lo\s+)?(?:he\s+)?(?:leido|hecho|podido)|no\s+fui|no\s+he\s+podido|no\s+me\s+dio\s+tiempo|no\s+tuve\s+tiempo|pospu(?:se|esto)|cancel(?:e|ado)|olvide|olvid[eé]|salt[eé])/i;
const NON_OCCURRENCE_PT =
  /(?:nao\s+(?:o\s+)?(?:fiz|li|consegui|pude)|nao\s+fui|nao\s+deu\s+tempo|nao\s+tive\s+tempo|cancelei|adiei|esqueci|pulei)/i;
const NON_OCCURRENCE_NL =
  /(?:ik\s+heb\s+het\s+niet\s+(?:gelezen|gedaan|gered)|ik\s+ben\s+niet\s+gegaan|ik\s+kwam\s+er\s+niet\s+aan\s+toe|geen\s+tijd|ik\s+had\s+geen\s+tijd|uitgesteld|afgezegd|vergeten|overgeslagen)/i;

function normalizeLocaleGuardText(text: string): string {
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

export function userSaysEventDidNotHappen(text: string): boolean {
  const normalized = normalizeLocaleGuardText(text.trim());
  if (!normalized) return false;
  if (/^(?:нет|no|нету|не)[.!?,…\s]*$/i.test(normalized)) return true;
  if (NON_OCCURRENCE_RU.test(normalized)) return true;
  if (NON_OCCURRENCE_EN.test(normalized)) return true;
  if (NON_OCCURRENCE_IT.test(normalized)) return true;
  if (NON_OCCURRENCE_FR.test(normalized)) return true;
  if (NON_OCCURRENCE_DE.test(normalized)) return true;
  if (NON_OCCURRENCE_ES.test(normalized)) return true;
  if (NON_OCCURRENCE_PT.test(normalized)) return true;
  if (NON_OCCURRENCE_NL.test(normalized)) return true;
  return false;
}

/** Coarse domain of a planned-event label, used to tailor a clarifying question. */
type SummaryEventDomain = "work" | "rest" | "social" | "creative" | "tiny" | "generic";

function summaryEventDomain(eventDescription: string): SummaryEventDomain {
  const lower = eventDescription.trim().toLowerCase();
  if (!lower) return "generic";
  // Very short / simple actions where digging for "states" feels forced.
  if (/(?:лечь\s+(?:по)?раньше|лечь\s+спать|пораньше\s+спать|выспаться|вовремя\s+лечь|зарядк|выпить\s+воды|сделать\s+паузу)/i.test(lower)) {
    return "tiny";
  }
  if (/(?:работ|задач|проект|совещ|клиент|дедлайн|код|разработ|бизнес|дел[ао]\s+по\s+работ|lavor|attivit[aà]\s+lavor|ufficio|progett)/i.test(lower)) {
    return "work";
  }
  if (/(?:озер|природ|прогул|погул|парк|отдых|купан|море|лес|пляж|кафе|сон|поспать|расслаб|баня|саун|поездк|закат|рассвет|гриб|небо|пейзаж)/i.test(lower)) {
    return "rest";
  }
  if (/(?:друз|семь|близк|позвон|встреч[аи]?\s+с|общени|свидани|поговорить|извинит)/i.test(lower)) {
    return "social";
  }
  if (/(?:книг|почитать|прочитать|читать|написать|порисов|рисов|музык|творч|размышл|подумать)/i.test(lower)) {
    return "creative";
  }
  return "generic";
}

/** Server-side clarifying question when the model tries to close a thin answer too early. */
function summaryEventPhraseRu(eventDescription: string): string {
  const label = eventDescription.trim();
  if (!label) return "в этом действии";
  const lower = label.toLowerCase();
  if (lower.startsWith("работа с ")) {
    return `когда вы работали с ${label.slice("Работа с ".length).trim() || "этими задачами"}`;
  }
  if (lower.startsWith("визит в ")) {
    return `во время визита в ${label.slice("Визит в ".length).trim() || "это место"}`;
  }
  if (lower.includes("саун") && lower.includes("друз")) {
    return "когда вы были в сауне и общались с друзьями";
  }
  if (lower.includes("саун")) {
    return "когда вы были в сауне";
  }
  if (lower.includes("лечь спать")) {
    return "когда вы легли спать";
  }
  if (/^(?:почитать|прочитать|погулять|поужинать|поработать|съездить|сделать)\b/i.test(label)) {
    return `когда вы планировали ${lower}`;
  }
  return "в этом действии";
}

/**
 * Deterministic clarifying question used as a safety net when the model closes a
 * thin answer too early. It is tailored to the event's coarse domain and to its
 * depth (a long activity vs a tiny action), so it reads like a friend picking up
 * the thread — not a fixed "тело/настроение/мысли/отношения" checklist that
 * repeats across every dialog.
 */
export function buildSummaryClarifyingQuestion(eventDescription: string, locale: AppContentLocale): string {
  const label = eventDescription.trim() || getDialogScaffoldStrings(locale).summaryDefaultEvent;
  const domain = summaryEventDomain(label);
  const seed = [...label].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  if (locale !== SOURCE_LOCALE) {
    return summaryClarifyVariant(locale, domain, seed);
  }
  const phrase = summaryEventPhraseRu(label);
  const byDomain: Record<SummaryEventDomain, string[]> = {
    work: [
      "Чем был наполнен этот процесс: вы были увлечены делом, больше держали фокус и точность, согласовывали что-то с людьми — или были трения и прорывы?",
      "А как это ощущалось изнутри: вы двигались с азартом и сосредоточенностью, больше координировали с людьми, или это скорее выматывало?",
    ],
    rest: [
      `А что это дало вам внутри ${phrase}: отдых телу, спокойствие, удовольствие — или радость от того, что просто были в моменте?`,
      "Как это ощущалось: больше телесное расслабление, тихое удовольствие или подъём настроения?",
    ],
    social: [
      "А как это было с человеком: тепло и близко, легко — или немного напряжённо?",
      "Что это дало внутри: ощущение близости, лёгкости — или что-то, что пришлось проживать непросто?",
    ],
    creative: [
      // Contrast different lived domains (pleasure/body vs reflection) — never
      // hair-split three near-synonyms of the same chakra ("calm / interest / meaning").
      "Больше отозвалось как удовольствие от самого процесса — или как повод задуматься?",
      "Что было сильнее: простое удовольствие от чтения или размышления о том, что затронуло?",
    ],
    tiny: [
      "А как это вышло: удалось ли, и стало ли от этого чуть спокойнее?",
    ],
    generic: [
      "А что вы там в основном проживали внутри? Можно совсем коротко.",
      `А что отозвалось сильнее ${phrase}: спокойствие, радость, ясность — или что-то своё?`,
    ],
  };
  const variants = byDomain[domain];
  return variants[seed % variants.length]!;
}

const SUMMARY_CLARIFYING_QUESTION_RE =
  /(?:уточн|какие состояния|какое состояние|в какой момент|что вы проживали|что вы проживал|что осталось|как вы себя чувств|матриц|body|mood|mind|relationships|what states|what state|which moment|how did you feel|clarify|matrix|sensazione|focalizz|concentrat|tensione|stati|sentir|sentito|provato|come ti sent|come ti sei sent|senti\b|ressenti|sentiez|fühlt|empfind|estados|estado|sentiste|gevoel|ressenti)/i;

export function visibleTextMentionsEvent(text: string, description: string): boolean {
  const needle = description.trim().toLowerCase();
  if (needle.length < 4) return false;
  return text.toLowerCase().includes(needle);
}

/** Visible reply asks about two different planned events in the same turn. */
export function summaryVisibleTextMixesMultipleEvents(
  text: string,
  _currentEventDescription: string,
  nextEventDescription?: string | null,
): boolean {
  const next = nextEventDescription?.trim();
  if (!next || next.length < 4) return false;
  const normalized = text.trim().toLowerCase();
  if (!/\?/.test(normalized)) return false;
  if (!visibleTextMentionsEvent(text, next)) return false;

  const questionCount = (normalized.match(/\?/g) ?? []).length;
  if (questionCount >= 2) return true;

  const nextIdx = normalized.indexOf(next.toLowerCase());
  if (nextIdx > 0 && /\?/.test(normalized.slice(0, nextIdx))) return true;

  return false;
}

export function assistantVisibleContainsSummaryClarifyingCue(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || !/\?/.test(normalized)) return false;
  return SUMMARY_CLARIFYING_QUESTION_RE.test(normalized);
}

export function assistantAskedSummaryClarifyingQuestion(
  text: string,
  nextEventDescription?: string | null,
): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || !/\?/.test(normalized)) return false;
  const next = nextEventDescription?.trim().toLowerCase();
  if (next && next.length >= 4 && normalized.includes(next)) return false;
  return assistantVisibleContainsSummaryClarifyingCue(text);
}

export function buildSummaryEventDidNotHappenBridge(
  currentEventDescription: string,
  nextEventDescription: string,
  locale: AppContentLocale,
): string {
  const next = nextEventDescription.trim();
  const s = getDialogScaffoldStrings(locale);
  if (locale !== SOURCE_LOCALE) {
    return interpolate(s.summaryBridge_en, { next });
  }
  const prefix = /(?:отмен|перенес|перенёс|не состоя)/i.test(currentEventDescription)
    ? s.summaryBridge_cancelledPrefix
    : s.summaryBridge_sorryPrefix;
  const nextSuffix = next ? ` — ${next}` : "";
  return interpolate(s.summaryBridge_ruTemplate, { prefix, nextSuffix });
}

/** User confirms the event happened but names no lived state — needs one clarifying question. */
export function userAnswerHasSufficientStateForSummary(text: string): boolean {
  if (userSaysEventDidNotHappen(text)) return false;
  const normalized = normalizeLocaleGuardText(text.trim());
  if (!normalized) return false;
  // Lived-state backstop: named feelings AND reflective/meaning cues (e.g. «задуматься
  // о жизни, о смыслах») — enough to close without a clarifying question. Keep this
  // broader than thin confirmations like bare «да, почитал».
  // Whole-reply scan: feelings, beauty/aesthetics, positive/negative valence,
  // reflection — any of these in a multi-word answer is enough to close.
  if (/(?:чувств|ощущ|состояни|споко|тревог|радост|рад\b|довол|удовлетвор|устал|энерг|внимани|ясн|тишин|довер|смят|напряж|расслаб|присутств|собран|вдохнов|интерес|живост|прият|комфорт|общал|друз|шут|вкус|увидел|увидела|понял|поняла|осознал|осознала|инсайт|общ[ау]ю картин|масштаб|перспектив|связ|широк|фокус|задума|размышл|осмысл|смысл|о\s+жизни|глубин|углуб|тепло\s+общен|удовольств|эмоц|красив|красот|прекрасн|положительн|негативн|восторг|восхищ|умилен|тёпл|тепл|felt|calm|anxious|tired|focused|peaceful|satisfied|glad|happy|clear|clarity|insight|perspective|bigger picture|pleasant|comfortable|connected|reflect|thought.?provok|meaning|made\s+me\s+think|about\s+life|beauty|beautiful|emotion|positive|responsabil|tensione|focalizz|concentr|stress|stanc|soddisf|sentito|sentita|emozion|ansia|calma|seren|tranquill|piaciut|gustos|rinforz|vittori|buon\s+lavoro|mi\s+[èe]\s+piaciut|ho\s+sentit[oa]|sono\s+stat[oa]|mi\s+sono\s+sentit[oa]|riflett|significato|senso\s+della\s+vita|emotion|apaise|apais|calme|fatigu|satisfait|soulag|fier|inspire|je\s+me\s+suis\s+senti|ca\s+m['’]a\s+plu|reflexion|réflexion|sens\s+de|spannung|konzentr|m[uü]d|zufrieden|erleichtert|stolz|ich\s+habe\s+mich|ich\s+fuhlte\s+mich|es\s+hat\s+mir\s+gefallen|nachdenk|sinn\b|ansiedad|relaj|tranquil|cansad|satisfech|alivi|me\s+gusto|me\s+senti|enfocad|claridad|reflexion|sentido|cansad|satisfeit|alivi|gostei|me\s+senti|focad|leve|rustig|tevreden|moe|opgelucht|gefocust|helder|ik\s+voelde\s+me|het\s+beviel\s+me|nadenk|betekenis)/i.test(
    normalized,
  )) {
    return true;
  }
  // Soft narrative: several words beyond bare «да/сделал» already give the model
  // enough to pick 1–2 chakras — do not ask a menu of states.
  const wordCount = normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;
  if (wordCount >= 8 && /(?:посмотр|посетил|побыл|прогул|погул|почитал|прочитал|сделал|получил|был[оаи]?|went|saw|watched|visited|felt|was)/i.test(normalized)) {
    return true;
  }
  return false;
}

/** User confirms the event happened but names no lived state — needs one clarifying question. */
export function userAnswerIsThinForSummary(text: string): boolean {
  if (userSaysEventDidNotHappen(text)) return false;
  const normalized = normalizeLocaleGuardText(text.trim());
  if (!normalized) return true;
  const claimsDone = /(?:состоял|получил|сделал|было|хорошо|отлично|удалось|нормально|да|yes|it happened|all good|went well|fatto|riuscito|andato|completato|j['’]?ai|c['’]?est\s+fait|fait|reussi|réussi|termine|terminé|hecho|conseguido|salio\s+bien|salió\s+bien|gemacht|geschafft|geland|gelukt|deu\s+certo|feito|klaar|gedaan)/i.test(
    normalized,
  );
  return claimsDone && !userAnswerHasSufficientStateForSummary(normalized);
}

export function practiceValidationForTurn(
  history: MessageRecord[],
  userMessage: string,
): ValidationResult {
  return validateHistoryHasDurationAndType([
    ...history.filter((message) => message.role === "user"),
    { role: "user" as const, content: userMessage },
  ]);
}
