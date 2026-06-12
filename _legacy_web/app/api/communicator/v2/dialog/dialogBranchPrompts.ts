import { DateTime } from "luxon";

import type { DialogTimeOfDay } from "@legacy/app/api/_utils/dialogTimeOfDay";
import { dayPartRhetoricInstruction, greetingInstructionForTimeOfDay } from "@legacy/app/api/_utils/dialogTimeOfDay";
import type { PlannedEventMarker } from "@legacy/app/api/_utils/markers";

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
  locale: "ru" | "en";
  languageName: string;
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

export function formatLocalDateForPrompt(localDate: string, locale: "ru" | "en"): string {
  const parsed = DateTime.fromISO(localDate, { zone: "utc" });
  if (!parsed.isValid) return localDate;
  return parsed.setLocale(locale === "en" ? "en" : "ru").toFormat("d MMMM yyyy");
}

/** Deterministic visible list for planning finalize — matches Day tab action titles. */
export function ensureSentencePunctuation(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (/[:;]$/.test(text)) return text;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
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

export function polishPlanningRecommendation(value: string | null | undefined, locale: "ru" | "en"): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const polished = locale === "ru" ? polishRuRecommendationText(raw) : raw;
  return ensureSentencePunctuation(polished);
}

export function polishPlanningMarker(event: PlannedEventMarker, locale: "ru" | "en"): PlannedEventMarker {
  return {
    ...event,
    recommendation: polishPlanningRecommendation(event.recommendation, locale) || event.recommendation,
  };
}

export function buildPlanningActionsVisibleBlock(
  events: PlannedEventMarker[],
  locale: "ru" | "en",
): string {
  const recommendationLabel = locale === "ru" ? "Рекомендация" : "Recommendation";
  return [...events]
    .sort((left, right) => (left.displayOrder ?? Number.MAX_SAFE_INTEGER) - (right.displayOrder ?? Number.MAX_SAFE_INTEGER))
    .map((event, index) => {
      const order = event.displayOrder ?? index + 1;
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
  locale: "ru" | "en",
): string {
  if (!events.length) return visibleText;
  const block = buildPlanningActionsVisibleBlock(events, locale);
  const numberedListStart = visibleText.search(/\n\s*\d+\.\s/m);
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
  const focus = dayFocus.trim();
  if (!focus) return visibleText;
  const listStart = visibleText.search(/\n\s*\d+\.\s/m);
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

function fallbackPracticeQuestion(locale: "ru" | "en"): string {
  return locale === "ru"
    ? "Хотите сейчас выполнить практику: медитацию, дыхание или асаны? Если да, назовите тип и примерную длительность — или скажите, что сегодня без практики."
    : "Would you like to do a practice now: meditation, breathing, or asanas? If yes, name the kind and approximate duration, or say you will skip it today.";
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

function extractPlanningIntro(visibleText: string, fallbackFocus: string | null | undefined, eventCount: number): string {
  const listStart = visibleText.search(/\n\s*\d+\.\s/m);
  const beforeList = (listStart >= 0 ? visibleText.slice(0, listStart) : visibleText)
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) =>
      part
      && !/[?？]/.test(part)
      && !introHasWrongActionCount(part, eventCount)
      && !/(?:ещ[её]\s+что|что-то\s+ещ[её]|anything else|nothing else|add something|something else)/i.test(part)
      && !/\[(?:PLANNED_EVENT|CORRECT_RECOMMENDATION|PRACTICE_PICK)\b/i.test(part)
      && !/(?:практик|медитаци|дыхан|асан|йог|practice|meditation|breath|asana|yoga)/i.test(part)
    )
    .join("\n\n");
  if (beforeList.length >= 80) return ensureSentencePunctuation(beforeList);
  return ensureSentencePunctuation(fallbackFocus);
}

function actionCountWord(count: number, locale: "ru" | "en"): string {
  if (locale === "en") return `${count}`;
  if (count === 1) return "одно";
  if (count === 2) return "два";
  if (count === 3) return "три";
  return `${count}`;
}

/** Deterministic planning final assembled from persisted marker data. */
export function buildPlanningFinalVisibleText(params: {
  visibleText: string;
  events: PlannedEventMarker[];
  dayFocus: string | null | undefined;
  locale: "ru" | "en";
  includePracticeQuestion: boolean;
}): string {
  const { visibleText, events, dayFocus, locale, includePracticeQuestion } = params;
  const parts: string[] = [];
  const focus = extractPlanningIntro(visibleText, dayFocus, events.length);
  if (focus) parts.push(focus);
  parts.push(buildPlanningActionsVisibleBlock(events, locale));
  if (includePracticeQuestion) {
    parts.push(fallbackPracticeQuestion(locale));
  }
  return parts.filter((part) => part.trim()).join("\n\n");
}

/** Deterministic add-flow final: never trusts the model's count or proposed-but-rejected items. */
export function buildPlanningAddFinalVisibleText(params: {
  events: PlannedEventMarker[];
  locale: "ru" | "en";
}): string {
  const { events, locale } = params;
  const count = events.length;
  const intro = locale === "ru"
    ? `Хорошо, добавил ${actionCountWord(count, locale)} ${count === 1 ? "дело" : "дела"} в план на сегодня:`
    : `Done — I added ${count} ${count === 1 ? "item" : "items"} to today's plan:`;
  return [intro, buildPlanningActionsVisibleBlock(events, locale)].join("\n\n");
}

/**
 * Deterministic, warm closing when the user declines to plan the day. Ends the
 * dialogue gracefully (no practice branch follows) and gently explains why
 * planning matters, without naming any calendar date.
 */
export function buildPlanningDeclinedReply(locale: "ru" | "en"): string {
  if (locale === "en") {
    return [
      "Got it — I won't push. You can plan later, whenever a free minute appears.",
      "It's not a formality: when you note what matters to live through, the app learns which states you tend to be in and, over time, helps you gently widen that range — so you stay more flexible and whole. For now, just let the day unfold and notice what larger purpose you're acting for.",
      "Come back whenever you're ready to outline the main things.",
    ].join("\n\n");
  }
  return [
    "Хорошо, не настаиваю — планирование можно сделать позже, когда появится свободная минута.",
    "Это не формальность: когда вы отмечаете, что важно прожить, приложение лучше понимает, в каких состояниях вы бываете, и со временем помогает мягко расширять их диапазон — чтобы вы оставались более гибким и цельным. А пока просто позвольте дню идти своим чередом и замечайте, ради чего большего вы действуете.",
    "Возвращайтесь, когда будете готовы наметить главное.",
  ].join("\n\n");
}

export type PlanningTurnInput = {
  isOpening: boolean;
  noPractice: boolean;
  noGreeting: boolean;
  /** User signaled they are done naming actions — this turn must emit markers. */
  userSignaledDone: boolean;
  /** Planning finalize already happened; do not re-emit PLANNED_EVENT or repeat the wrap-up. */
  planningLocked: boolean;
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

const PRACTICE_KIND_LABELS_RU: Record<"breath" | "meditation" | "yoga", string> = {
  breath: "дыхание",
  meditation: "медитацию",
  yoga: "асаны",
};

/**
 * Deterministic, user-facing fallback for the practice branch so a turn never
 * ends up with empty visible text (which used to crash the client with
 * "Assistant reply was empty after hydration"). When the user named a type +
 * duration that the catalog cannot satisfy (e.g. 30-min breathing), it offers a
 * concrete reconciliation; otherwise it asks the generic practice question.
 */
export function buildPracticeClarificationFallback(params: {
  locale: "ru" | "en";
  kind: "breath" | "meditation" | "yoga" | null;
  requestedDurationMin: number | null;
  range: { min: number; max: number } | null;
  altKind: "breath" | "meditation" | "yoga" | null;
}): string {
  const { locale, kind, requestedDurationMin, range, altKind } = params;
  if (kind && range && requestedDurationMin != null && altKind && altKind !== kind) {
    if (locale === "en") {
      const kindEn = kind === "breath" ? "breathing" : kind === "meditation" ? "meditation" : "asanas";
      const altEn = altKind === "breath" ? "breathing" : altKind === "meditation" ? "meditation" : "asanas";
      return `Here ${kindEn} runs ${range.min}–${range.max} min. Would you like ${kindEn} for ${range.max} min, or ${altEn} for about ${requestedDurationMin} min?`;
    }
    const kindRu = PRACTICE_KIND_LABELS_RU[kind];
    const altRu = PRACTICE_KIND_LABELS_RU[altKind];
    return `Здесь ${kindRu} идёт ${range.min}–${range.max} минут. Хотите ${kindRu} на ${range.max} минут или ${altRu} примерно на ${requestedDurationMin} минут?`;
  }
  return fallbackPracticeQuestion(locale);
}

function greetingInstruction(ctx: BrainPromptContext): string {
  return greetingInstructionForTimeOfDay(ctx.timeOfDay, ctx.locale, ctx.addressForm, ctx.localHour);
}

function tonalRegisterInstruction(ctx: BrainPromptContext): string {
  if (!ctx.tonalRegister.trim()) return "";
  return ctx.locale === "ru"
    ? `Тональный окрас дня (планета ${ctx.planetOfDay}): ${ctx.tonalRegister} Это обязательная фоновая настройка для всех веток (summarizing, planning, practice). Не называйте её явно, но держите в интонации, ритме и выборе слов.`
    : `Tonal register for today (planet ${ctx.planetOfDay}): ${ctx.tonalRegister} This colors all branches (summarizing, planning, practice). Do not name it explicitly, but keep it in tone, rhythm, and word choice.`;
}

function sharedPreamble(ctx: BrainPromptContext): string {
  return [
    "You are the HARMONIZER daily companion: a warm, grounded friend with a background in yoga and psychology.",
    `Always write your visible reply in ${ctx.languageName}. Keep a friendly, human, conversational tone — like a thoughtful friend, not a clinician. Be concise: outside of explicit "final" messages, keep replies to a few short sentences.`,
    ctx.locale === "ru"
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
    ctx.locale === "ru"
      ? "Пиши целиком по-русски. Не вставляй спонтанные английские слова (например quietly, mindfully, flow, gently) — всегда подбирай русский эквивалент. Иностранный термин допустим, только если сам пользователь назвал его так (например профессиональный термин)."
      : "",
    "",
    "DAY CONTEXT (data, do not read aloud verbatim):",
    `- Date: ${ctx.dayOfWeek}, ${ctx.dateLabel}; time of day: ${ctx.timeOfDay}; day phase: ${ctx.phaseTime}.`,
    `- Day target chakra: number ${ctx.targetChakraNumber} (${ctx.targetChakraLabel}). Why: ${ctx.targetChakraExplain}`,
    `- Planet of the day: ${ctx.planetOfDay}.`,
    `- Harmonic states of this chakra (use as the "wave" to live in): ${ctx.harmonicStates.slice(0, 12).join(", ")}.`,
    `- Dissonant states to gently avoid: ${ctx.dissonantStates.slice(0, 10).join(", ")}.`,
    "",
    "CHAKRA NAMING RULE: never use Sanskrit chakra names. Refer to chakras only by ordinal number / the provided label.",
    "LIFE SPHERES (for sphere tagging, 1..7):",
    ctx.lifeSpheresBaseline,
    "",
    "MARKERS: emit invisible markers exactly as specified. They are parsed by the server and stripped from the visible text. Never use double quotes inside a marker value.",
  ].filter(Boolean).join("\n");
}

export function buildSummarizingPrompt(ctx: BrainPromptContext, input: SummarizingTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: SUMMARIZING — review how past planned events actually went, one event at a time.",
    "Rules:",
    ctx.locale === "ru"
      ? "- Не называйте календарные даты в видимом тексте. Говорите только названиями событий (например «прогулка в парке», «выбор саженцев»). Никогда не используйте «вчера», «сегодня», «завтра» и подобные слова."
      : "- Do NOT name calendar dates in visible text. Refer to events by their titles only (for example walk in the park, apple saplings). Never use yesterday, today, tomorrow, or similar words.",
    ctx.locale === "ru"
      ? "- Не ставьте названия событий в кавычки в видимом тексте. Вплетайте событие разговорно: «когда вы работали с задачами», «во время визита в автосервис», либо говорите «это действие», если заголовок трудно склонить."
      : "- Do not put event titles in quotation marks in visible text. Weave the event naturally into the sentence, or say \"this event\" if the title is hard to inflect.",
    "- Work strictly on ONE event at a time. Do not list or pre-empt other events.",
    "- Until you emit [SUMMARIZE_EVENT] for the current event, your visible reply must discuss ONLY that event. Never ask about or mention another event in the same turn.",
    "- If you need a clarifying question, ask exactly ONE question about the current event only — no marker, no interpretation, no feedback, no other events.",
    "- Friendly debrief tone; you are NOT playing therapist on intermediate turns. Just find out what happened and how the person lived it.",
    "- Ask one main question per event. If the event happened but the description is too thin to read the inner state, ask exactly ONE clarifying question that flows naturally from what the user just said — pick up their own words and gently invite a bit more. Never ask a clarifying question twice for the same event.",
    "- Make the clarifying question thematic and right-sized for the action, NOT a fixed checklist. Do NOT keep asking the same generic \"это было про тело, настроение, мысли или отношения?\". Examples: for work — \"чем был наполнен этот процесс: вы были увлечены делом, больше держали фокус и точность, согласовывали что-то с людьми — или были трения и прорывы?\"; for rest / a walk / nature — ask how it ощущалось телесно и эмоционально; for a tiny or simple action (лечь пораньше, короткий звонок) keep it very light and do not interrogate. If it would feel forced to dig deeper, just close the event instead.",
    ctx.locale === "ru"
      ? "- Если после одного уточняющего вопроса ответа всё ещё недостаточно, закройте событие без outcome_cells — оно не попадёт в матрицу, но попытка сбора состояния была сделана."
      : "- If the answer is still too thin after your one clarifying question, close the event with empty outcome_cells — it will not affect the matrix, but the collection attempt still counts.",
    "- If the user clearly says the event did not happen, close it WITHOUT outcome_cells and without inventing any state.",
    "- On intermediate turns do NOT give feedback, advice, interpretations or per-event mini-summaries. Collect facts and the way it was lived; all feedback belongs to the final message.",
    "- Do not repeat the same event description back more than once. Do not re-list already summarized events.",
    "- For outcome_cells, prefer the LITERAL domain of the event and the lived state the user actually described, not a distant symbolic interpretation.",
    "- Use sphere 7 / chakra 7 ONLY when the user explicitly talks about faith, God, spiritual practice, calling, sacred meaning, surrender to life, or a direct search for higher meaning. Generic hope, calm, nature, rest, or 'something bigger' is NOT enough.",
    "- For negotiations, contracts, work results, trying to understand the other side, or reaching agreement, usually prefer sphere 3 with chakra 3, 5, or 6 unless the user clearly describes another center.",
    "- For walks, sleep, body recovery, fresh air, relaxation, pleasant rest, or contact with nature, usually prefer sphere 1 or 2 with chakra 1 or 2 unless the user explicitly centers insight/learning (6) or spirituality/faith (7).",
    "- Never emit [CORRECT_RECOMMENDATION] or any day-level planning focus for today or tomorrow. This branch only debriefs past planned events.",
  ];

  if (input.isOpening || !input.currentEvent) {
    lines.push(
      "",
      "THIS TURN: open the debrief. Greet briefly and ask about the FIRST event below. Do not emit any marker yet.",
      input.currentEvent ? `Event to ask about: "${input.currentEvent.description}".` : "There is no concrete event; ask softly how the period went.",
    );
  } else {
    lines.push(
      "",
      "THIS TURN:",
      `1) The user's latest message is their answer about the event: "${input.currentEvent.description}" (ref="${input.currentEvent.ref}").`,
      input.clarifyingAlreadyAsked
        ? "   You already asked your one clarifying question for this event — do NOT ask again; close it now with the information you have."
        : "   If their answer is clear enough, close the event now with outcome_cells. Only if it is genuinely too thin AND the event happened, you may ask ONE clarifying question instead of closing it this turn — and in that question briefly say the detail is needed for the life-state matrix.",
      `2) When you close the event, emit: [SUMMARIZE_EVENT: ref="${input.currentEvent.ref}" outcome="short factual outcome in ${ctx.languageName}" outcome_cells="sphere:chakra:weight;..."]`,
      "   - outcome_cells map how the event was actually lived: sphere is the life sphere 1..7, chakra is the dominant state chakra 1..7, weight 0..1. Use 1-3 cells. If the event did not happen, use outcome_cells=\"\" (empty).",
    );
    if (input.isLastEvent) {
      lines.push(
        "3) This was the LAST event. After the marker, write a self-contained FINAL day summary (here you MAY take the psychologist role):",
        `   - Write it as ONE cohesive, warm, psychological reflection (1-2 short paragraphs) on how the period was lived in the energy of chakra ${ctx.targetChakraNumber}: what went well, where the old pattern held, and an insight the user can take about themselves.`,
        "   - Weave the events naturally into that reflection. Do NOT produce a labeled per-event recap list (never write a \"По событиям\"/\"By events\" section), do NOT restate each outcome bullet by bullet — that just repeats what was already said in the dialog.",
        input.completedEarlierEvents.length > 0
          ? `   - For your own context, the events closed in this flow were: ${input.completedEarlierEvents.map((event) => `"${event.description}"`).join(", ")}. Reflect on the whole arc, not item by item.`
          : "",
        "   - Then 1-2 short observations about yoga/health, using ONLY the data provided below; never invent steps, sleep, calories or workouts.",
        "   - Phrase practices in natural, flowing Russian, not a dry report. Instead of \"медитации были — три практики, в сумме 5 минут\", write something like \"в течение дня вы выполнили три коротких медитации\". If the total practice time is clearly low or below the average shown, add ONE warm, encouraging nudge to give a bit more attention to practice — never scold.",
        "   - If health numbers are listed below, you MUST cite at least ONE concrete number inline (for example exact steps, sleep duration, or workout minutes) so the reflection reads as real analytics, not a guess. Do not replace the number with vague words like \"немного\" alone — pair the impression with the figure (for example \"шагов набралось немного — всего 1240\"). Mention only one or two metrics, keep it light. If no concrete health/practice data is provided, do not fake a generic wellness paragraph and do not mention health at all.",
        "   - Keep the wording grounded and direct; no mystical or poetic flourishes.",
        "   - Do NOT name calendar dates or use day words (no «вчера»/«сегодня»/«вчерашний»/«yesterday»/«today»); refer to the period only as «этот день» / «прожитый день» / «the day».",
        input.practicesContext ? `   Yoga practices context:\n${input.practicesContext}` : "",
        input.healthContext ? `   Health context:\n${input.healthContext}` : "",
        input.continuesToPlanning
          ? "   - Close the reflection warmly and STOP. Do NOT invite planning, do NOT ask what is ahead, do NOT name actions — the app appends the planning hand-off itself."
          : "   - Close warmly; the debrief is complete.",
      );
    } else {
      lines.push(
        `3) There are more events to review. After the marker, your visible reply must be ONLY: at most one short neutral bridge sentence + exactly one question about the NEXT event: "${input.nextEvent?.description ?? ""}". No recap of the closed event, no interpretation, no feedback, no second question. Do not summarize the day yet.`,
      );
    }
  }

  return {
    systemInstruction: sharedPreamble(ctx),
    userInstruction: lines.filter(Boolean).join("\n"),
  };
}

/**
 * Optional "background voice" for the PLANNING final only: the sensibility of a
 * few thinkers associated with the day's target chakra. It gives the day-focus
 * reflection more depth and day-to-day variety. The experts are NEVER named or
 * quoted in the visible text — only their worldview quietly informs the
 * assistant's own warm voice. The per-planet tonal register (tone/lexicon) is
 * unchanged; this only adds depth of meaning to the closing reflection.
 */
function chakraExpertLens(chakraNumber: number, locale: "ru" | "en"): string {
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
  return locale === "ru"
    ? `- Глубинная оптика финала (ТОЛЬКО для общего абзаца дня, не для списка действий): пусть он звучит так, будто его мировосприятие подсказано чувствительностью таких мыслителей, как ${names} — их взглядом на смысл и человеческую глубину. Но напиши всё целиком СВОИМ тёплым голосом от лица приложения; НИКОГДА не называй эти имена, не цитируй их и не упоминай, что опираешься на кого-то.`
    : `- Depth lens for the final (ONLY the overall day-focus paragraph, not the action list): let it read as if quietly informed by the sensibility of thinkers like ${names} — their view of meaning and human depth. But write it entirely in YOUR OWN warm voice as the app; NEVER name or quote them or hint that you lean on anyone.`;
}

export function buildPlanningPrompt(ctx: BrainPromptContext, input: PlanningTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: PLANNING — help the user name the few important actions/events of the day.",
    "Rules:",
    `- Planning is for the CURRENT local day from DAY CONTEXT above (${ctx.dateLabel}). Call it "today"/"сегодня". Never call it tomorrow unless the user explicitly asks to plan tomorrow.`,
    "- Collect only the actions/events themselves. Do NOT ask for times, do NOT ask in what state they want to live the event, do NOT ask for technical details, do NOT psychologize.",
    "- Keep focus on 1-3 important things. If the user already named 2-3, do not fish for more.",
    "- Two independent actions in one phrase (\"take a walk and go to bed earlier\") = two events. A goal + its means (\"buy a boat to sail\") = one event.",
    "- Preserve the user's mention order. Do not reorder actions by importance or by time.",
    "- Do not ask about morning / afternoon / evening, and do not ask which state the user wants to feel.",
  ];
  if (ctx.planningSphereLens) {
    lines.push(`- Gentle breadth nudge: ${ctx.planningSphereLens}`);
  }
  if (input.noGreeting) {
    lines.push("- This is an ADD flow opened from the Day tab: do NOT greet, do NOT restate or rewrite the day focus, and NEVER emit [CORRECT_RECOMMENDATION] in any form. Just help add the new action(s).");
  }

  lines.push(
    "",
    "WHILE GATHERING (user is still naming things): reply briefly and conversationally, optionally ask if there is anything else important today. Do NOT emit any PLANNED_EVENT or CORRECT_RECOMMENDATION marker yet.",
    "",
    "FINALIZE the planning ONLY when the user signals they are done (or you already have 2-3 clear actions and they add nothing new). On the finalize turn:",
    input.noGreeting
      ? "- Give a short, warm confirmation of the added action(s) in the energy of the day's target chakra."
      : [
          `- Give a self-contained planning wrap-up: first one short paragraph with the overall day recommendation, then go action by action with a short, vivid recommendation for living each one today.`,
          `  The day recommendation is NOT a forecast — it invites the user to direct attention toward states and actions aligned with chakra ${ctx.targetChakraNumber} today, so they live less on autopilot and more in harmony with natural energies. Gently motivate: what to notice, why this shift helps growth/wholeness, what they may gain if they lean into it.`,
          "  The visible day-recommendation paragraph may be fuller than [CORRECT_RECOMMENDATION: short_text=\"...\"], but both must carry the same meaning. The marker short_text is for the Day tab header: keep it concise, complete and punctuated.",
          chakraExpertLens(ctx.targetChakraNumber, ctx.locale),
        ].filter(Boolean).join("\n"),
    "- In the VISIBLE text, explicitly mention every finalized action and its recommendation. Do not say 'here are your events' without actually listing them.",
    ctx.locale === "ru"
      ? "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {короткое название дела}\n  Рекомендация: {текст рекомендации}"
      : "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {short action name}\n  Recommendation: {recommendation text}",
    "- The action name in visible text MUST match the desc you put into each PLANNED_EVENT marker (this is what the Day tab shows). Never output \"N. — recommendation\" without the action name.",
    `- Each action recommendation must explicitly reflect chakra ${ctx.targetChakraNumber}: name one concrete supporting state or behavioral emphasis from this day's harmonic tone, not a generic platitude.`,
    "- Right-size each recommendation to the SCOPE of its action. For an all-day or lengthy activity (work, a trip, an evening out) give a background orientation to hold throughout it — not a one-minute pause to perform mid-flow. For a brief, one-off act (a short call, an apology, going to bed earlier) give ONE precise, small shift — never inflate it into a meditation or a ritual.",
    "- Keep every recommendation concretely doable and logically consistent with the action exactly as the user framed it. Do not propose steps that contradict the activity (for example, for reading a book speak to CHOOSING a book that touches meaning, or reading slowly to let it land — never tell them to 'pick a few pages' of a book they have not opened yet).",
    `- Gently invite the user OUT of their habitual pattern toward the day's chakra ${ctx.targetChakraNumber} tone: if they usually act on autopilot (e.g. pushing hard for results), name that kindly and offer today's different emphasis as a small, meaningful experiment — not as an obvious platitude and not as a demand. The point of these recommendations is to widen the user's range of states, so make the shift feel worth doing.`,
    ctx.locale === "ru"
      ? "- Write action recommendations as polite suggestions in imperative form, not infinitive commands: «выделите», «задайте», «выберите», not «выделить», «задать», «выбрать». Every recommendation and day-focus sentence must end with punctuation."
      : "- Write action recommendations as suggestions, not terse command labels. Every recommendation and day-focus sentence must end with punctuation.",
    "- Keep the wording simple and natural. No poetic openings, no cosmic metaphors, no repeated paraphrases of the user's sentence.",
    "- NEVER put yoga/meditation/breathing/asana/practice requests into [PLANNED_EVENT]. Practices belong only to the PRACTICE branch, not the Day tab actions list.",
    "- Emit, for EACH action, in the order the user mentioned them:",
    "  [PLANNED_EVENT: desc=\"short action name, <=40 chars, no trailing ellipsis\" recommendation=\"one short vivid recommendation tied to the target chakra\" display_order=\"1\" spheres=\"1:0.6;4:0.4\"]",
    "  - desc is the short list label for the Day tab (~30-40 chars); put detail into recommendation, never truncate desc with \"…\".",
    "  - display_order is 1,2,3 by mention order (not by time).",
    "  - spheres tags the life spheres 1..7 (\"4\" or \"1:0.6;4:0.4\"). Do NOT output chakra cells for planning.",
    input.noGreeting
      ? "- Because this is an ADD flow, do NOT emit [CORRECT_RECOMMENDATION] or any day-focus marker; only PLANNED_EVENT markers are allowed."
      : "- Also emit the overall day focus once: [CORRECT_RECOMMENDATION: short_text=\"one short overall recommendation for the day\"]",
    input.noPractice
      ? "- This flow has NO practice step. End your finalize message here."
      : "- After the wrap-up, end with ONE broad question: whether the user wants a practice now, and if yes which kind (meditation / breathing / asanas) and approximate duration. Do not narrow the user to one specific practice yet.",
    input.planningLocked
      ? "- Planning finalize already happened in this conversation. Do NOT repeat the planning wrap-up, do NOT emit [PLANNED_EVENT] or [CORRECT_RECOMMENDATION], and do NOT re-list day actions."
      : "",
    "",
    input.isOpening
      ? (input.noGreeting
        ? "THIS TURN: the user is adding action(s) from the Day tab — help them name the action(s); do not greet."
        : "THIS TURN: open the planning — warmly ask what is ahead today.")
      : input.userSignaledDone
        ? "THIS TURN: the user signaled they are done naming actions — FINALIZE NOW. You MUST emit [PLANNED_EVENT] for every action and [CORRECT_RECOMMENDATION] (unless add-flow). Without these markers the server cannot save the plan."
        : input.planningLocked
          ? "THIS TURN: the user is answering the practice-offer question from planning finalize — this is NOT planning. Do not emit planning markers."
          : "THIS TURN: continue from the conversation above; gather or finalize as the rules describe.",
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
    "  - Use the kind the user asked for (meditation / breathing / asanas). Never substitute a different kind.",
    "  - Set duration_min within the catalog range for that kind; chakra is the day's target chakra unless the user clearly chose another.",
    "  - Leave id=\"\" so the server selects the concrete practice from the catalog.",
    "  - Visible text on the pick turn: ONLY card_blurb (1-2 sentences why this practice fits today). NEVER write step-by-step instructions (no \"sit comfortably\", \"close your eyes\", breathing counts, etc.). The app shows the practice card separately.",
    "- If the user declines or wants to skip, do NOT emit [PRACTICE_PICK]. Instead write a short, kind closing line and emit the invisible sentinel [PRACTICE_DECLINED].",
    input.postPracticeReply
      ? "- A practice card was already shown. Reply in 1-2 short sentences only: acknowledge the user, gently point them to the practice card, wish a good day/evening. Do NOT reopen planning, do NOT emit [PRACTICE_PICK], do NOT ask new questions."
      : "",
    input.catalogReconciliation ? input.catalogReconciliation : "",
    "",
    input.postPracticeReply
      ? "THIS TURN: post-practice wind-down only — short closing reply, no new practice pick."
      : input.pickImmediately
        ? "THIS TURN: the user already named a clear practice type and duration — pick immediately with [PRACTICE_PICK]; visible text = card_blurb only."
        : input.isOpening
          ? "THIS TURN: the planning branch just offered an optional practice — continue from the user's answer; pick, clarify kind/duration, or accept refusal."
          : "THIS TURN: continue from the conversation above; pick the practice or accept the refusal per the rules.",
  ];

  return {
    systemInstruction: sharedPreamble(ctx),
    userInstruction: lines.filter(Boolean).join("\n"),
  };
}

/** Strip the FSM's private sentinels that the generic marker sanitizer does not know about. */
export function stripBrainSentinels(text: string): string {
  return text.replace(/\[\s*(?:BRANCH_DONE|PRACTICE_DECLINED)\s*\]/gi, "").replace(/[ \t]+\n/g, "\n").trim();
}

export function containsPracticeDeclined(text: string): boolean {
  return /\[\s*PRACTICE_DECLINED\s*\]/i.test(text);
}
