import { DateTime } from "luxon";

import type { AppContentLocale } from "@legacy/app/api/_utils/contentLocales";
import { SOURCE_LOCALE } from "@legacy/app/api/_utils/contentLocales";
import {
  chakraAttentionPrefixFor,
  chakraOrdinalLabel,
  getDialogScaffoldStrings,
  interpolate,
} from "@legacy/app/api/_utils/dialogScaffold";
import type { DialogTimeOfDay } from "@legacy/app/api/_utils/dialogTimeOfDay";
import { dayPartRhetoricInstruction, greetingInstructionForTimeOfDay } from "@legacy/app/api/_utils/dialogTimeOfDay";
import { visibleTextHasLeakedDialogMarkup, type PlannedEventMarker } from "@legacy/app/api/_utils/markers";

/**
 * Three short, focused prompts for the explicit dialog FSM, with an English
 * "core" and Russian (or user-locale) data injected as values. Each turn runs
 * exactly one of these. The shared preamble carries day context, friendly tone
 * and the day's target chakra; the branch sections carry the single job for
 * that branch and the single marker type to emit.
 *
 * CACHING CONTRACT (important): `systemInstruction` is ONLY the day-stable
 * shared preamble — byte-identical across every turn and every branch of the
 * same dialog. All branch-specific and per-turn instructions go into
 * `userInstruction`, which the route sends as the final user message. The
 * route's request is therefore `[system(stable), ...history(grows), userMsg,
 * directive]`, so DeepSeek's automatic prefix caching keeps the whole
 * `system + history` prefix warm on every turn after the first. Do NOT move
 * per-turn data back into the preamble or the prefix cache will be invalidated
 * each turn (DeepSeek matches the cached prefix from message[0]).
 */

export type BrainPromptContext = {
  locale: AppContentLocale;
  languageName: string;
  /** When the user speaks/types in another language (e.g. RU in test mode), do not mirror it. */
  inputLanguageName?: string | null;
  addressForm: string;
  dayOfWeek: string;
  dateLabel: string;
  timeOfDay: DialogTimeOfDay;
  /** Local hour 0–23 for early-morning rhetoric guard (00:00–03:00). */
  localHour: number;
  phaseTime: string;
  targetChakraNumber: number;
  targetChakraLabel: string;
  targetChakraAccusative: string;
  targetChakraGenitive: string;
  targetChakraExplain: string;
  harmonicStates: string[];
  dissonantStates: string[];
  planetOfDay: string;
  tonalRegister: string;
  lifeSpheresBaseline: string;
  planningSphereLens: string | null;
  existingDayFocus: string | null;
};

export type SummarizingTurnInput = {
  isOpening: boolean;
  currentEvent: { ref: string; description: string } | null;
  nextEvent: { description: string } | null;
  completedEarlierEvents: Array<{ description: string }>;
  isLastEvent: boolean;
  clarifyingAlreadyAsked: boolean;
  healthContext: string;
  practicesContext: string;
  /** Calendar date of the day being summarized (YYYY-MM-DD). */
  summaryWorkingLocalDate: string | null;
  /** Calendar date of the current event (YYYY-MM-DD), when known. */
  currentEventPlannedLocalDate: string | null;
  /** When true, after the final summary the dialogue continues into PLANNING. */
  continuesToPlanning: boolean;
};

export function formatLocalDateForPrompt(localDate: string, locale: AppContentLocale): string {
  const parsed = DateTime.fromISO(localDate, { zone: "utc" });
  if (!parsed.isValid) return localDate;
  return parsed.setLocale(locale).toFormat("d MMMM yyyy");
}

/** Deterministic visible list for planning finalize — matches Day tab action titles. */
export function ensureSentencePunctuation(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (/[:;]$/.test(text)) return text;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/**
 * Deterministic safety net for the recurring "spontaneous English word" bug.
 * DeepSeek occasionally drops a stray English word into otherwise-Russian text
 * (e.g. "рутинный task", "пусть ответ quietly присутствует"). The prompt forbids
 * this, but the model is not fully reliable, so we also replace a curated set of
 * the most common offenders with Russian equivalents. Only whole Latin tokens
 * are touched; unknown Latin tokens are left as-is (they are rarer and may be a
 * term the user named, e.g. SQL).
 */
const SPONTANEOUS_ENGLISH_RU: Array<[RegExp, string]> = [
  [/\btasks\b/gi, "задачи"],
  [/\btask\b/gi, "задача"],
  [/\bmindfully\b/gi, "осознанно"],
  [/\bmindfulness\b/gi, "осознанность"],
  [/\bmindful\b/gi, "осознанно"],
  [/\bquietly\b/gi, "тихо"],
  [/\bgently\b/gi, "мягко"],
  [/\bsoftly\b/gi, "мягко"],
  [/\bslowly\b/gi, "медленно"],
  [/\bdeeply\b/gi, "глубоко"],
  [/\beffortlessly\b/gi, "без усилий"],
  [/\bflow\b/gi, "поток"],
  [/\bmindset\b/gi, "настрой"],
  [/\binsight\b/gi, "озарение"],
  [/\bawareness\b/gi, "осознанность"],
  [/\bpresence\b/gi, "присутствие"],
  [/\bfocus\b/gi, "фокус"],
  [/\bbalance\b/gi, "баланс"],
  [/\bflowing\b/gi, "плавно"],
  // Cyrillic neighbours break JS `\b`, so match the phrase without word-boundaries.
  [/вашим\s+usual/gi, "вашим обычным"],
  [/ваш\s+usual/gi, "ваш обычный"],
  [/\busual\b/gi, "обычный"],
  [/\bdays\b/gi, "дни"],
  [/\bday\b/gi, "день"],
];

export function replaceSpontaneousEnglishRu(text: string): string {
  let out = text ?? "";
  for (const [pattern, replacement] of SPONTANEOUS_ENGLISH_RU) {
    out = out.replace(pattern, (match) => {
      const firstChar = match.charAt(0);
      const isCapitalized = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
      return isCapitalized ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
    });
  }
  return out;
}

export function chakraAttentionPrefix(chakraNumber: number, locale: AppContentLocale): string {
  return chakraAttentionPrefixFor(locale, chakraNumber);
}

/**
 * Safety net only: prepend the chakra attention phrase to a day-recommendation
 * text when the text does NOT already name the day's chakra. The model is now
 * instructed to name the chakra itself inside the recommendation, so in the
 * normal case this is a no-op; it fires only when the model forgot.
 */
export function prependChakraAttention(text: string | null | undefined, chakraNumber: number, locale: AppContentLocale): string {
  const value = (text ?? "").trim();
  const prefix = chakraAttentionPrefix(chakraNumber, locale);
  if (!prefix) return value;
  // The model already mentioned a chakra anywhere in the text → leave it as-is.
  if (/чакр|chakra/i.test(value)) return value;
  return value ? `${prefix}${value}` : prefix.trim();
}

function polishRuRecommendationText(value: string): string {
  let text = value.trim().replace(/\b1-2\b/g, "одну-две");
  const replacements: Array<[RegExp, string]> = [
    [/^Перед стартом выделить\b/i, "Перед стартом выделите"],
    [/^Перед началом выделить\b/i, "Перед началом выделите"],
    [/^Выделить\b/i, "Выделите"],
    [/^Задать\b/i, "Задайте"],
    [/^Осознанно выбрать\b/i, "Осознанно выберите"],
    [/^Выбрать\b/i, "Выберите"],
    [/^Сохранить\b/i, "Сохраните"],
    [/^Начать\b/i, "Начните"],
    [/^Сделать\b/i, "Сделайте"],
    [/^Проверить\b/i, "Проверьте"],
    [/^Уточнить\b/i, "Уточните"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(text)) {
      text = text.replace(pattern, replacement);
      break;
    }
  }
  return text;
}

export function polishPlanningRecommendation(value: string | null | undefined, locale: AppContentLocale): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const deEnglished = locale === SOURCE_LOCALE ? replaceSpontaneousEnglishRu(raw) : raw;
  const polished = locale === SOURCE_LOCALE ? polishRuRecommendationText(deEnglished) : deEnglished;
  return capitalizeFirstLetter(ensureSentencePunctuation(polished));
}

/** Uppercases the first letter (RU/EN) without touching the rest of the title. */
export function capitalizeFirstLetter(value: string): string {
  const trimmed = value.trimStart();
  if (!trimmed) return value;
  const first = trimmed[0]!;
  const upper = first.toLocaleUpperCase("ru");
  if (upper === first) return value;
  const lead = value.slice(0, value.length - trimmed.length);
  return `${lead}${upper}${trimmed.slice(1)}`;
}

export function polishPlanningMarker(event: PlannedEventMarker, locale: AppContentLocale): PlannedEventMarker {
  return {
    ...event,
    desc: capitalizeFirstLetter(event.desc),
    recommendation: polishPlanningRecommendation(event.recommendation, locale) || event.recommendation,
  };
}

export function buildPlanningActionsVisibleBlock(
  events: PlannedEventMarker[],
  locale: AppContentLocale,
): string {
  const recommendationLabel = getDialogScaffoldStrings(locale).recommendationLabel;
  return [...events]
    .sort((left, right) => (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER))
    .map((event, index) => {
      // Always renumber 1..n — model often emits several actions with display_order=1.
      const order = index + 1;
      const title = event.desc.trim();
      const recommendation = polishPlanningRecommendation(event.recommendation, locale);
      return recommendation
        ? `${order}. ${title}\n${recommendationLabel}: ${recommendation}`
        : `${order}. ${title}`;
    })
    .join("\n\n");
}

/** Replace a broken numbered list in model text with marker-backed action titles. */
export function injectPlanningActionsVisibleList(
  visibleText: string,
  events: PlannedEventMarker[],
  locale: AppContentLocale,
): string {
  if (!events.length) return visibleText;
  const block = buildPlanningActionsVisibleBlock(events, locale);
  const numberedListStart = findNumberedActionListStart(visibleText);
  if (numberedListStart >= 0) {
    const intro = visibleText.slice(0, numberedListStart).trimEnd();
    const afterList = visibleText.slice(numberedListStart);
    const trailingMatch = afterList.match(/\n\n([^\d\n][\s\S]*)$/);
    const trailing = trailingMatch?.[1]?.trim() ?? "";
    const parts = [intro, block];
    if (trailing) parts.push(trailing);
    return parts.join("\n\n");
  }
  return `${visibleText.trimEnd()}\n\n${block}`;
}

/** Align visible day-focus paragraph with [CORRECT_RECOMMENDATION] (Day tab header uses the marker). */
export function injectPlanningDayFocus(visibleText: string, dayFocus: string): string {
  const focus = stripPlanningDayFocusScaffold(dayFocus);
  if (!focus) return visibleText;
  const listStart = findNumberedActionListStart(visibleText);
  if (listStart < 0) return visibleText;
  const beforeList = visibleText.slice(0, listStart).trimEnd();
  const listAndAfter = visibleText.slice(listStart);
  const paragraphs = beforeList.split(/\n\n+/).filter((part) => part.trim().length > 0);
  if (paragraphs.length === 0) return `${focus}\n${listAndAfter}`;
  const looksLikeDayFocus = (text: string) =>
    /(?:энерг|чакр|ясност|главн|прожив|focus|chakra|energy|clarity|live the day)/i.test(text);
  if (paragraphs.length === 1) {
    return looksLikeDayFocus(paragraphs[0]!)
      ? `${focus}${listAndAfter}`
      : `${paragraphs[0]}\n\n${focus}${listAndAfter}`;
  }
  const opener = paragraphs.slice(0, -1).join("\n\n");
  return `${opener}\n\n${focus}${listAndAfter}`;
}

/**
 * Drop conversational planning scaffolding from a day-recommendation paragraph.
 * Phrases like "Хорошо, собираю план." belong in the chat bubble during gathering,
 * never in Day-tab `recommendation_short_text` or the planning FINAL intro.
 * Locale-agnostic: matches common ack / "assembling the plan" lead-ins across
 * the 8 supported locales, then trims leftover whitespace.
 */
export function stripPlanningDayFocusScaffold(text: string | null | undefined): string {
  let value = (text ?? "").trim();
  if (!value) return "";

  // Whole-paragraph scaffold only (no real recommendation left).
  const scaffoldOnly =
    /^(?:хорошо[^.?!…]*собираю\s+план|договорились(?:[^.?!…]{0,60})?|тогда\s+подведу\s+итог(?:[^.?!…]{0,60})?|собираю\s+(?:ваш\s+)?план|okay[^.?!…]{0,40}(?:putting|assembling|building)[^.?!…]{0,40}plan|all\s+right[^.?!…]{0,40}(?:plan)?|got\s+it|d['']accord[^.?!…]{0,40}(?:plan|note)?|in\s+ordnung|verstanden|va\s+bene|de\s+acuerdo|akkoord)[.!?…]*$/iu;
  if (scaffoldOnly.test(value)) return "";

  // Leading scaffold sentence(s) glued onto the real recommendation.
  const leadingScaffold =
    /^(?:хорошо[^.?!…]*собираю\s+план|хорошо,\s*записываю|договорились(?:[^.?!…]{0,50})?|тогда\s+подведу\s+итог(?:[^.?!…]{0,50})?|собираю\s+(?:ваш\s+)?план|понял(?:а|о)?(?:\s+вас)?(?:[^.?!…]{0,30})?|отлично(?:[^.?!…]{0,30})?|okay[^.?!…]{0,50}(?:putting|assembling|building)[^.?!…]{0,40}plan|okay[^.?!…]{0,30}|all\s+right[^.?!…]{0,40}|got\s+it[^.?!…]{0,30}|d['']accord[^.?!…]{0,50}|in\s+ordnung[^.?!…]{0,30}|verstanden[^.?!…]{0,30}|va\s+bene[^.?!…]{0,30}|de\s+acuerdo[^.?!…]{0,30}|akkoord[^.?!…]{0,30})\s*[.!?…]\s*/iu;

  for (let i = 0; i < 3; i += 1) {
    const next = value.replace(leadingScaffold, "").trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function fallbackPracticeQuestion(locale: AppContentLocale): string {
  return getDialogScaffoldStrings(locale).fallbackPracticeQuestion;
}

function fallbackSoftPracticeClose(locale: AppContentLocale, targetChakraNumber: number): string {
  const ordinal = chakraOrdinalLabel(locale, targetChakraNumber);
  return interpolate(getDialogScaffoldStrings(locale).fallbackSoftPracticeClose, { ordinal });
}

/** Index of the first numbered action item (`1.` / `1)`), including at start of text. */
function findNumberedActionListStart(visibleText: string): number {
  const match = /(?:^|\n)(\s*\d+[.)]\s)/m.exec(visibleText);
  if (!match || match.index == null) return -1;
  return match[0].startsWith("\n") ? match.index + 1 : match.index;
}

function paragraphLooksLikeNumberedAction(text: string): boolean {
  return /^\s*\d+[.)]\s+\S/.test(text.trim());
}

function introHasWrongActionCount(text: string, eventCount: number): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const mentionsActions = /(?:дел[ао]|вещ[ьи]|событи|action|item|thing)/i.test(normalized);
  if (!mentionsActions) return false;
  const countWords: Record<number, RegExp> = {
    1: /(?:\b1\b|одно|одна|one)/i,
    2: /(?:\b2\b|два|две|two)/i,
    3: /(?:\b3\b|три|three)/i,
  };
  return Object.entries(countWords).some(([count, pattern]) => Number(count) !== eventCount && pattern.test(normalized));
}

/**
 * Salvage the day-recommendation paragraph from a visible planning finalize when
 * the model forgot the [CORRECT_RECOMMENDATION] marker. Picks the single most
 * recommendation-like paragraph that appears before the numbered action list
 * (skipping short acks, questions, the action items, and practice mentions).
 * Returns "" if nothing usable was found.
 */
export function extractDayFocusFromVisibleFinalize(visibleText: string, eventCount: number): string {
  const listStart = findNumberedActionListStart(visibleText);
  const beforeList = listStart >= 0 ? visibleText.slice(0, listStart) : visibleText;
  const candidates = beforeList
    .split(/\n\n+/)
    .map((part) => stripPlanningDayFocusScaffold(part.trim()))
    .filter((part) =>
      part
      && !paragraphLooksLikeNumberedAction(part)
      && !/[?？]/.test(part)
      && !introHasWrongActionCount(part, eventCount)
      && !/(?:ещ[её]\s+что|что-то\s+ещ[её]|anything else|nothing else|add something|something else)/i.test(part)
      && !/\[(?:PLANNED_EVENT|CORRECT_RECOMMENDATION|PRACTICE_PICK)\b/i.test(part)
      && !visibleTextHasLeakedDialogMarkup(part)
      && !/(?:практик|медитаци|дыхан|асан|йог|practice|meditation|breath|asana|yoga)/i.test(part)
    );
  if (candidates.length === 0) return "";
  // Prefer the longest qualifying paragraph (the recommendation), which lets short
  // lead-in acks like "Договорились. Тогда подведу итог." fall away.
  const best = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  return best.length >= 80 ? ensureSentencePunctuation(best).trim() : "";
}

function extractPlanningIntro(visibleText: string, fallbackFocus: string | null | undefined, eventCount: number): string {
  // The canonical day recommendation is the [CORRECT_RECOMMENDATION] short_text
  // (this is what the Day tab header stores). Prefer it verbatim so the visible
  // planning final and the saved Day-tab recommendation are exactly the same
  // text. Only fall back to extracting an intro from the model's free visible
  // text when short_text is missing or too thin.
  const focus = stripPlanningDayFocusScaffold(fallbackFocus);
  if (focus.length >= 80) return ensureSentencePunctuation(focus);
  const listStart = findNumberedActionListStart(visibleText);
  const beforeList = (listStart >= 0 ? visibleText.slice(0, listStart) : visibleText)
    .split(/\n\n+/)
    .map((part) => stripPlanningDayFocusScaffold(part.trim()))
    .filter((part) =>
      part
      && !paragraphLooksLikeNumberedAction(part)
      && !/[?？]/.test(part)
      && !introHasWrongActionCount(part, eventCount)
      && !/(?:ещ[её]\s+что|что-то\s+ещ[её]|anything else|nothing else|add something|something else)/i.test(part)
      && !/\[(?:PLANNED_EVENT|CORRECT_RECOMMENDATION|PRACTICE_PICK)\b/i.test(part)
      && !visibleTextHasLeakedDialogMarkup(part)
      && !/(?:практик|медитаци|дыхан|асан|йог|practice|meditation|breath|asana|yoga)/i.test(part)
    )
    .map(stripGluedNumberedActionSuffix)
    .filter(Boolean)
    .join("\n\n");
  if (beforeList.length >= 80) return ensureSentencePunctuation(beforeList);
  return ensureSentencePunctuation(focus);
}

/** "Внимание на чакру. 1. Action…" → keep only the sentence before the glued list. */
function stripGluedNumberedActionSuffix(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (paragraphLooksLikeNumberedAction(trimmed)) return "";
  const glued = /([.!?…])\s*\d+[.)]\s+\S/u.exec(trimmed);
  if (!glued || glued.index == null) return trimmed;
  return trimmed.slice(0, glued.index + 1).trimEnd();
}

function actionCountWord(count: number, locale: AppContentLocale): string {
  if (locale !== SOURCE_LOCALE) return `${count}`;
  if (count === 1) return "одно";
  if (count === 2) return "два";
  if (count === 3) return "три";
  return `${count}`;
}

/** Day-tab actions the client sends in `triggerMeta.dayActions` for add/plan flows. */
export function countDayTabActionsFromTriggerMeta(
  triggerMeta: Record<string, unknown>,
  workingLocalDate: string,
): number {
  const actions = triggerMeta.dayActions;
  if (!Array.isArray(actions)) return 0;
  return actions.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as { status?: string; localDate?: string };
    if (row.localDate && row.localDate !== workingLocalDate) return false;
    const status = row.status;
    return status !== "cancelled" && status !== "canceled" && status !== "dismissed";
  }).length;
}

function planningAddIntro(count: number, locale: AppContentLocale): string {
  const s = getDialogScaffoldStrings(locale);
  if (locale === SOURCE_LOCALE) {
    const noun = count === 1 ? "дело" : "дела";
    return `Хорошо, добавил ${actionCountWord(count, locale)} ${noun} в план на сегодня:`;
  }
  if (count === 1) return s.planningAddIntro_one;
  return interpolate(s.planningAddIntro_other, { count });
}

/** Deterministic planning final assembled from persisted marker data. */
export function buildPlanningFinalVisibleText(params: {
  visibleText: string;
  events: PlannedEventMarker[];
  dayFocus: string | null | undefined;
  locale: AppContentLocale;
  includePracticeQuestion: boolean;
  /** Oracle/Free: soft yoga nudge + Master catalog note (no question). */
  includeSoftPracticeClose?: boolean;
  targetChakraNumber?: number;
}): string {
  const {
    visibleText,
    events,
    dayFocus,
    locale,
    includePracticeQuestion,
    includeSoftPracticeClose,
    targetChakraNumber,
  } = params;
  const parts: string[] = [];
  let focus = extractPlanningIntro(visibleText, dayFocus, events.length);
  if (typeof targetChakraNumber === "number") {
    // Even with an empty intro, still emit the chakra attention safety-net line.
    focus = prependChakraAttention(focus, targetChakraNumber, locale);
  }
  if (focus) parts.push(focus);
  parts.push(buildPlanningActionsVisibleBlock(events, locale));
  if (includePracticeQuestion) {
    parts.push(fallbackPracticeQuestion(locale));
  } else if (includeSoftPracticeClose && typeof targetChakraNumber === "number") {
    parts.push(fallbackSoftPracticeClose(locale, targetChakraNumber));
  }
  return parts.filter((part) => part.trim()).join("\n\n");
}

/** Deterministic add-flow final: never trusts the model's count or proposed-but-rejected items. */
export function buildPlanningAddFinalVisibleText(params: {
  events: PlannedEventMarker[];
  locale: AppContentLocale;
}): string {
  const { events, locale } = params;
  const intro = planningAddIntro(events.length, locale);
  return [intro, buildPlanningActionsVisibleBlock(events, locale)].join("\n\n");
}

/**
 * Deterministic, warm closing when the user declines to plan the day. Ends the
 * dialogue gracefully (no practice branch follows) and gently explains why
 * planning matters, without naming any calendar date.
 */
export function buildPlanningDeclinedReply(locale: AppContentLocale): string {
  const s = getDialogScaffoldStrings(locale);
  return [s.planningDeclined_p1, s.planningDeclined_p2, s.planningDeclined_p3].join("\n\n");
}

export type PlanningTurnInput = {
  isOpening: boolean;
  noPractice: boolean;
  /**
   * Oracle/Free home/plan: after wrap-up, soft close about today's chakra practice
   * + Master catalog note — no kind/duration question. Day-tab add keeps
   * `noPractice` without this flag (end with no practice paragraph).
   */
  softPracticeClose?: boolean;
  noGreeting: boolean;
  /** User signaled they are done naming actions — this turn must emit markers. */
  userSignaledDone: boolean;
  /**
   * Previous assistant turn asked whether to add more or assemble the plan.
   * THIS TURN must judge the reply by meaning (any language), not by matching phrases.
   */
  answeringClosureQuestion?: boolean;
  /**
   * The assistant already asked add-more/assemble once, the user replied unclearly,
   * and the assistant already asked a one-shot clarifier. This reply must decide.
   */
  alreadyClarifiedClosure?: boolean;
  /** Planning finalize already happened; do not re-emit PLANNED_EVENT or repeat the wrap-up. */
  planningLocked: boolean;
  /** Count of actions ALREADY planned for the day at the start of this turn (drives the add-flow opening). */
  existingActionCount: number;
  /** Sphere-balance facts for Day-tab add opening (optional; same stats as Day-tab sphereHint). */
  addFlowSphereBalanceLens?: string | null;
};

export type PracticeTurnInput = {
  isOpening: boolean;
  /** User already named a clear practice type + duration — pick immediately. */
  pickImmediately: boolean;
  /** Catalog reconciliation instruction when type/duration conflict. */
  catalogReconciliation: string;
  /** After a practice card was already shown — only a short wind-down reply. */
  postPracticeReply: boolean;
};

const PRACTICE_KIND_LABELS: Record<AppContentLocale, Record<"breath" | "meditation" | "yoga", string>> = {
  ru: { breath: "дыхание", meditation: "медитацию", yoga: "асаны" },
  en: { breath: "breathing", meditation: "meditation", yoga: "asanas" },
  de: { breath: "Atmung", meditation: "Meditation", yoga: "Asanas" },
  fr: { breath: "respiration", meditation: "méditation", yoga: "asanas" },
  it: { breath: "respirazione", meditation: "meditazione", yoga: "asana" },
  es: { breath: "respiración", meditation: "meditación", yoga: "asanas" },
  pt: { breath: "respiração", meditation: "meditação", yoga: "asanas" },
  nl: { breath: "ademhaling", meditation: "meditatie", yoga: "asana's" },
};

/**
 * Deterministic, user-facing fallback for the practice branch so a turn never
 * ends up with empty visible text (which used to crash the client with
 * "Assistant reply was empty after hydration"). When the user named a type +
 * duration that the catalog cannot satisfy (e.g. 30-min breathing), it offers a
 * concrete reconciliation; otherwise it asks the generic practice question.
 */
export function buildPracticeClarificationFallback(params: {
  locale: AppContentLocale;
  kind: "breath" | "meditation" | "yoga" | null;
  requestedDurationMin: number | null;
  range: { min: number; max: number } | null;
  altKind: "breath" | "meditation" | "yoga" | null;
}): string {
  const { locale, kind, requestedDurationMin, range, altKind } = params;
  const s = getDialogScaffoldStrings(locale);
  const kindLabels = PRACTICE_KIND_LABELS[locale] ?? PRACTICE_KIND_LABELS.en;
  if (kind && range && requestedDurationMin != null && altKind && altKind !== kind) {
    if (locale === SOURCE_LOCALE) {
      const kindRu = kindLabels[kind];
      const altRu = kindLabels[altKind];
      return `Здесь ${kindRu} идёт ${range.min}–${range.max} минут. Хотите ${kindRu} на ${range.max} минут или ${altRu} примерно на ${requestedDurationMin} минут?`;
    }
    return interpolate(s.practiceClarify_mismatch, {
      kind: kindLabels[kind],
      altKind: kindLabels[altKind],
      min: range.min,
      max: range.max,
      duration: requestedDurationMin,
    });
  }
  return fallbackPracticeQuestion(locale);
}

function greetingInstruction(ctx: BrainPromptContext): string {
  return greetingInstructionForTimeOfDay(ctx.timeOfDay, ctx.locale, ctx.addressForm, ctx.localHour);
}

function tonalRegisterInstruction(ctx: BrainPromptContext): string {
  if (!ctx.tonalRegister.trim()) return "";
  return ctx.locale === SOURCE_LOCALE
    ? `Тональный окрас дня (планета ${ctx.planetOfDay}): ${ctx.tonalRegister} Это обязательная фоновая настройка для всех веток (summarizing, planning, practice). Не называйте её явно, но держите в интонации, ритме и выборе слов.`
    : `Tonal register for today (planet ${ctx.planetOfDay}): ${ctx.tonalRegister} This colors all branches (summarizing, planning, practice). Do not name it explicitly, but keep it in tone, rhythm, and word choice.`;
}

function inputLanguageDecouplingInstruction(ctx: BrainPromptContext): string {
  const input = ctx.inputLanguageName?.trim();
  if (!input || input === ctx.languageName) return "";
  return `The user may speak or type in ${input}. Your visible reply must still be entirely in ${ctx.languageName} — never mirror the user's input language, even when their message is in ${input}.`;
}

function sharedPreamble(ctx: BrainPromptContext): string {
  return [
    "You are the HARMONIZER daily companion: a warm, grounded friend with a background in yoga and psychology.",
    `Always write your visible reply in ${ctx.languageName}, phrased the way a native speaker of that language actually talks — natural and idiomatic, never a stiff word-for-word translation from another language. It should feel like talking to a real person, not to an AI. Keep a friendly, human, conversational tone — like a thoughtful friend, not a clinician. Be concise: outside of explicit "final" messages, keep replies to a few short sentences.`,
    inputLanguageDecouplingInstruction(ctx),
    ctx.locale === SOURCE_LOCALE
      ? ""
      : "If later instructions include examples or quoted phrases in another language, treat them as semantic examples only. Never copy their language into the visible reply — the visible reply must stay entirely in the target language above.",
    ctx.locale === SOURCE_LOCALE
      ? "Естественность речи: пиши так, как говорит живой человек по-русски — «удалось ли почитать книгу», а не «удалось ли устроить чтение книги»; «как прошла поездка», а не канцелярит. Избегай переводных и канцелярских оборотов."
      : "",
    ctx.locale === SOURCE_LOCALE
      ? `Обращайся к пользователю на «${ctx.addressForm}».`
      : "Address the user naturally.",
    greetingInstruction(ctx),
    dayPartRhetoricInstruction(ctx.localHour, ctx.locale),
    tonalRegisterInstruction(ctx),
    "Ask at most ONE real question per turn.",
    "Do not repeat the user's facts back in slightly different words unless a very short bridge is needed.",
    "No awkward metaphors, no astrological poetry, no weather/cosmic imagery, no pseudo-therapeutic filler.",
    "Use plain warm language. Outside branch finals, do not sound like a psychologist delivering an interpretation.",
    "Punctuation style: no multiple exclamation marks; at most one exclamation mark in the whole reply, and only when it sounds natural.",
    ctx.locale === SOURCE_LOCALE
      ? "Пиши целиком по-русски. Не вставляй спонтанные английские слова (например quietly, mindfully, flow, gently, day, usual) — всегда подбирай русский эквивалент. Иностранный термин допустим, только если сам пользователь назвал его так (например профессиональный термин)."
      : `Keep the visible reply in one language only (${ctx.languageName}). Do not mix in words from English or any other language (no stray borrowings like day, usual, quietly, mindset) unless the user themselves used that exact term.`,
    "",
    "DAY CONTEXT (data, do not read aloud verbatim):",
    `- Date: ${ctx.dayOfWeek}, ${ctx.dateLabel}; time of day: ${ctx.timeOfDay}; day phase: ${ctx.phaseTime}.`,
    `- Today's focus chakra: number ${ctx.targetChakraNumber} (${ctx.targetChakraLabel}).`,
    `- Why this chakra is today's focus (rationale for you, do not read aloud verbatim): ${ctx.targetChakraExplain}`,
    `- Planet of the day (sets the conversational tone/register; may differ from the focus chakra): ${ctx.planetOfDay}.`,
    `- Harmonic states of this chakra (use to recommend the "wave" to live in): ${ctx.harmonicStates.slice(0, 12).join(", ")}.`,
    `- Dissonant states of this chakra (to gently recommend to avoid): ${ctx.dissonantStates.slice(0, 10).join(", ")}.`,
    "",
    "CHAKRA NAMING RULE: never use Sanskrit chakra names. Refer to chakras only by ordinal number / the provided label.",
    "LIFE SPHERES (for sphere tagging, 1..7):",
    ctx.lifeSpheresBaseline,
    "",
    "MARKERS: emit invisible markers exactly as specified, using square brackets only — [PLANNED_EVENT: ...], never XML/HTML tags like <PLANNED_EVENT> or </PLANNED_EVENT>. They are parsed by the server and stripped from the visible text. Never use double quotes inside a marker value. Visible text must stay natural language only: no tag names, no attributes like display_order= or spheres=.",
  ].filter(Boolean).join("\n");
}

export function buildSummarizingPrompt(ctx: BrainPromptContext, input: SummarizingTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: SUMMARIZING — review how past planned events actually went, one event at a time.",
    "Rules:",
    ctx.locale === SOURCE_LOCALE
      ? "- Не называйте календарные даты в видимом тексте. Говорите только названиями событий (например «прогулка в парке», «выбор саженцев»). Никогда не используйте «вчера», «сегодня», «завтра» и подобные слова."
      : "- Do NOT name calendar dates in visible text. Refer to events by their titles only (for example walk in the park, apple saplings). Never use yesterday, today, tomorrow, or similar words.",
    ctx.locale === SOURCE_LOCALE
      ? "- Не ставьте названия событий в кавычки в видимом тексте. Вплетайте событие разговорно: «когда вы работали с задачами», «во время визита в автосервис», либо говорите «это действие», если заголовок трудно склонить."
      : "- Do not put event titles in quotation marks in visible text. Weave the event naturally into the sentence, or say \"this event\" if the title is hard to inflect.",
    "- Work strictly on ONE event at a time. Do not list or pre-empt other events.",
    "- Until you emit [SUMMARIZE_EVENT] for the current event, your visible reply must discuss ONLY that event. Never ask about or mention another event in the same turn.",
    "- If you need a clarifying question, ask exactly ONE question about the current event only — no marker, no interpretation, no feedback, no other events.",
    "- ONE-OR-THE-OTHER per turn (CRITICAL): a turn is EITHER (a) a single clarifying question about the CURRENT event — then emit NO [SUMMARIZE_EVENT] marker and do NOT mention or ask about the next event; OR (b) you close the current event with [SUMMARIZE_EVENT] and then bridge to the next one. NEVER do both in one turn — never ask a clarifying question AND close, and never bundle a question about the closed event together with a question about the next event. The user must always know which single event your question is about, so their answer can never be mis-attributed.",
    "- FORBIDDEN SHAPE: do not write a visible reply like 'question about the current event ... ? And how did the next event go?' If the current event still needs clarification, the next event must be completely absent from this turn — not even as a soft segue.",
    "- Friendly debrief tone; you are NOT playing therapist on intermediate turns. Just find out what happened and how the person lived it.",
    ctx.locale === SOURCE_LOCALE
      ? "- Ask one main question per event. DEFAULT TO CLOSING: read the user's WHOLE reply (all sentences). If it already names or clearly implies a lived tone — emotion, beauty, pleasure, calm, warmth, meaning, reflection, «положительные эмоции», «это красиво» — that is ENOUGH: close now with 1–2 chakras and do NOT ask a menu of states. A clarifying question is the EXCEPTION only for bare confirmations with no lived tone (e.g. just «да», «сделал», «нормально», «был»). Never ask twice for the same event; never invent options that contradict the action (no «общение» for a solitary sunset). Prefer tagging two chakras over asking."
      : "- Ask one main question per event. DEFAULT TO CLOSING: read the user's WHOLE reply (all sentences). If it already names or clearly implies a lived tone — emotion, beauty, pleasure, calm, warmth, meaning, reflection — that is ENOUGH: close now with 1–2 chakras and do NOT ask a menu of states. A clarifying question is the EXCEPTION only for bare confirmations with no lived tone. Never ask twice for the same event; never invent options that contradict the action. Prefer tagging two chakras over asking.",
    ctx.locale === SOURCE_LOCALE
      ? "- CRITICAL — the clarifying question must NOT paraphrase or echo back what the user just said. Two interlocutors do not retell each other's sentences. Do not open with \"Рабочие дела — это когда…\" or \"Вы сказали, что…\". Instead, move the thought forward: briefly note (in one short clause) that a little more detail helps capture the range of inner states for better future recommendations, then ask directly about the states, offering 2-3 concrete options that fit THIS action."
      : "- CRITICAL — the clarifying question must NOT paraphrase or echo back what the user just said. Two interlocutors do not retell each other's sentences. Do not open with phrases like \"So your work was...\" or \"You said that...\". Instead, move the thought forward: briefly note (in one short clause) that a little more detail helps capture the range of inner states for better future recommendations, then ask directly about the states, offering 2-3 concrete options that fit THIS action.",
    ctx.locale === SOURCE_LOCALE
      ? "- Make the clarifying question thematic and right-sized for the action, NOT a fixed checklist. Do NOT use the generic \"это было про тело, настроение, мысли или отношения?\". Example (work): \"Чтобы точнее зафиксировать ваши состояния и потом давать полезные рекомендации — чем были наполнены эти дела: вы держали точность и ясность, согласовывали что-то с людьми, или были моменты внутреннего напряжения и прорыва?\". For rest / a walk / nature — ask how it felt in the body and mood. For a tiny or simple action (лечь пораньше, короткий звонок) keep it very light and do not interrogate; if digging deeper would feel forced, just close the event instead."
      : "- Make the clarifying question thematic and right-sized for the action, NOT a fixed checklist. Do NOT use a generic body/mood/thoughts/relationships menu. Example for work: ask whether it felt focused and precise, more like coordination with people, or more like tension with a breakthrough. For rest / a walk / nature, ask how it felt in the body and mood. For a tiny or simple action like going to bed earlier or making a short call, keep it very light and do not interrogate; if digging deeper would feel forced, just close the event instead.",
    ctx.locale === SOURCE_LOCALE
      ? "- Если после одного уточняющего вопроса ответа всё ещё недостаточно, закройте событие без outcome_cells — оно не попадёт в матрицу, но попытка сбора состояния была сделана."
      : "- If the answer is still too thin after your one clarifying question, close the event with empty outcome_cells — it will not affect the matrix, but the collection attempt still counts.",
    "- DECIDE FOR YOURSELF whether the event happened, from the meaning of the user's reply (in any wording / any language). If the user indicates it did NOT happen / they did not do it (for example did not read, did not get to it, did not manage, it did not work out), then it simply did not take place: do NOT ask ANY clarifying question about states, and do NOT try to read an inner state. Briefly acknowledge it warmly (one short, human line of sympathy/support), and CLOSE the event this turn by emitting [SUMMARIZE_EVENT: ref=\"…\" outcome=\"short factual outcome, e.g. did not happen\" outcome_cells=\"\"] (empty cells). Then move to the next event, or to the final message if this was the last one. Never ask what it touched inside them if the action did not occur. This judgment is YOURS to make — the server does not detect it for you.",
    "- If the user signals the event was unremarkable or that they do not want to elaborate (for example nothing special / as usual / so-so — phrase these ideas in the target language, never paste English fillers into the visible reply), respect that: do NOT push for deeper states. Take the light state they already gave (or none), and close the event this turn — one extra question is the maximum, and here even one is usually too much.",
    "- On intermediate turns do NOT give feedback, advice, interpretations or per-event mini-summaries. Collect facts and the way it was lived; all feedback belongs to the final message.",
    "- Do not repeat the same event description back more than once. Do not re-list already summarized events.",
    "- For outcome_cells, keep the focus on the lived STATE the user actually described. Use the event's obvious real-life domain; do not spend effort re-deciding the sphere from scratch if the event itself already makes the domain clear.",
    "- Use sphere 7 / chakra 7 ONLY when the user explicitly talks about faith, God, spiritual practice, calling, sacred meaning, surrender to life, or a direct search for higher meaning. Generic hope, calm, nature, rest, or 'something bigger' is NOT enough.",
    "- For negotiations, contracts, work results, trying to understand the other side, or reaching agreement, usually prefer sphere 3 with chakra 3, 5, or 6 unless the user clearly describes another center.",
    "- For walks, sleep, body recovery, fresh air, relaxation, pleasant rest, or contact with nature, usually prefer sphere 1 or 2 with chakra 1 or 2 unless the user explicitly centers insight/learning (6) or spirituality/faith (7).",
    "- Never emit [CORRECT_RECOMMENDATION] or any day-level planning focus for today or tomorrow. This branch only debriefs past planned events.",
  ];

  if (input.isOpening || !input.currentEvent) {
    lines.push(
      "",
      "THIS TURN: open the debrief. Greet briefly and ask about the FIRST event below. Do not emit any marker yet.",
      input.continuesToPlanning
        ? (ctx.locale === SOURCE_LOCALE
          ? "- Since the day has no plans yet and planning will follow, make it clear in ONE short sentence that you are first looking back at the previously planned things before planning today — for example «Давайте начнём с того, что подытожим запланированные ранее дела.» Do NOT name any calendar date or use «вчера/сегодня»; just signal that this is a look-back."
          : "- Since the day has no plans yet and planning will follow, make it clear in ONE short sentence that you are first looking back at the previously planned things before planning today (for example \"Let's start by looking back at what was planned earlier.\"). Do NOT name any calendar date.")
        : "",
      input.currentEvent ? `Event to ask about: "${input.currentEvent.description}".` : "There is no concrete event; ask softly how the period went.",
    );
  } else {
    lines.push(
      "",
      "THIS TURN:",
      `1) The user's latest message is their answer about the event: "${input.currentEvent.description}" (ref="${input.currentEvent.ref}").`,
      input.clarifyingAlreadyAsked
        ? "   You already asked your one clarifying question for this event — do NOT ask again; close it now with the information you have."
        : "   DEFAULT: close the event now with outcome_cells — if the answer already conveys any lived state, it is clear enough. Ask ONE clarifying question (instead of closing) ONLY when the answer is genuinely too thin to read any inner state AND the event happened — and then emit NO marker this turn, do not mention the next event, and briefly say the detail is needed for the life-state matrix.",
      "   - Treat simple first-person feelings as ALREADY sufficient lived state. Examples: 'I liked it', 'it felt intense', 'I felt proud / good about myself', 'it was calm', 'it was emotionally engaging'. Do NOT ask the user to compress such an answer into 'one or two words' — just close the event.",
      `2) When you close the event, emit: [SUMMARIZE_EVENT: ref="${input.currentEvent.ref}" outcome="short factual outcome in ${ctx.languageName}" outcome_cells="sphere:chakra:weight;..."]`,
      "   - outcome_cells map how the event was actually lived: sphere is the life sphere 1..7, chakra is the dominant state chakra 1..7, weight 0..1. Use 1-3 cells, but keep the reasoning lightweight: state first, domain second. If the event did not happen, use outcome_cells=\"\" (empty).",
    );
    if (input.isLastEvent) {
      lines.push(
        "3) This was the LAST event. After the marker, write a self-contained FINAL day summary (here you MAY take the psychologist role):",
        `   - Write it as ONE cohesive, warm, psychological reflection (1-2 short paragraphs) on how the period was lived in the energy of chakra ${ctx.targetChakraNumber}: what went well, where the old pattern held, and an insight the user can take about themselves.`,
        chakraExpertLens(ctx.targetChakraNumber, ctx.locale, "summarizing"),
        "   - Weave the events naturally into that reflection. Do NOT produce a labeled per-event recap list (for example an \"Events\" section), and do NOT restate each outcome bullet by bullet — that only repeats what was already said in the dialog.",
        input.completedEarlierEvents.length > 0
          ? `   - For your own context, the events closed in this flow were: ${input.completedEarlierEvents.map((event) => `"${event.description}"`).join(", ")}. Reflect on the whole arc, not item by item.`
          : "",
        "   - Then 1-2 short observations about yoga/health, using ONLY the data provided below; never invent steps, sleep, kilocalories/kcal or workouts.",
        input.practicesContext
          ? "   - Phrase practices naturally and fluently in the target language, not as a dry report. Do not write fragments like \"there were meditations\". Instead, weave them into a human sentence such as the person having completed three short meditations during the day. If the total practice time is clearly low or below the average shown, add ONE warm, encouraging nudge to give a bit more attention to practice — never scold."
          : (ctx.locale === SOURCE_LOCALE
            ? "   - В этот день практик йоги не было. Мягко, без упрёка и в том же тёплом стиле, добавь ОДНУ фразу-приглашение к практике: своими словами объясни, что практики йоги в приложении мощно поддерживают те психологические изменения, к которым человек идёт, и одновременно оздоравливают тело и поддерживают жизненный тонус. Это мотивирующее приглашение, а НЕ отчёт о здоровье — его можно дать, даже если данных Health нет. Не своди это к общей физкультуре, прогулке или зарядке — речь именно о практиках йоги/медитации из приложения. Каждый раз формулируй по-новому."
            : "   - There were no yoga practices on this day. Gently, without reproach and in the same warm style, add ONE inviting line toward practice: explain in your own words that the app's yoga practices powerfully support the psychological changes the person is moving toward, and at the same time restore the body and sustain vitality. This is a motivating invitation, NOT a health report — it may be given even with no Health data. Do not reduce it to generic exercise, a walk or a workout — it is specifically about the app's yoga/meditation practices. Word it freshly each time."),
        "   - If Health context below lists concrete metrics (steps, sleep, active energy kcal, workout minutes), you MUST cite at least ONE exact number taken from that Health context (never invent a figure, never reuse example numbers from instructions) and may add a brief judgment (мало/нормально/много) tied to that figure or its average/comparison. Weave the exact source product name shown next to that metric into the SAME sentence as the figure. Never write an impression-only health line without a number. Active energy figures are always kilocalories (kcal / ккал) — never call them plain calories/калории. If Health context says numbers were not shared / CRITICAL no Apple/Google Health numbers / or Health is unavailable, omit native health/activity talk entirely — no step/sleep/kcal sentences at all, and do not name Apple Health or Health Connect.",
        "   - Keep the wording grounded and direct; no mystical or poetic flourishes.",
        ctx.locale === SOURCE_LOCALE
          ? "   - Не называй календарные даты и не используй слова «вчера/сегодня/завтра»; говори о прожитом периоде как о «дне» / «этом дне» — только по-русски, без английских вставок вроде day или usual."
          : `   - Do NOT name calendar dates or use relative day-words like yesterday/today/tomorrow; refer to the lived period only in ${ctx.languageName}. Never insert English words (day, usual, …) into a non-English reply.`,
        input.practicesContext ? `   Yoga practices context:\n${input.practicesContext}` : "",
        input.healthContext ? `   Health context:\n${input.healthContext}` : "",
        input.continuesToPlanning
          ? "   - Close the reflection warmly and STOP. Do NOT invite planning, do NOT ask what is ahead, do NOT name actions — the app appends the planning hand-off itself."
          : "   - Close warmly; the debrief is complete.",
      );
    } else {
      lines.push(
        `3) There are more events to review. After the marker, your visible reply must be ONLY a SHORT neutral transition + exactly one question about the NEXT event: "${input.nextEvent?.description ?? ""}". The bridge is at most one brief connective clause (for example \"I see.\" / \"All right.\") that does NOT re-describe, evaluate, praise or re-summarize what the user just said about the closed event. No recap, no interpretation, no feedback, no second question. Do not summarize the day yet. Phrase the next question the way a native speaker actually talks (for example \"did you get to read the book?\", not a bureaucratic paraphrase).`,
      );
    }
  }

  return {
    systemInstruction: sharedPreamble(ctx),
    userInstruction: lines.filter(Boolean).join("\n"),
  };
}

/**
 * Optional "background voice" for the PLANNING final and the SUMMARIZING final:
 * the sensibility of a few thinkers associated with the day's target chakra. It
 * gives the closing reflection more depth and day-to-day variety. The experts are
 * NEVER named or quoted in the visible text — only their worldview quietly informs
 * the assistant's own warm voice. The per-planet tonal register (tone/lexicon) is
 * unchanged; this only adds depth of meaning to the closing reflection. In the
 * summarizing branch the chakra is the SUMMARIZED day's chakra, so its thinkers may
 * differ from a planning day — that is intentional and not a conflict.
 */
function chakraExpertLens(chakraNumber: number, locale: AppContentLocale, variant: "planning" | "summarizing" = "planning"): string {
  const experts: Record<number, string> = {
    1: "Andrew Huberman, Hans Selye",
    2: "Epicurus, Esther Perel",
    3: "Stephen Covey, Barbara Sher",
    4: "Carl Rogers, Clarissa Pinkola Estés",
    5: "Rainer Maria Rilke, Julia Cameron",
    6: "Carl Jung, Joseph Campbell, Viktor Frankl",
    7: "Thomas Merton, Ram Dass, Thich Nhat Hanh",
  };
  const names = experts[chakraNumber];
  if (!names) return "";
  if (variant === "summarizing") {
    return locale === SOURCE_LOCALE
      ? `   - Глубинная оптика рефлексии: пусть итоговое осмысление прожитого дня будет написано так, будто его мировосприятие подсказано чувствительностью таких мыслителей, как ${names} — их взглядом на смысл и человеческую глубину. Но напиши всё целиком СВОИМ тёплым голосом от лица приложения; НИКОГДА не называй эти имена, не цитируй их и не упоминай, что опираешься на кого-то.`
      : `   - Depth lens for the reflection: let the closing reflection read as if quietly informed by the sensibility of thinkers like ${names} — their view of meaning and human depth. But write it entirely in YOUR OWN warm voice as the app; NEVER name or quote them or hint that you lean on anyone.`;
  }
  return locale === SOURCE_LOCALE
    ? `- Глубинная оптика финала (ТОЛЬКО для общего абзаца дня, не для списка действий): пусть он будет написан так, будто его мировосприятие подсказано чувствительностью таких мыслителей, как ${names} — их взглядом на смысл и человеческую глубину. Но напиши всё целиком СВОИМ тёплым голосом от лица приложения; НИКОГДА не называй эти имена, не цитируй их и не упоминай, что опираешься на кого-то.`
    : `- Depth lens for the final (ONLY the overall day-focus paragraph, not the action list): let it read as if quietly informed by the sensibility of thinkers like ${names} — their view of meaning and human depth. But write it entirely in YOUR OWN warm voice as the app; NEVER name or quote them or hint that you lean on anyone.`;
}

export function buildPlanningPrompt(ctx: BrainPromptContext, input: PlanningTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: PLANNING — help the user name the few important actions/events of the day.",
    "Rules:",
    `- Planning is for the CURRENT local day from DAY CONTEXT above (${ctx.dateLabel}). Refer to it as today in the target language. Never call it tomorrow unless the user explicitly asks to plan tomorrow.`,
    "- Collect only the actions/events themselves. Do NOT ask for times, do NOT ask in what state they want to live the event, do NOT ask for technical details, and do NOT psychologize. Planning is sphere-only, not state-detection.",
    "- Keep focus on a FEW important things (about 1-3). If the user already named 2-3, do not fish for more — do not pad the plan with extra suggestions.",
    "- When you split the user's plan into separate [PLANNED_EVENT] cards, segment it correctly: two independent actions named in one phrase (for example take a walk and go to bed earlier) are TWO separate events; a goal together with the means of reaching it (buy a boat so I can sail) is ONE event; and two things that form ONE shared occasion — meeting someone in order to do something together (meet a friend and take a boat ride together, meet friends over dinner) — are ONE event. When unsure whether it is one outing or two, lean toward keeping it as one and let the user split it if they correct you.",
    "- Preserve the user's mention order. Do not reorder actions by importance or by time.",
    "- Do not ask about morning / afternoon / evening, and do not ask which state the user wants to feel.",
  ];
  if (ctx.planningSphereLens) {
    lines.push(`- Gentle breadth nudge: ${ctx.planningSphereLens}`);
  }
  if (input.addFlowSphereBalanceLens) {
    lines.push(`- ${input.addFlowSphereBalanceLens}`);
  }
  if (input.noGreeting) {
    lines.push("- This is an ADD flow opened from the Day tab: do NOT greet, do NOT restate or rewrite the day focus, and NEVER emit [CORRECT_RECOMMENDATION] in any form. Just help add the new action(s).");
  }

  lines.push(
    "",
    "WHILE GATHERING (user is still naming things): keep the VISIBLE reply short and conversational. You may invite the user to add more, but GENTLY and at most about TWICE across the whole planning: once you have already asked once or twice whether there is anything else, stop asking again — instead warmly offer to assemble the plan (the user can still add something on their own initiative). Never turn this into an endless checklist that keeps fishing for tiny chores.",
    "- INCREMENTAL SAVE (important): the moment the user names a concrete action, emit an invisible [PLANNED_EVENT] marker for THAT action ON THE SAME TURN, so it is saved immediately even if the dialog is interrupted before the finalize. While gathering use the light form: [PLANNED_EVENT: desc=\"short action name, <=40 chars\" display_order=\"1\" spheres=\"<sphere>:<weight>;...\"] — one marker per newly named action, in mention order, with spheres chosen by the action's real domain (see the LIFE SPHERES guide below; never copy example numbers). Infer SPHERES only here; do not infer any lived state during planning. You MAY omit recommendation while gathering (it is added at the finalize). Do NOT re-emit an action you already marked on an earlier turn, and do NOT emit [CORRECT_RECOMMENDATION] while gathering — the overall day focus belongs only to the finalize turn.",
    "- If you propose an example of something they might add, only suggest actions substantial enough to look back on later — something that takes at least a few minutes and leaves a felt inner trace (e.g. read a book, write a letter, take a walk, a real conversation, reflect on a question). NEVER suggest micro-gestures that are over in seconds (jot down one thought, read a couple of lines, one stretch): such actions are not meaningful to summarize into states.",
    "- CANCELLING an action: if the user clearly asks to remove / cancel / drop an action they planned for today (for example remove the cafe snack, cancel the bike ride), emit an invisible [CANCEL_EVENT: ref=\"<the action as the user named it>\"] marker — one per action to drop — and warmly confirm in the visible reply that you removed it. Use the user's own wording for ref. Only do this for an explicit removal request, never on your own initiative.",
    "",
    "FINALIZE the planning when the user has finished naming actions — judge that BY MEANING of their message, in any supported language and any wording. Do not look for fixed phrases or word order. Also finalize when you already have 2-3 clear actions and they add nothing new. On the finalize turn:",
    input.noGreeting
      ? "- Give a short, warm confirmation of the added action(s) in the energy of the day's target chakra."
      : [
          `- Give a self-contained planning wrap-up: first ONE day-recommendation paragraph, then go action by action with a short, vivid recommendation for living each one today.`,
          `  Name the day's chakra BY NUMBER, but phrase it in natural, living ${ctx.languageName} — as a living recommendation, never as a flat label. ${ctx.locale === SOURCE_LOCALE
            ? `Пиши как живую рекомендацию, например: «Сегодня направьте внимание на ${ctx.targetChakraAccusative}…», «Сегодня наибольшим потенциалом обладает ${ctx.targetChakraLabel}…», «В этот день именно ${ctx.targetChakraLabel} открывает наибольшие возможности для вашего развития…», «Чтобы максимально использовать потенциал этого дня, действуйте в потоке ${ctx.targetChakraGenitive}…» и тому подобное. Меняй фразы на подобные. Чакра может раскрываться, проявляться, выходить на первый план, просить внимания, предлагать возможности и так далее. Описывай, чем это может быть особенно полезно, почему для расширения диапазона психологических состояний важно в этот день действовать не шаблонно, а на волне этой чакры, какие возможности даёт эта чакра для саморазвития. Перечисленные фразы — это лишь иллюстрации духа рекомендации, а НЕ шаблоны: НЕ копируй их дословно, каждый раз сочиняй своё начало, меняя и глагол, и структуру предложения, и не начинай рекомендацию каждый раз со слова «Сегодня».`
            : `Write it as a living recommendation, e.g.: "Today, turn your attention to the ${ctx.targetChakraNumber}th chakra…", "Today the ${ctx.targetChakraNumber}th chakra holds the greatest potential…", "Today it is the ${ctx.targetChakraNumber}th chakra that opens the widest opportunities for your growth…", "To make the most of today, act in the flow of the ${ctx.targetChakraNumber}th chakra…", and the like. Vary the phrasing similarly. The chakra can open up, reveal itself, come to the foreground, ask for attention, offer opportunities, and so on. Describe how this can be especially useful, why — in order to widen the range of psychological states — it matters today to act not on autopilot but on the wave of this chakra, and what opportunities this chakra offers for self-development. The phrases above are illustrations of the spirit only, NOT templates: do NOT copy them verbatim — compose a fresh opening every time, varying both the verb and the sentence structure, and do not begin the recommendation with "Today" every time.`}`,
          `  This is the core of the app: each day opens a UNIQUE, non-repeating chance to live differently and grow. Don't just state a fact — gently stir motivation and a little emotion: why leaning into these states matters TODAY, what the user gains, how it moves them toward becoming more whole, harmonious and healthier. Keep it warm and human, not abstract.`,
          "  Keep this paragraph compact — about 150–230 characters. The visible day-recommendation paragraph and [CORRECT_RECOMMENDATION: short_text=\"...\"] MUST be the SAME text word for word (the Day tab shows it verbatim): write it once, then copy it into short_text. Keep it complete and punctuated.",
          "  Do NOT open the day-recommendation (or short_text) with conversational scaffolding from gathering — never \"Хорошо, собираю план\", \"Договорились\", \"Okay, putting the plan together\", \"D'accord\", or similar ack/assembly lines. Start directly with the living chakra recommendation.",
          chakraExpertLens(ctx.targetChakraNumber, ctx.locale),
        ].filter(Boolean).join("\n"),
    "- In the VISIBLE text, explicitly mention every finalized action and its recommendation. Do not say 'here are your events' without actually listing them.",
    ctx.locale === SOURCE_LOCALE
      ? "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {короткое название дела}\n  Рекомендация: {текст рекомендации}"
      : "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {short action name}\n  Recommendation: {recommendation text}",
    "- The action name in visible text MUST match the desc you put into each PLANNED_EVENT marker (this is what the Day tab shows). Never output \"N. — recommendation\" without the action name.",
    `- Each action recommendation must explicitly reflect chakra ${ctx.targetChakraNumber}: name one concrete supporting state or behavioral emphasis from this day's harmonic tone, not a generic platitude.`,
    "- Right-size each recommendation to the SCOPE of its action. For an all-day or lengthy activity (work, a trip, an evening out) give a background orientation to hold throughout it — not a one-minute pause to perform mid-flow. For a brief, one-off act (a short call, an apology, going to bed earlier) give ONE precise, small shift — never inflate it into a meditation or a ritual.",
    "- Keep every recommendation concretely doable and logically consistent with the action exactly as the user framed it. Do not propose steps that contradict the activity (for example, for reading a book speak to CHOOSING a book that touches meaning, or reading slowly to let it land — never tell them to 'pick a few pages' of a book they have not opened yet).",
    `- Gently invite the user OUT of their habitual pattern toward the day's chakra ${ctx.targetChakraNumber} tone: if they usually act on autopilot (e.g. pushing hard for results), name that kindly and offer today's different emphasis as a small, meaningful experiment — not as an obvious platitude and not as a demand. The point of these recommendations is to widen the user's range of states, so make the shift feel worth doing.`,
    ctx.locale === SOURCE_LOCALE
      ? "- Write action recommendations as polite suggestions in imperative form, not infinitive commands: «выделите», «задайте», «выберите», not «выделить», «задать», «выбрать». Every recommendation and day-focus sentence must end with punctuation."
      : "- Write action recommendations as suggestions, not terse command labels. Every recommendation and day-focus sentence must end with punctuation.",
    "- Keep the wording simple and natural. No poetic openings, no cosmic metaphors, no repeated paraphrases of the user's sentence.",
    "- NEVER put yoga/meditation/breathing/asana/practice requests into [PLANNED_EVENT]. Practices belong only to the PRACTICE branch, not the Day tab actions list.",
    "LIFE SPHERES (what each sphere number 1..7 means — use this to tag spheres, NOT chakras):",
    ctx.lifeSpheresBaseline,
    "- Emit, for EACH action, in the order the user mentioned them:",
    "  [PLANNED_EVENT: desc=\"short action name, <=40 chars, no trailing ellipsis\" recommendation=\"one short vivid recommendation tied to the target chakra\" display_order=\"1\" spheres=\"<sphere>:<weight>;...\"]",
    "  - desc is the short list label for the Day tab (~30-40 chars); put detail into recommendation, never truncate desc with \"…\".",
    "  - display_order is 1,2,3 by mention order (not by time).",
    "  - spheres: pick the 1-2 LIFE SPHERES (1..7) by MEANING against the LIFE SPHERES list above (title + hints) — that list is the ONLY guide. Do NOT invent a parallel numbering scheme and do NOT copy example numbers from anywhere. Match the action's real-life domain to the closest sphere hint; when two spheres fit, use both with weights. Format examples only (choose your own numbers for the real action): tidying the house → \"1:1\"; a bike ride to the lake → \"2:0.7;1:0.3\". Weights are 0..1 and roughly sum to 1. Do NOT output chakra cells for planning. Sphere 4 is ONLY for actions that actually involve other people / relationships — it must NEVER be a default.",
    input.noGreeting
      ? "- Because this is an ADD flow, do NOT emit [CORRECT_RECOMMENDATION] or any day-focus marker; only PLANNED_EVENT markers are allowed."
      : "- Also emit the overall day focus once: [CORRECT_RECOMMENDATION: short_text=\"one short overall recommendation for the day\"]",
    input.softPracticeClose
      ? `- After the wrap-up, close with a short soft paragraph (2–4 sentences): warmly encourage a yoga practice that supports today's chakra ${ctx.targetChakraNumber}; gently note that the practice catalog can be enabled in the Personal Account at the Master level. Do NOT ask any follow-up question (no kind, no duration, no yes/no). End the dialog here.`
      : input.noPractice
        ? "- This flow has NO practice step. End your finalize message here."
        : "- After the wrap-up, end with ONE broad question: whether the user wants a practice now, and if yes which kind (meditation / breathing / asanas) and approximate duration. Do not narrow the user to one specific practice yet.",
    input.planningLocked
      ? "- Planning finalize already happened in this conversation. Do NOT repeat the planning wrap-up, do NOT emit [PLANNED_EVENT] or [CORRECT_RECOMMENDATION], and do NOT re-list day actions."
      : "",
    "",
    input.isOpening
      ? (input.noGreeting
        ? (input.existingActionCount > 0
          ? `THIS TURN: Day-tab Add flow; the day already has ${input.existingActionCount} planned action(s). In 1-2 short warm sentences FIRST explicitly acknowledge that something is already planned for today (you may mention this without naming the exact count), THEN invite what else to ADD today${input.addFlowSphereBalanceLens ? "; optionally nudge one small action from a barely-present life sphere noted above" : ""}. No greeting; do not re-list existing actions or plan from scratch.`
          : "THIS TURN: the user is adding action(s) from the Day tab — help them name the action(s); do not greet.")
        : "THIS TURN: open the planning — warmly ask what is ahead today.")
      : input.userSignaledDone
        ? (input.softPracticeClose
          ? "THIS TURN: the user has finished naming their actions — write the FINAL planning message now (the day recommendation, then each action with its recommendation, then the soft practice closing with NO question). This message MUST include the invisible markers: one [PLANNED_EVENT] per action and one [CORRECT_RECOMMENDATION] for the overall day focus. Emit those markers with square brackets only, never XML tags. The server reads exactly these markers to save the plan into the Day tab — if a marker is missing, that action (or the day focus) is NOT saved and is lost to the user."
          : "THIS TURN: the user has finished naming their actions — write the FINAL planning message now (the day recommendation, then each action with its recommendation, then the practice question). This message MUST include the invisible markers: one [PLANNED_EVENT] per action and one [CORRECT_RECOMMENDATION] for the overall day focus. Emit those markers with square brackets only, never XML tags. The server reads exactly these markers to save the plan into the Day tab — if a marker is missing, that action (or the day focus) is NOT saved and is lost to the user. (In an add-flow there is no day focus: emit only [PLANNED_EVENT].)")
        : input.answeringClosureQuestion
          ? (input.alreadyClarifiedClosure
            ? "THIS TURN: you already asked once whether they want to add another action for today or to assemble the plan. Read this reply BY MEANING in whatever language they used — do not look for fixed phrases. If they named a new concrete action, emit [PLANNED_EVENT] for it. Otherwise they have finished planning: FINALIZE now. Do not ask again, and do not ask what they meant."
            : "THIS TURN: your previous message asked whether to add more or to assemble the plan. Read the user's reply BY MEANING in whatever language they used — do not look for fixed phrases or word order. Three outcomes only: (1) they named a new concrete action for today → emit [PLANNED_EVENT] for it and you may ask once more; (2) they are done / wrapping up / do not want to add more → FINALIZE now; (3) you cannot tell which of those they meant → ask ONE short question in that same frame (another action for today, or assemble the plan?). Do not invent an action. Do not ask a generic 'what do you mean?'. Do not FINALIZE yet if it is genuinely unclear.")
        : input.planningLocked
          ? "THIS TURN: the user is answering the practice-offer question from planning finalize — this is NOT planning. Do not emit planning markers."
          : input.noGreeting
            ? "THIS TURN: continue the Day-tab ADD flow. If they named a new action, stay in gathering mode: briefly acknowledge it, optionally ask whether they want to add one more thing, or warmly offer to assemble what is already there. Do NOT finalize on the very first added action just because it was named. If they have finished adding — judge that BY MEANING, not by matching phrases — FINALIZE."
            : "THIS TURN: continue from the conversation above. Gather or finalize by MEANING of the user's message in any language (do not look for fixed phrases).",
  );

  return {
    systemInstruction: sharedPreamble(ctx),
    userInstruction: lines.filter(Boolean).join("\n"),
  };
}

export function buildPracticePrompt(ctx: BrainPromptContext, input: PracticeTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: PRACTICE — help the user pick ONE short supportive practice, or accept a refusal. This message is ONLY about the practice; do NOT re-summarize the day or repeat per-event recommendations.",
    "Practice catalog by duration: meditation 1-5 min, breathing 5-20 min, asanas (body movement) 20-70 min.",
    `The practice should support chakra ${ctx.targetChakraNumber} (${ctx.targetChakraLabel}).`,
    "Rules:",
    "- Treat this as a practice-only branch. Do not retell the day, do not repeat per-event planning recommendations, and do not emit [PLANNED_EVENT].",
    "- Ask for the type and duration only if they are not yet clear. If the user already gave enough information, pick immediately. For breathing/meditation the duration and chakra stay user-editable on the card.",
    "- If the user only says yes to practice without naming kind/duration, ask one short question that lets them choose kind and/or duration. Do not ask two separate questions.",
    "- When the user has named a type (and ideally a duration), pick a matching practice and emit exactly:",
    "  [PRACTICE_PICK: id=\"\" reason=\"short reason\" duration_min=\"10\" chakra=\"" + ctx.targetChakraNumber + "\" card_blurb=\"warm 1-2 sentence card text\"]",
    "  - Use the kind the user asked for (meditation / breathing / asanas). Never substitute a different kind on your own.",
    "  - If the user says generic 'yoga' plus a duration, treat it as an umbrella request: 1-5 min -> meditation, 5-20 min -> breathing, 20+ min -> asanas.",
    "  - If the user explicitly asks for a kind with a duration that does NOT exist in the catalog, do NOT silently substitute. Ask ONE short reconciliation question offering the nearest valid option for that kind and the same-duration option for the matching kind.",
    "  - Set duration_min within the catalog range for that kind; chakra is the day's target chakra unless the user clearly chose another.",
    "  - Leave id=\"\" so the server selects the concrete practice from the catalog.",
    "  - Visible text on the pick turn: ONLY card_blurb (1-2 sentences why this practice fits today). NEVER write step-by-step instructions (no \"sit comfortably\", \"close your eyes\", breathing counts, etc.). The app shows the practice card separately.",
    "- If the user does not want a practice now, judge that BY MEANING of their reply in any supported language and any wording. Do not look for fixed phrases. Then do NOT emit [PRACTICE_PICK]: write a short, kind closing line and emit the invisible sentinel [PRACTICE_DECLINED]. If they want a practice but kind or duration is unclear, ask ONE short question for kind and/or duration. If the reply is not clearly a pick and not clearly a refusal, ask ONE short question in that same frame (name kind and duration, or skip today). Never re-ask whether they want a practice after they have declined. After that one clarifier, a still-unclear reply is a refusal: close with [PRACTICE_DECLINED].",
    input.postPracticeReply
      ? "- A practice card was already shown. Reply in 1-2 short sentences only: acknowledge the user, gently point them to the practice card, wish a good day/evening. Do NOT reopen planning, do NOT emit [PRACTICE_PICK], do NOT ask new questions."
      : "",
    input.catalogReconciliation ? input.catalogReconciliation : "",
    "",
    input.postPracticeReply
      ? "THIS TURN: post-practice wind-down only — short closing reply, no new practice pick."
      : input.pickImmediately
        ? "THIS TURN: the user already named a clear practice type and duration — pick immediately with [PRACTICE_PICK]; visible text = card_blurb only."
        : input.catalogReconciliation
          ? "THIS TURN: resolve the catalog mismatch with the one reconciliation question above."
        : input.isOpening
          ? "THIS TURN: the planning branch just offered an optional practice. Read the user's reply BY MEANING in whatever language they used — do not look for fixed phrases. Three outcomes only: (1) they want a practice → pick, or ask kind/duration if missing; (2) they do not want a practice now → close with [PRACTICE_DECLINED]; (3) you cannot tell → ask ONE short question in that same frame (name kind and approximate duration, or skip today). Do not ask a generic 'what do you mean?'."
          : "THIS TURN: you already asked once in this practice branch. Read the reply BY MEANING. If they named a practice, pick. If they refuse, or the reply is still not a clear pick, close with [PRACTICE_DECLINED] — do not ask again.",
  ];

  return {
    systemInstruction: sharedPreamble(ctx),
    userInstruction: lines.filter(Boolean).join("\n"),
  };
}

/** Strip the FSM's private sentinels that the generic marker sanitizer does not know about. */
export function stripBrainSentinels(text: string): string {
  return text
    .replace(/\[\s*(?:BRANCH_DONE|PRACTICE_DECLINED)\s*\]/gi, "")
    .replace(/<\/?\s*(?:BRANCH_DONE|PRACTICE_DECLINED)\b[^>]*>/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function containsPracticeDeclined(text: string): boolean {
  return /\[\s*PRACTICE_DECLINED\s*\]/i.test(text) || /<\s*PRACTICE_DECLINED\b/i.test(text);
}
