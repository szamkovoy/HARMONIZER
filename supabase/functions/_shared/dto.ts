const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

export interface HistoryCompactDTO {
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    phase?: string;
  }>;
  totalMessages: number;
  truncated: boolean;
}

export interface StatesMapCompactDTO {
  [planet: string]: {
    confirmedPositive: string[];
    confirmedNegative: string[];
    userAdded: string[];
    rejected: string[];
  };
}

export function buildHistoryCompact(
  messages: Array<{ role: string; content?: string | null; transcript?: string | null; meta?: any }>,
  budgetChars = 5250,
): HistoryCompactDTO {
  const compactMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: truncate(String(message.content ?? message.transcript ?? ""), 300),
      ...(message.role === "assistant" && message.meta?.responder?.phase_used ? { phase: String(message.meta.responder.phase_used) } : {}),
    }));

  const result: typeof compactMessages = [];
  let totalChars = 0;
  for (let i = compactMessages.length - 1; i >= 0; i -= 1) {
    const messageChars = compactMessages[i].text.length + 50;
    if (totalChars + messageChars > budgetChars) break;
    result.unshift(compactMessages[i]);
    totalChars += messageChars;
  }

  return {
    messages: result,
    totalMessages: messages.length,
    truncated: result.length < compactMessages.length,
  };
}

export function buildStatesMapCompact(
  statesMap:
    | Record<
        string,
        {
          positive_states?: Array<{ label?: string; source?: string }>;
          negative_states?: Array<{ label?: string; source?: string }>;
          rejected_states?: Array<{ label?: string }>;
        }
      >
    | null
    | undefined,
): StatesMapCompactDTO {
  const result: StatesMapCompactDTO = {};
  for (const planet of PLANETS_7) {
    const states = statesMap?.[planet];
    const positive = states?.positive_states ?? [];
    const negative = states?.negative_states ?? [];

    result[planet] = {
      confirmedPositive: positive.filter((state) => state.source === "user_confirmed").map((state) => state.label).filter(isNonEmptyString),
      confirmedNegative: negative.filter((state) => state.source === "user_confirmed").map((state) => state.label).filter(isNonEmptyString),
      userAdded: [...positive, ...negative].filter((state) => state.source === "user_added").map((state) => state.label).filter(isNonEmptyString),
      rejected: (states?.rejected_states ?? []).map((state) => state.label).filter(isNonEmptyString),
    };
  }
  return result;
}

export function logDTOSize(dtoName: string, dto: unknown, budgetTokens: number) {
  const json = JSON.stringify(dto ?? null);
  const chars = json.length;
  const tokens = Math.ceil(chars / 3.5);

  if (tokens > budgetTokens) {
    console.warn(`[DTO] ${dtoName} exceeds budget: ${tokens} > ${budgetTokens} tokens`);
  }

  return { chars, tokens };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
