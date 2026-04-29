import { getOrchestratorLocaleConfig } from "./locale-configs";

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

export const TERMINAL_PHASES = new Set(["acknowledge_and_close", "confirm_and_close", "suggest_practice"]);

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

export function quickSignalDetection(text: string, locale?: string | null): UserSignal[] {
  const signals = new Set<UserSignal>();
  const config = getOrchestratorLocaleConfig(locale);
  const normalized = text.trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 80) signals.add("verbose");
  else if (wordCount < 10) signals.add("terse");
  for (const marker of config.signalMarkers) {
    if (marker.patterns.some((rx) => rx.test(normalized))) {
      signals.add(marker.signal);
    }
  }
  if (/[?!]/.test(normalized) && wordCount >= 3) signals.add("open");
  return [...signals];
}

function hasTransitionMarker(text: string, locale?: string | null): boolean {
  const normalized = text.trim();
  return getOrchestratorLocaleConfig(locale).transitionMarkers.some((rx) => rx.test(normalized));
}

export function contextSimilarity(
  currentMessage: string,
  previousMessage: string | null | undefined,
  previousDecision: OrchestratorDecision,
  locale?: string | null,
): number {
  const current = currentMessage.trim();
  const previous = previousMessage?.trim() ?? "";
  if (!current || !previous) return 0;

  let score = 0;
  const lenRatio = Math.min(current.length, previous.length) / Math.max(current.length, previous.length);
  if (lenRatio > 0.5) score += 0.3;

  const currentDensity = estimateDensity(current);
  if (Math.abs(currentDensity - previousDecision.information_density) < 0.2) score += 0.3;

  if (!hasTransitionMarker(current, locale)) score += 0.2;

  const currentSignals = quickSignalDetection(current, locale);
  const previousSignals = previousDecision.user_signals ?? [];
  const overlap = currentSignals.filter((signal) => previousSignals.includes(signal)).length;
  score += 0.2 * (overlap / Math.max(currentSignals.length, 1));

  return Math.min(score, 1);
}

export function shouldForceFreshDecision(decisions: OrchestratorDecision[]): boolean {
  const lastTwo = decisions.slice(-2);
  return lastTwo.length === 2 && lastTwo.every((decision) => decision.decision_source === "cache_reused");
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
    decision_source: raw.decision_source,
    cache_similarity: raw.cache_similarity,
    bypass_reason: raw.bypass_reason,
  };
}
