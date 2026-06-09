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
  timeOfDay: string;
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
  isLastEvent: boolean;
  clarifyingAlreadyAsked: boolean;
  healthContext: string;
  practicesContext: string;
  /** When true, after the final summary the dialogue continues into PLANNING. */
  continuesToPlanning: boolean;
};

export type PlanningTurnInput = {
  isOpening: boolean;
  noPractice: boolean;
  noGreeting: boolean;
};

export type PracticeTurnInput = {
  isOpening: boolean;
};

function sharedPreamble(ctx: BrainPromptContext): string {
  return [
    "You are the HARMONIZER daily companion: a warm, grounded friend with a background in yoga and psychology.",
    `Always write your visible reply in ${ctx.languageName}. Keep a friendly, human, conversational tone — like a thoughtful friend, not a clinician. Be concise: outside of explicit "final" messages, keep replies to a few short sentences.`,
    ctx.locale === "ru"
      ? `Обращайся к пользователю на «${ctx.addressForm}».`
      : "Address the user naturally.",
    "",
    "DAY CONTEXT (data, do not read aloud verbatim):",
    `- Date: ${ctx.dayOfWeek}, ${ctx.dateLabel}; time of day: ${ctx.timeOfDay}; day phase: ${ctx.phaseTime}.`,
    `- Day target chakra: number ${ctx.targetChakraNumber} (${ctx.targetChakraLabel}). Why: ${ctx.targetChakraExplain}`,
    `- Planet of the day: ${ctx.planetOfDay}. Tonal register to color your wording: ${ctx.tonalRegister}`,
    `- Harmonic states of this chakra (use as the "wave" to live in): ${ctx.harmonicStates.slice(0, 12).join(", ")}.`,
    `- Dissonant states to gently avoid: ${ctx.dissonantStates.slice(0, 10).join(", ")}.`,
    "",
    "CHAKRA NAMING RULE: never use Sanskrit chakra names. Refer to chakras only by ordinal number / the provided label.",
    "LIFE SPHERES (for sphere tagging, 1..7):",
    ctx.lifeSpheresBaseline,
    "",
    "MARKERS: emit invisible markers exactly as specified. They are parsed by the server and stripped from the visible text. Never use double quotes inside a marker value.",
  ].join("\n");
}

export function buildSummarizingPrompt(ctx: BrainPromptContext, input: SummarizingTurnInput): {
  systemInstruction: string;
  userInstruction: string;
} {
  const lines: string[] = [
    "CURRENT BRANCH: SUMMARIZING — review how past planned events actually went, one event at a time.",
    "Rules:",
    "- Work strictly on ONE event at a time. Do not list or pre-empt other events.",
    "- Friendly debrief tone; you are NOT playing therapist on intermediate turns. Just find out what happened and how the person lived it.",
    "- Ask one main question per event. If the event happened but the description is too thin to read the psychological state, ask exactly ONE clarifying question and briefly say why (it helps fill the state matrix). Never ask a clarifying question twice for the same event.",
    "- If the user clearly says the event did not happen, close it WITHOUT outcome_cells and without inventing any state.",
    "- On intermediate turns do NOT give feedback, advice, interpretations or per-event mini-summaries. Collect facts and the way it was lived; all feedback belongs to the final message.",
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
        : "   If their answer is clear enough, close the event now. Only if it is genuinely too thin AND the event happened, you may ask ONE clarifying question instead of closing it this turn.",
      `2) When you close the event, emit: [SUMMARIZE_EVENT: ref="${input.currentEvent.ref}" outcome="short factual outcome in ${ctx.languageName}" outcome_cells="sphere:chakra:weight;..."]`,
      "   - outcome_cells map how the event was actually lived: sphere is the life sphere 1..7, chakra is the dominant state chakra 1..7, weight 0..1. Use 1-3 cells. If the event did not happen, use outcome_cells=\"\" (empty).",
    );
    if (input.isLastEvent) {
      lines.push(
        "3) This was the LAST event. After the marker, write a self-contained FINAL day summary (here you MAY take the psychologist role):",
        `   - First, warm psychological feedback on how well the user lived the day in the energy of chakra ${ctx.targetChakraNumber}, what went well and where the old pattern held.`,
        "   - Then briefly but separately acknowledge EACH event you summarized today.",
        "   - Then 1-2 short observations about yoga/health, using ONLY the data provided below; never invent steps, sleep, calories or workouts.",
        input.practicesContext ? `   Yoga practices context:\n${input.practicesContext}` : "",
        input.healthContext ? `   Health context:\n${input.healthContext}` : "",
        input.continuesToPlanning
          ? "   - End with one short, warm sentence inviting the user to plan today (ask what is ahead). Do NOT plan or list actions yourself yet."
          : "   - Close warmly; the debrief is complete.",
      );
    } else {
      lines.push(
        `3) There are more events to review. After the marker, transition with one short sentence and ask about the NEXT event: "${input.nextEvent?.description ?? ""}". Do not summarize the day yet.`,
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
    "- Collect only the actions/events themselves. Do NOT ask for times, do NOT ask in what state they want to live the event, do NOT ask for technical details, do NOT psychologize.",
    "- Keep focus on 1-3 important things. If the user already named 2-3, do not fish for more.",
    "- Two independent actions in one phrase (\"take a walk and go to bed earlier\") = two events. A goal + its means (\"buy a boat to sail\") = one event.",
  ];
  if (ctx.planningSphereLens) {
    lines.push(`- Gentle breadth nudge: ${ctx.planningSphereLens}`);
  }
  if (input.noGreeting) {
    lines.push("- This is an ADD flow opened from the Day tab: do NOT greet, do NOT restate the day focus. Just help add the new action(s).");
  }

  lines.push(
    "",
    "WHILE GATHERING (user is still naming things): reply briefly and conversationally, optionally ask if there is anything else important today. Do NOT emit any PLANNED_EVENT or CORRECT_RECOMMENDATION marker yet.",
    "",
    "FINALIZE the planning ONLY when the user signals they are done (or you already have 2-3 clear actions and they add nothing new). On the finalize turn:",
    input.noGreeting
      ? "- Give a short, warm confirmation of the added action(s) in the energy of the day's target chakra."
      : `- Give a self-contained planning wrap-up: first name the overall focus of the day through chakra ${ctx.targetChakraNumber} in one or two sentences, then go action by action with a short, vivid recommendation for living each one today in that energy.`,
    "- Emit, for EACH action, in the order the user mentioned them:",
    "  [PLANNED_EVENT: desc=\"short action name, <=40 chars, no trailing ellipsis\" recommendation=\"one short vivid recommendation tied to the target chakra\" display_order=\"1\" spheres=\"1:0.6;4:0.4\"]",
    "  - desc is the short list label for the Day tab (~30-40 chars); put detail into recommendation, never truncate desc with \"…\".",
    "  - display_order is 1,2,3 by mention order (not by time).",
    "  - spheres tags the life spheres 1..7 (\"4\" or \"1:0.6;4:0.4\"). Do NOT output chakra cells for planning.",
    input.noGreeting
      ? ""
      : "- Also emit the overall day focus once: [CORRECT_RECOMMENDATION: short_text=\"one short overall recommendation for the day\"]",
    input.noPractice
      ? "- This flow has NO practice step. End your finalize message here."
      : "- After the wrap-up, end with ONE short question offering an optional short practice (which kind / how long, or skip). Do not describe specific practices yet.",
    "",
    input.isOpening
      ? (input.noGreeting
        ? "THIS TURN: the user is adding action(s) from the Day tab — help them name the action(s); do not greet."
        : "THIS TURN: open the planning — warmly ask what is ahead today.")
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
    "- Ask for the type and duration if not yet clear. For breathing/meditation the duration and chakra stay user-editable on the card.",
    "- When the user has named a type (and ideally a duration), pick a matching practice and emit exactly:",
    "  [PRACTICE_PICK: id=\"\" reason=\"short reason\" duration_min=\"10\" chakra=\"" + ctx.targetChakraNumber + "\" card_blurb=\"warm 1-2 sentence card text\"]",
    "  - Use the kind the user asked for (meditation / breathing / asanas). Never substitute a different kind.",
    "  - Set duration_min within the catalog range for that kind; chakra is the day's target chakra unless the user clearly chose another.",
    "  - Leave id=\"\" so the server selects the concrete practice from the catalog.",
    "- If the user declines or wants to skip, do NOT emit [PRACTICE_PICK]. Instead write a short, kind closing line and emit the invisible sentinel [PRACTICE_DECLINED].",
    "",
    input.isOpening
      ? "THIS TURN: offer a short optional practice and ask which kind / how long, or whether to skip."
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
