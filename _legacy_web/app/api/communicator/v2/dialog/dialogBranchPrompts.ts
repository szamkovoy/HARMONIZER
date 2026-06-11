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
      const recommendation = (event.recommendation ?? "").trim();
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
    ? "Хотите, чтобы я предложил короткую практику, которая поможет настроиться на это состояние? Или сегодня без неё?"
    : "Would you like me to suggest a short practice to help you tune into this state, or skip it today?";
}

function extractPracticeQuestion(visibleText: string, locale: "ru" | "en"): string {
  const paragraphs = visibleText
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const practiceParagraph = [...paragraphs].reverse().find((part) =>
    /(?:практик|медитаци|дыхан|асан|йог|practice|meditation|breath|asana|yoga)/i.test(part)
    && /\?/.test(part)
  );
  return practiceParagraph ?? fallbackPracticeQuestion(locale);
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
  const focus = dayFocus?.trim();
  if (focus) parts.push(focus);
  parts.push(buildPlanningActionsVisibleBlock(events, locale));
  if (includePracticeQuestion) {
    parts.push(extractPracticeQuestion(visibleText, locale));
  }
  return parts.filter((part) => part.trim()).join("\n\n");
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
    "- Work strictly on ONE event at a time. Do not list or pre-empt other events.",
    "- Until you emit [SUMMARIZE_EVENT] for the current event, your visible reply must discuss ONLY that event. Never ask about or mention another event in the same turn.",
    "- If you need a clarifying question, ask exactly ONE question about the current event only — no marker, no interpretation, no feedback, no other events.",
    "- Friendly debrief tone; you are NOT playing therapist on intermediate turns. Just find out what happened and how the person lived it.",
    "- Ask one main question per event. If the event happened but the description is too thin to read the psychological state, ask exactly ONE clarifying question. In that clarifying question, briefly explain that this detail is needed to fill the user's life-state matrix for analysis. Never ask a clarifying question twice for the same event.",
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
        `   - First, warm psychological feedback on how well the user lived the day in the energy of chakra ${ctx.targetChakraNumber}, what went well and where the old pattern held.`,
        input.completedEarlierEvents.length > 0
          ? `   - Earlier in this same summary flow you already closed these events: ${input.completedEarlierEvents.map((event) => `"${event.description}"`).join(", ")}.`
          : "",
        "   - Then briefly but separately acknowledge EACH event you summarized in this flow, including the current one.",
        "   - Then 1-2 short observations about yoga/health, using ONLY the data provided below; never invent steps, sleep, calories or workouts.",
        "   - If practices are listed below, mention the actual practice(s) explicitly by title and/or duration instead of a generic sentence about yoga.",
        "   - If health numbers are listed below, cite the concrete facts that matter (for example steps, workout minutes, sleep minutes). If no concrete health/practice data is provided, do not fake a generic wellness paragraph.",
        "   - Keep the wording grounded and direct; no mystical or poetic flourishes.",
        input.practicesContext ? `   Yoga practices context:\n${input.practicesContext}` : "",
        input.healthContext ? `   Health context:\n${input.healthContext}` : "",
        input.continuesToPlanning
          ? "   - End with one short, warm sentence inviting the user to plan today (for example, ask what is ahead today). Do NOT plan or list actions yourself yet."
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
          "  The visible day-recommendation paragraph and [CORRECT_RECOMMENDATION: short_text=\"...\"] MUST use EXACTLY the same wording (character-for-character).",
        ].join("\n"),
    "- In the VISIBLE text, explicitly mention every finalized action and its recommendation. Do not say 'here are your events' without actually listing them.",
    ctx.locale === "ru"
      ? "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {короткое название дела}\n  Рекомендация: {текст рекомендации}"
      : "- VISIBLE list format (one block per action, blank line between blocks):\n  N. {short action name}\n  Recommendation: {recommendation text}",
    "- The action name in visible text MUST match the desc you put into each PLANNED_EVENT marker (this is what the Day tab shows). Never output \"N. — recommendation\" without the action name.",
    `- Each action recommendation must explicitly reflect chakra ${ctx.targetChakraNumber}: name one concrete supporting state or behavioral emphasis from this day's harmonic tone, not a generic platitude.`,
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
      : "- After the wrap-up, end with ONE short question offering an optional short practice (which kind / how long, or skip). Do not describe specific practices yet.",
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
