export type DialogueUseCase = "calibration" | "daily_dialog";
export type UserSignal =
  | "open"
  | "closed"
  | "self_reflective"
  | "deflecting"
  | "ready_for_action"
  | "needs_processing"
  | "disengaged"
  | "confused"
  | "verbose"
  | "terse";

export type OrchestratorDecision = {
  next_phase: string;
  reasoning: string;
  information_completeness: Record<string, number>;
  information_density: number;
  user_signals: UserSignal[];
  should_close: boolean;
  close_reason?: "goal_reached" | "soft_cap_hit" | "user_disengaged" | null;
  responder_hints?: {
    tone?: "warm" | "neutral" | "energising" | "calming";
    use_user_phrases?: string[];
    avoid_topics?: string[];
  };
  decision_source?: "fresh" | "bypass_greeting" | "cache_reused";
  cache_similarity?: number;
  bypass_reason?: string;
};

export type TimeOfDayContext = {
  localHour: number;
  timeOfDay: "morning" | "day" | "evening" | "night";
  greeting: string;
  tone: "warm" | "neutral" | "energising" | "calming";
  energy: "rising" | "peak" | "falling" | "low";
  preferredPracticeKinds: string[];
};

export function timeOfDayContext(date = new Date(), timezone = "UTC"): TimeOfDayContext {
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(date),
  );

  if (localHour >= 5 && localHour < 11) {
    return {
      localHour,
      timeOfDay: "morning",
      greeting: "Доброе утро",
      tone: "energising",
      energy: "rising",
      preferredPracticeKinds: ["asanas", "pranayama"],
    };
  }
  if (localHour >= 11 && localHour < 17) {
    return {
      localHour,
      timeOfDay: "day",
      greeting: "Добрый день",
      tone: "neutral",
      energy: "peak",
      preferredPracticeKinds: ["pranayama", "meditation"],
    };
  }
  if (localHour >= 17 && localHour < 22) {
    return {
      localHour,
      timeOfDay: "evening",
      greeting: "Добрый вечер",
      tone: "warm",
      energy: "falling",
      preferredPracticeKinds: ["meditation", "pranayama"],
    };
  }
  return {
    localHour,
    timeOfDay: "night",
    greeting: "Доброй ночи",
    tone: "calming",
    energy: "low",
    preferredPracticeKinds: ["meditation"],
  };
}

export function greetingBypassDecision(useCase: DialogueUseCase, timezone: string, bypassReason = "no_history"): OrchestratorDecision {
  const tod = timeOfDayContext(new Date(), timezone);
  return {
    next_phase: useCase === "calibration" ? "welcome_and_hint" : "contextual_greeting",
    reasoning: "Bypass: первый ход диалога, фаза детерминирована.",
    information_completeness: {},
    information_density: 0,
    user_signals: [],
    should_close: false,
    responder_hints: {
      tone: tod.tone,
      use_user_phrases: [],
      avoid_topics: [],
    },
    decision_source: "bypass_greeting",
    bypass_reason: bypassReason,
  };
}

export function estimateDensity(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < 1) return 0;
  if (wordCount < 5) return 0.1;
  if (wordCount < 15) return 0.4;
  if (wordCount < 50) return 0.7;
  return 0.9;
}

export function quickSignalDetection(text: string): UserSignal[] {
  const signals = new Set<UserSignal>();
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 80) signals.add("verbose");
  else if (wordCount < 10) signals.add("terse");
  if (/(не знаю|не уверен|не уверена|не понимаю)/i.test(text)) signals.add("deflecting");
  if (/(чувствую|думаю|замечаю|вижу|понимаю)/i.test(text)) signals.add("self_reflective");
  if (/(давай|хочу|готов|готова|пора|сделаем|попробуем)/i.test(text)) signals.add("ready_for_action");
  return [...signals];
}

export function validateOrchestratorDecision(value: unknown, fallbackPhase: string): OrchestratorDecision {
  const raw = typeof value === "object" && value !== null ? (value as Partial<OrchestratorDecision>) : {};
  return {
    next_phase: typeof raw.next_phase === "string" ? raw.next_phase : fallbackPhase,
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "Fallback: invalid orchestrator output.",
    information_completeness:
      typeof raw.information_completeness === "object" && raw.information_completeness !== null
        ? (raw.information_completeness as Record<string, number>)
        : {},
    information_density: typeof raw.information_density === "number" ? raw.information_density : 0,
    user_signals: Array.isArray(raw.user_signals) ? (raw.user_signals as UserSignal[]) : [],
    should_close: Boolean(raw.should_close),
    close_reason: raw.close_reason ?? null,
    responder_hints: raw.responder_hints ?? { tone: "neutral", use_user_phrases: [], avoid_topics: [] },
  };
}
