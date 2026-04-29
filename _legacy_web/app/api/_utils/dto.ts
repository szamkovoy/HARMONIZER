const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

type Planet = (typeof PLANETS_7)[number];
type Tone = "harmonic" | "neutral" | "dissonant";

const PLANET_TO_CHAKRA: Record<Planet, number> = {
  Moon: 1,
  Venus: 2,
  Mars: 3,
  Jupiter: 4,
  Saturn: 5,
  Mercury: 6,
  Sun: 7,
};

const PLANET_SHORT_LABELS: Record<Planet, string> = {
  Moon: "safety",
  Venus: "connection",
  Mars: "will",
  Jupiter: "heart",
  Saturn: "voice",
  Mercury: "clarity",
  Sun: "vitality",
};

export const TOKEN_BUDGETS = {
  profileCompact: 350,
  forecastCompact: 200,
  calibrationCompact: 300,
  historyCompact: 1500,
  statesMapCompact: 250,
} as const;

export interface ProfileCompactDTO {
  name: string;
  birthDate: string;
  precisionMode: "precise" | "approximate" | "unknown";
  chakras: Record<
    number,
    {
      planet: Planet;
      shortLabel: string;
      strength: number;
      harmony: number;
      flag?: "weak" | "strong" | "harmonic" | "dissonant";
    }
  >;
  isCalibrated: boolean;
}

export interface ForecastCompactDTO {
  date: string;
  planet: Planet | string;
  chakra: number;
  shortLabel: string;
  tone: Tone;
  H: number;
  S: number;
  isAlternativeChoice: boolean;
  windows: {
    sunrise?: string;
    culmination?: string;
    exactAspect?: string;
  };
}

export interface CalibrationCompactDTO {
  version: number;
  statesSummary: Record<string, { positive: string[]; negative: string[] }>;
  topPhrases: Array<{ text: string; planet: string }>;
}

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

type NatalLike = {
  precisionMode?: "precise" | "approximate" | "unknown";
  precision_mode?: "precise" | "approximate" | "unknown";
  planets?: Record<string, { S_initial?: number; H_initial?: number }>;
};

type CalibrationLike = {
  version?: number;
  s_calibrated?: Record<string, number>;
  h_calibrated?: Record<string, number>;
  states_map?: Record<
    string,
    {
      positive_states?: Array<{ label?: string; source?: string }>;
      negative_states?: Array<{ label?: string; source?: string }>;
      rejected_states?: Array<{ label?: string }>;
    }
  >;
  user_lexicon?: {
    phrases?: Array<{ text?: string; associated_planet?: string; planet?: string; frequency?: number }>;
  };
};

type ForecastLike = {
  forecast_date?: string;
  date?: string;
  planet_of_the_day?: string;
  planetOfTheDay?: string;
  today_planet_state?: { todayTone?: Tone; naturalHarmoniousness?: number };
  todayPlanetState?: { todayTone?: Tone; naturalHarmoniousness?: number };
  importance?: Record<string, number>;
  is_alternative_choice?: boolean;
  isAlternativeChoice?: boolean;
  windows_of_opportunity?: Record<string, { time?: string } | undefined>;
  windowsOfOpportunity?: Record<string, { time?: string } | undefined>;
};

type UserLike = {
  full_name?: string | null;
  display_name?: string | null;
  birth_date?: string | null;
};

function isPlanet(value: string): value is Planet {
  return (PLANETS_7 as readonly string[]).includes(value);
}

export function buildProfileCompact(natal: NatalLike | null | undefined, calibration: CalibrationLike | null, user: UserLike = {}): ProfileCompactDTO {
  const chakras: ProfileCompactDTO["chakras"] = {};

  for (const planet of PLANETS_7) {
    const natalPlanet = natal?.planets?.[planet];
    const strength = calibration?.s_calibrated?.[planet] ?? natalPlanet?.S_initial ?? 0.5;
    const harmony = calibration?.h_calibrated?.[planet] ?? natalPlanet?.H_initial ?? 0;
    let flag: ProfileCompactDTO["chakras"][number]["flag"];

    if (strength < 0.3) flag = "weak";
    else if (strength > 0.75) flag = "strong";
    if (harmony < -0.4) flag = flag ?? "dissonant";
    else if (harmony > 0.4 && !flag) flag = "harmonic";

    chakras[PLANET_TO_CHAKRA[planet]] = {
      planet,
      shortLabel: PLANET_SHORT_LABELS[planet],
      strength: round(strength, 2),
      harmony: round(harmony, 2),
      ...(flag ? { flag } : {}),
    };
  }

  return {
    name: user.display_name ?? user.full_name ?? "User",
    birthDate: user.birth_date?.slice(0, 10) ?? "",
    precisionMode: natal?.precisionMode ?? natal?.precision_mode ?? "unknown",
    chakras,
    isCalibrated: Boolean(calibration),
  };
}

export function buildForecastCompact(forecast: ForecastLike | null | undefined): ForecastCompactDTO | null {
  if (!forecast) return null;

  const planet = String(forecast.planet_of_the_day ?? forecast.planetOfTheDay ?? "Sun");
  const normalizedPlanet = isPlanet(planet) ? planet : "Sun";
  const planetState = forecast.today_planet_state ?? forecast.todayPlanetState ?? {};
  const windows = forecast.windows_of_opportunity ?? forecast.windowsOfOpportunity ?? {};

  return {
    date: forecast.forecast_date ?? forecast.date ?? "",
    planet,
    chakra: PLANET_TO_CHAKRA[normalizedPlanet],
    shortLabel: PLANET_SHORT_LABELS[normalizedPlanet],
    tone: planetState.todayTone ?? "neutral",
    H: round(planetState.naturalHarmoniousness ?? 0, 2),
    S: round(forecast.importance?.[planet] ?? 0, 2),
    isAlternativeChoice: Boolean(forecast.is_alternative_choice ?? forecast.isAlternativeChoice),
    windows: {
      sunrise: extractHHMM(windows.sunrise?.time),
      culmination: extractHHMM(windows.culmination?.time),
      exactAspect: extractHHMM(windows.exactAspect?.time),
    },
  };
}

export function buildCalibrationCompact(calibration: CalibrationLike | null | undefined): CalibrationCompactDTO | null {
  if (!calibration) return null;

  const statesSummary: CalibrationCompactDTO["statesSummary"] = {};
  for (const planet of PLANETS_7) {
    const states = calibration.states_map?.[planet];
    statesSummary[planet] = {
      positive: (states?.positive_states ?? []).map((state) => state.label).filter(isNonEmptyString).slice(0, 3),
      negative: (states?.negative_states ?? []).map((state) => state.label).filter(isNonEmptyString).slice(0, 3),
    };
  }

  const topPhrases = [...(calibration.user_lexicon?.phrases ?? [])]
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 10)
    .map((phrase) => ({
      text: phrase.text ?? "",
      planet: phrase.associated_planet ?? phrase.planet ?? "",
    }))
    .filter((phrase) => phrase.text);

  return {
    version: Number(calibration.version ?? 0),
    statesSummary,
    topPhrases,
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

export function buildStatesMapCompact(statesMap: CalibrationLike["states_map"] | null | undefined): StatesMapCompactDTO {
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

function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(Number(value ?? 0) * multiplier) / multiplier;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function extractHHMM(isoTime?: string): string | undefined {
  if (!isoTime) return undefined;
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(11, 16);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
