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
  // Bare negation as a standalone reply ("нет", "no", "не, всё") = done adding.
  if (/^(?:нет|не|no|нет[,.\s]+(?:всё|все|спасибо)|не[,.\s]+всё|не[,.\s]+все)[.!?,…\s]*$/i.test(normalized)) {
    return true;
  }
  return /(?:достаточно|хватит|всё|все|это всё|это все|больше ничего|ничего больше|ничего (?:не\s+)?(?:надо|нужно|хочу|добав)|(?:не\s+)?(?:надо|нужно|хочу)\s+(?:ничего|больше)|больше не\s+(?:надо|нужно|хочу)|на сегодня всё|на сегодня все|that's enough|that is enough|enough for today|nothing else|nothing more|that's all|that is all|i'm done|i am done)/i.test(
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
  return /(?:не надо|не хочу|не предлаг|без практик|не буду|пропуст|потом|позже|не сейчас|обойдёмся|обойдемся|skip|no practice|not now|maybe later|without a practice|without practice|don'?t (?:offer|suggest))/i.test(
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
    // Only treat this as "answering a practice offer" when planning has actually
    // finalized — either with markers (planningFinalized) or visibly as a numbered
    // wrap-up that offered a practice (assistantFinalizeWithoutMarkers). We must NOT
    // use a loose assistantOfferedPractice() here: the summarizing FINAL message
    // mentions past practices ("из практик… три коротких медитации") and ends with a
    // question, which would falsely lock planning and skip the whole planning branch
    // when the user's first planning reply merely contains a word like "потом".
    const planningLocked =
      fsm.planningFinalized || assistantFinalizeWithoutMarkers(history);
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
function inferPlanningSpheresFromText(text: string): PlannedEventMarker["cells"] {
  const t = text.toLowerCase();
  const has = (re: RegExp) => re.test(t);
  const scored: number[] = [];
  if (has(/(дом|дач|убор|убра|порядок|крыш|краси|ремонт|кос(и|я)|трав|колодец|безопас|здоров|сон|спать|выспат|лечь|тел[оа]|home|chore|clean|repair|garden|sleep)/)) scored.push(1);
  if (has(/(отдых|релакс|расслаб|прогул|погул|велосипед|катан|купан|плав|озер|море|пляж|природ|кафе|перекус|вкус|ужин|обед|удовольств|бан[яи]|саун|rest|relax|walk|swim|bike|beach|nature|cafe|lunch|dinner)/)) scored.push(2);
  if (has(/(работ|задач|проект|деньг|бизнес|результат|дедлайн|клиент|совещ|заработ|карьер|work|task|project|money|deadline|client|meeting)/)) scored.push(3);
  if (has(/(друз|семь|близк|родител|жена|муж[ае]|свидан|отношени|помир|родн|friend|family|relationship|date\b)/)) scored.push(4);
  if (has(/(творч|рисов|музык|стих|песн|самовыраж|искусств|creativ|paint|music|poem|art)/)) scored.push(5);
  if (has(/(учеб|обуч|изуч|познан|курс|лекц|разобрат|исследов|study|learn|course|research)/)) scored.push(6);
  if (has(/(вер[ауы]|молит|духов|медита|смысл\s+жизни|призван|сакрал|паломн|faith|pray|spiritual|medita|sacred|pilgrim)/)) scored.push(7);
  if (!scored.length) return [{ sphere: 1, weight: 1 }];
  const top = scored.slice(0, 2);
  const weight = top.length === 1 ? 1 : 0.5;
  return top.map((sphere) => ({ sphere, weight }));
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
      desc: clampPlanningDesc(desc),
      time: null,
      timeNorm: null,
      recommendation,
      displayOrder: Number.isFinite(displayOrder) ? displayOrder : markers.length + 1,
      cells: inferPlanningSpheresFromText(`${desc} ${recommendation}`),
      snippets: [],
    });
    match = pattern.exec(text);
  }
  return markers;
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

export function userSaysEventDidNotHappen(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:нет|no|нету|не)[.!?,…\s]*$/i.test(normalized)) return true;
  if (NON_OCCURRENCE_RU.test(normalized)) return true;
  if (NON_OCCURRENCE_EN.test(normalized)) return true;
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
  if (/(?:работ|задач|проект|совещ|клиент|дедлайн|код|разработ|бизнес|дел[ао]\s+по\s+работ)/i.test(lower)) {
    return "work";
  }
  if (/(?:озер|природ|прогул|погул|парк|отдых|купан|море|лес|пляж|кафе|сон|поспать|расслаб|баня|саун|поездк)/i.test(lower)) {
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
export function buildSummaryClarifyingQuestion(eventDescription: string, locale: "ru" | "en"): string {
  const label = eventDescription.trim() || (locale === "ru" ? "это событие" : "this event");
  const domain = summaryEventDomain(label);
  const seed = [...label].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  if (locale === "en") {
    const byDomain: Record<SummaryEventDomain, string[]> = {
      work: [
        "What filled that work — were you absorbed in it, mostly coordinating with people, holding tight focus, or were there frictions and breakthroughs?",
        "How did the work feel from the inside — driven and focused, collaborative, or more draining than rewarding?",
      ],
      rest: [
        "How did it feel — more bodily relaxation, quiet pleasure, a lift in mood, or simply being present?",
        "What did that give you inside — rest for the body, calm, or a bit of joy?",
      ],
      social: [
        "How was that with the other person — warm and close, light, or a little tense?",
        "What did it feel like inside — closeness, ease, or something you had to work through?",
      ],
      creative: [
        "What did it stir in you — calm, a spark of interest, or a sense of meaning?",
        "How did it land — restful, inspiring, or thought-provoking?",
      ],
      tiny: [
        "How did that feel — was it easy to follow through on, and did it leave you a bit more settled?",
      ],
      generic: [
        "How did that feel from the inside — what state were you mostly in there?",
        "What did you mostly live through there — in a word or two?",
      ],
    };
    const variants = byDomain[domain];
    return variants[seed % variants.length]!;
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
      "А что это в вас затронуло: спокойствие, интерес, или ощущение смысла?",
      "Как это отозвалось: отдыхом, вдохновением — или поводом подумать о важном?",
    ],
    tiny: [
      "А как это вышло: удалось ли, и стало ли от этого чуть спокойнее?",
    ],
    generic: [
      `А что было сильнее ${phrase}: спокойствие, радость, общение, ясность — или что-то другое?`,
      "А что вы там в основном проживали внутри? Можно совсем коротко.",
    ],
  };
  const variants = byDomain[domain];
  return variants[seed % variants.length]!;
}

export function assistantAskedSummaryClarifyingQuestion(
  text: string,
  nextEventDescription?: string | null,
): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || !/\?/.test(normalized)) return false;
  const next = nextEventDescription?.trim().toLowerCase();
  if (next && next.length >= 4 && normalized.includes(next)) return false;
  return /(?:уточн|какие состояния|какое состояние|в какой момент|что вы проживали|что вы проживал|что осталось|как вы себя чувств|матриц|body|mood|mind|relationships|what states|what state|which moment|how did you feel|clarify|matrix)/i.test(
    normalized,
  );
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
  return `${prefix} Как прошёл следующий пункт${next ? ` — ${next}` : ""}?`;
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
