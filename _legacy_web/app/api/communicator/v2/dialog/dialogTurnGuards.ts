import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";
import {
  validateHistoryHasDurationAndType,
  type ValidationResult,
} from "@legacy/app/api/_utils/markers";
import type { DialogFsmState } from "@legacy/app/api/communicator/v2/dialog/dialogFsm";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

export function textFromMessage(message: Pick<MessageRecord, "content" | "transcript">): string {
  return String(message.content ?? message.transcript ?? "").trim();
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

export function userSignalsPlanningDone(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /(?:достаточно|хватит|всё|все|это всё|это все|больше ничего|на сегодня всё|на сегодня все|that's enough|that is enough|enough for today|nothing else|i'm done|i am done)/i.test(
    normalized,
  );
}

const PRACTICE_OFFER_RE =
  /(?:практик|медитаци|дыхан|пранаям|асан|йог|mindfulness|meditation|breath(?:ing)?|asana|yoga practice)/i;

export function assistantOfferedPractice(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (!PRACTICE_OFFER_RE.test(normalized)) return false;
  return /\?/.test(normalized) || /(?:хотите|хочешь|предлож|offer|would you like|want me to)/i.test(normalized);
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

export function userDeclinesPracticeOffer(text: string): boolean {
  return /(?:не надо|не хочу|без практик|не буду|пропуст|потом|позже|не сейчас|обойдёмся|обойдемся|skip|no practice|not now|maybe later|without a practice|without practice)/i.test(
    text,
  );
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
    const lastAssistant = lastAssistantText(history);
    const planningLocked =
      fsm.planningFinalized || assistantFinalizeWithoutMarkers(history) || assistantOfferedPractice(lastAssistant);
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
  locale: "ru" | "en";
  userMessage: string;
  hadPractice: boolean;
}): string {
  const { locale, userMessage, hadPractice } = params;
  if (isGratitudeOrShortAck(userMessage)) {
    if (locale === "en") {
      return hadPractice
        ? "You're welcome. Do the practice when you're ready — have a good day."
        : "You're welcome. Have a good day.";
    }
    return hadPractice
      ? "Пожалуйста. Выполните практику, когда будете готовы — хорошего дня."
      : "Пожалуйста. Хорошего дня.";
  }
  if (locale === "en") {
    return hadPractice
      ? "The practice is already chosen — you can start it from the card above. To end the dialog, use the Exit button below."
      : "You can end the dialog using the Exit button below.";
  }
  return hadPractice
    ? "Практика уже выбрана — начните её с карточки выше. Чтобы завершить диалог, нажмите «Выйти из диалога» внизу."
    : "Диалог можно завершить — нажмите «Выйти из диалога» внизу.";
}

/** Salvage planning markers when the model finalized visibly but forgot invisible markers. */
export function extractPlanningMarkersFromVisibleFinalize(
  text: string,
  locale: "ru" | "en",
): PlannedEventMarker[] {
  const recommendationLabel = locale === "ru" ? "Рекомендация" : "Recommendation";
  const pattern = new RegExp(
    `(\\d+)\\.\\s*([^\\n]+)\\s*\\n\\s*${recommendationLabel}:\\s*([^\\n]+(?:\\n(?!\\d+\\.)[^\\n]+)*)`,
    "gi",
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
      desc: desc.slice(0, 40),
      time: null,
      timeNorm: null,
      recommendation,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : markers.length + 1,
      cells: [{ sphere: 4, weight: 0.5 }, { sphere: 1, weight: 0.5 }],
      snippets: [],
    });
    match = pattern.exec(text);
  }
  return markers;
}

export function userSaysEventDidNotHappen(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:нет|no)[.!?,]*$/i.test(normalized)) return true;
  return /(?:не получил(?:ось|ась)?|не случил(?:ось|ась)?|не состоял(?:ось|ась)?|не был[оа]?|не было|не происходил[оа]?|не прошл[оа]|не успел|не вышло|не сделал|не сделала|не делал|не делала|пропустил|пропустила|не делала? это|didn'?t happen|did not happen|didn'?t manage|did not manage|skipped it)/i.test(
    normalized,
  );
}

/** Server-side clarifying question when the model tries to close a thin answer too early. */
export function buildSummaryClarifyingQuestion(eventDescription: string, locale: "ru" | "en"): string {
  const label = eventDescription.trim() || (locale === "ru" ? "это событие" : "this event");
  const seed = [...label].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  if (locale === "en") {
    const variants = [
      `Thanks. For "${label}", what was the main state you noticed — calm, tension, joy, tiredness, clarity, or something else?`,
      `Got it. To place "${label}" more accurately in the matrix, what did it leave you with emotionally or mentally?`,
      `One small detail about "${label}": was it more about the body, the mood, the mind, or relationships?`,
    ];
    return variants[seed % variants.length]!;
  }
  const variants = [
    `Спасибо. Для «${label}» уточните, пожалуйста, главное состояние: спокойствие, радость, усталость, ясность, напряжение — или что-то другое?`,
    `Понял. Чтобы точнее отметить «${label}» в матрице, скажите одним-двумя словами: какое состояние осталось после этого?`,
    `Хорошо. В «${label}» это больше было про тело, настроение, мысли или отношения? Можно ответить совсем коротко.`,
  ];
  return variants[seed % variants.length]!;
}

export function buildSummaryEventDidNotHappenBridge(
  currentEventDescription: string,
  nextEventDescription: string,
  locale: "ru" | "en",
): string {
  const next = nextEventDescription.trim();
  if (locale === "en") {
    return `I'm sorry it didn't happen. How did "${next}" go?`;
  }
  const prefix = /(?:отмен|перенес|перенёс|не состоя)/i.test(currentEventDescription)
    ? "Понял."
    : "Жаль, что не сложилось.";
  return `${prefix} Как прошёл${next ? ` «${next}»` : " следующий пункт"}?`;
}

/** User confirms the event happened but names no lived state — needs one clarifying question. */
export function userAnswerIsThinForSummary(text: string): boolean {
  if (userSaysEventDidNotHappen(text)) return false;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;
  const claimsDone = /(?:состоял|получил|сделал|было|хорошо|отлично|удалось|нормально|да|yes|it happened|all good|went well)/i.test(
    normalized,
  );
  const namesState = /(?:чувств|ощущ|состояни|споко|тревог|радост|рад\b|довол|удовлетвор|устал|энерг|внимани|ясн|тишин|довер|смят|напряж|расслаб|присутств|собран|вдохнов|интерес|живост|прият|комфорт|общал|друз|шут|вкус|увидел|увидела|понял|поняла|осознал|осознала|инсайт|общ[ау]ю картин|масштаб|перспектив|связ|широк|фокус|felt|calm|anxious|tired|focused|peaceful|satisfied|glad|happy|clear|clarity|insight|perspective|bigger picture|pleasant|comfortable|connected)/i.test(
    normalized,
  );
  return claimsDone && !namesState;
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
