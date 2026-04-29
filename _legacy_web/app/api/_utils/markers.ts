export type StateProposalMarker = {
  proposed_planet: string;
  proposed_label: string;
  proposed_polarity: "positive" | "negative";
  trigger_phrase?: string | null;
};

export type PracticePickMarker = {
  id: string;
  reason?: string;
};

export type RecommendationCorrectionMarker = {
  short_text?: string;
  windows_correction?: string;
};

function attr(source: string, name: string): string | undefined {
  const match = source.match(new RegExp(`${name}\\s*=\\s*["“”']([^"“”']+)["“”']`, "i"));
  return match?.[1]?.trim();
}

export function parseResponseMarkers(text: string): {
  stateProposals: StateProposalMarker[];
  practicePick: PracticePickMarker | null;
  recommendationCorrection: RecommendationCorrectionMarker | null;
} {
  const stateProposals: StateProposalMarker[] = [];
  for (const match of text.matchAll(/\[STATE_PROPOSAL:\s*([^\]]+)\]/gi)) {
    const raw = match[1] ?? "";
    const planet = attr(raw, "planet");
    const label = attr(raw, "label");
    const polarity = attr(raw, "polarity");
    if (!planet || !label || (polarity !== "positive" && polarity !== "negative")) continue;
    stateProposals.push({
      proposed_planet: planet,
      proposed_label: label,
      proposed_polarity: polarity,
      trigger_phrase: attr(raw, "trigger_phrase") ?? null,
    });
  }

  const practiceRaw = text.match(/\[PRACTICE_PICK:\s*([^\]]+)\]/i)?.[1] ?? "";
  const practiceId = attr(practiceRaw, "id");
  const practicePick = practiceId ? { id: practiceId, reason: attr(practiceRaw, "reason") } : null;

  const correctionRaw = text.match(/\[CORRECT_RECOMMENDATION:\s*([^\]]+)\]/i)?.[1] ?? "";
  const recommendationCorrection = correctionRaw
    ? {
        short_text: attr(correctionRaw, "short_text"),
        windows_correction: attr(correctionRaw, "windows_correction"),
      }
    : null;

  return { stateProposals, practicePick, recommendationCorrection };
}

export function stripResponseMarkers(text: string): string {
  return text
    .replace(/\[(STATE_PROPOSAL|PRACTICE_PICK|CORRECT_RECOMMENDATION):[^\]]+\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
