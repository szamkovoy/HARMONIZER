import type { NatalProfile, Planet } from "../../../modules/astro-core";

export const PLANETS_7: Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

export type CalibrationSource = "initial" | "manual_resync" | "auto_aggregated";

export const AVERAGING_WEIGHTS: Record<CalibrationSource, { wNatal: number; wProposed: number }> = {
  initial: { wNatal: 0.6, wProposed: 0.4 },
  manual_resync: { wNatal: 0.6, wProposed: 0.4 },
  auto_aggregated: { wNatal: 0.5, wProposed: 0.5 },
};

export type BaselineState = {
  chakra_number: number;
  harmonicStates: string[];
  dissonantStates: string[];
};

export type BaselineStates = Record<Planet, BaselineState>;

export type CalibrationExtraction = {
  deltas?: Partial<Record<Planet, { dS?: number; dH?: number; confirmed?: boolean; reasoning?: string }>>;
  vocabulary?: Partial<
    Record<
      Planet,
      {
        confirmedStates?: string[];
        rejectedStates?: string[];
        addedStates?: Array<string | { label?: string; polarity?: "positive" | "negative" }>;
        personalPhrases?: string[];
      }
    >
  >;
};

export type CalibrationRow = {
  version: number;
  source: CalibrationSource;
  s_calibrated: Record<Planet, number>;
  h_calibrated: Record<Planet, number>;
  delta_from_initial: Record<Planet, { dS: number; dH: number }>;
  states_map: StatesMap;
  user_lexicon: UserLexicon;
  portrait: string | null;
  portrait_chunks: Record<string, string> | null;
};

export type StateItem = {
  id: string;
  label: string;
  source: "baseline" | "user_confirmed" | "user_added" | "ai_proposed";
  weight: number;
};

export type RejectedStateItem = {
  id: string;
  label: string;
  source: "baseline" | "user_confirmed" | "user_added" | "ai_proposed";
};

export type StatesMap = Record<
  Planet,
  {
    chakra_number: number;
    positive_states: StateItem[];
    negative_states: StateItem[];
    rejected_states: RejectedStateItem[];
    is_confirmed: boolean;
  }
>;

export type UserLexicon = {
  phrases: Array<{
    id: string;
    text: string;
    triggers_states: string[];
    associated_planet: Planet;
    first_seen_at: string;
    frequency: number;
    source: string;
  }>;
  style_markers: {
    speaks_in_metaphors: boolean;
    uses_diminutives: boolean;
    formal_register: boolean;
    preferred_pronouns: "you_informal" | "you_formal";
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizePhrase(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableState(label: string, source: StateItem["source"], weight = 1): StateItem {
  return { id: slugify(label), label, source, weight };
}

function addedStateLabel(value: string | { label?: string }): string | null {
  return typeof value === "string" ? value : value.label ?? null;
}

function addedStatePolarity(value: string | { polarity?: "positive" | "negative" }): "positive" | "negative" {
  return typeof value === "string" ? "negative" : value.polarity ?? "negative";
}

export function averageCalibration(natalProfile: NatalProfile, extraction: CalibrationExtraction, source: CalibrationSource) {
  const { wNatal, wProposed } = AVERAGING_WEIGHTS[source];
  const S_calibrated = {} as Record<Planet, number>;
  const H_calibrated = {} as Record<Planet, number>;
  const deltaFromInitial = {} as Record<Planet, { dS: number; dH: number }>;
  const debug = {} as Record<
    Planet,
    { S_before: number; S_proposed: number; S_after: number; H_before: number; H_proposed: number; H_after: number }
  >;

  for (const planet of PLANETS_7) {
    const natal = natalProfile.planets[planet];
    const delta = extraction.deltas?.[planet] ?? {};
    const dS = clamp(Number(delta.dS ?? 0), -0.3, 0.3);
    const dH = clamp(Number(delta.dH ?? 0), -0.3, 0.3);
    const sInitial = natal.S_initial;
    const hInitial = natal.H_initial;
    const sProposed = clamp(sInitial + dS, 0, 1);
    const hProposed = clamp(hInitial + dH, -1, 1);
    const sCal = clamp(wNatal * sInitial + wProposed * sProposed, 0, 1);
    const hCal = clamp(wNatal * hInitial + wProposed * hProposed, -1, 1);

    S_calibrated[planet] = round4(sCal);
    H_calibrated[planet] = round4(hCal);
    deltaFromInitial[planet] = { dS: round4(sCal - sInitial), dH: round4(hCal - hInitial) };
    debug[planet] = {
      S_before: round4(sInitial),
      S_proposed: round4(sProposed),
      S_after: round4(sCal),
      H_before: round4(hInitial),
      H_proposed: round4(hProposed),
      H_after: round4(hCal),
    };
  }

  return { S_calibrated, H_calibrated, deltaFromInitial, debug };
}

export function buildStatesMap(
  extraction: CalibrationExtraction,
  baseline: BaselineStates,
  previous?: { states_map?: StatesMap } | null,
): StatesMap {
  const result = {} as StatesMap;

  for (const planet of PLANETS_7) {
    const llm = extraction.vocabulary?.[planet] ?? {};
    const base = baseline[planet];
    const prev = previous?.states_map?.[planet];
    const rejectedLabels = new Set((llm.rejectedStates ?? []).map(normalizePhrase));
    const positive = new Map<string, StateItem>();
    const negative = new Map<string, StateItem>();

    for (const label of llm.confirmedStates ?? []) {
      const normalized = normalizePhrase(label);
      const isPositive = base.harmonicStates.some((state) => normalizePhrase(state) === normalized);
      const target = isPositive ? positive : negative;
      target.set(slugify(label), stableState(label, "user_confirmed"));
    }

    for (const added of llm.addedStates ?? []) {
      const label = addedStateLabel(added);
      if (!label) continue;
      const target = addedStatePolarity(added) === "positive" ? positive : negative;
      target.set(slugify(label), stableState(label, "user_added"));
    }

    for (const oldState of prev?.positive_states ?? []) {
      if (!rejectedLabels.has(normalizePhrase(oldState.label))) positive.set(oldState.id, oldState);
    }
    for (const oldState of prev?.negative_states ?? []) {
      if (!rejectedLabels.has(normalizePhrase(oldState.label))) negative.set(oldState.id, oldState);
    }

    if (positive.size === 0) {
      for (const label of base.harmonicStates.slice(0, 4)) {
        positive.set(slugify(label), stableState(label, "baseline", 0.5));
      }
    }
    if (negative.size === 0) {
      for (const label of base.dissonantStates.slice(0, 4)) {
        negative.set(slugify(label), stableState(label, "baseline", 0.5));
      }
    }

    result[planet] = {
      chakra_number: base.chakra_number,
      positive_states: [...positive.values()],
      negative_states: [...negative.values()],
      rejected_states: [...rejectedLabels].map((label) => ({ id: slugify(label), label, source: "baseline" })),
      is_confirmed: Boolean((llm.confirmedStates?.length ?? 0) + (llm.addedStates?.length ?? 0)),
    };
  }

  return result;
}

export function buildLexicon(
  extraction: CalibrationExtraction,
  previous: { user_lexicon?: UserLexicon } | null | undefined,
  source: CalibrationSource,
): UserLexicon {
  const previousPhrases = previous?.user_lexicon?.phrases ?? [];
  const phrases = new Map<string, UserLexicon["phrases"][number]>();
  const now = new Date().toISOString();

  for (const planet of PLANETS_7) {
    const llm = extraction.vocabulary?.[planet] ?? {};
    const triggers = (llm.confirmedStates ?? []).map(slugify);
    for (const phrase of llm.personalPhrases ?? []) {
      const normalized = normalizePhrase(phrase);
      const existing = previousPhrases.find((item) => normalizePhrase(item.text) === normalized);
      phrases.set(normalized, {
        ...(existing ?? {
          id: crypto.randomUUID(),
          text: phrase,
          triggers_states: triggers,
          associated_planet: planet,
          first_seen_at: now,
          frequency: 0,
          source: `calibration_${source}`,
        }),
        frequency: (existing?.frequency ?? 0) + 1,
      });
    }
  }

  for (const oldPhrase of previousPhrases) {
    const normalized = normalizePhrase(oldPhrase.text);
    if (!phrases.has(normalized)) {
      phrases.set(normalized, { ...oldPhrase, frequency: Math.max(1, oldPhrase.frequency - 0.5) });
    }
  }

  return {
    phrases: [...phrases.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 30),
    style_markers: previous?.user_lexicon?.style_markers ?? {
      speaks_in_metaphors: false,
      uses_diminutives: false,
      formal_register: false,
      preferred_pronouns: "you_informal",
    },
  };
}
