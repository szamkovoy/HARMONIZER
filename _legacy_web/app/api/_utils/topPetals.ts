import { computeActivation } from "../../../modules/daily-engine/core/activation";
import type { ActivationContribution, TransitChart } from "../../../modules/daily-engine/core/types";
import type { NatalProfile, Planet } from "../../../modules/astro-core";

export const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

type Tone = "harmonic" | "dissonant" | "ambivalent_strong";

type ForecastLike = {
  importance?: Partial<Record<Planet, number>>;
  ranked_planets?: unknown;
  rankedPlanets?: unknown;
  transit_chart?: TransitChart;
  transitChart?: TransitChart;
};

export type CalibrationLike = {
  version?: number;
  source?: string;
  s_calibrated?: Partial<Record<Planet, number>>;
  h_calibrated?: Partial<Record<Planet, number>>;
  delta_from_initial?: Partial<Record<Planet, { dS?: number; dH?: number }>>;
  user_lexicon?: {
    phrases?: Array<{ text?: string; associated_planet?: string; planet?: string; frequency?: number }>;
  };
};

export interface PetalData {
  planet: Planet;
  chakra_number: number;
  chakra_label: string;
  importance: number;
  strength: number;
  harmoniousness: number;
  tone: Tone;
  main_transit: Planet | null;
  main_aspect: string | null;
  main_orb: number | null;
  main_activation: number | null;
}

export const PLANET_TO_CHAKRA: Record<Planet, { number: number; label: string }> = {
  Moon: { number: 1, label: "муладхара (телесность, безопасность)" },
  Venus: { number: 2, label: "свадхистхана (удовольствие, чувственность)" },
  Mars: { number: 3, label: "манипура (воля, действие)" },
  Jupiter: { number: 4, label: "анахата (любовь, отношения)" },
  Saturn: { number: 5, label: "вишуддха (самовыражение, речь)" },
  Mercury: { number: 6, label: "аджна (мудрость, ясность)" },
  Sun: { number: 7, label: "сахасрара (смысл, путь)" },
};

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS_7 as readonly string[]).includes(value);
}

function round(x: number, decimals: number): number {
  const k = Math.pow(10, decimals);
  return Math.round(x * k) / k;
}

function getTone(harmoniousness: number): Tone {
  if (Math.abs(harmoniousness) < 0.2) return "ambivalent_strong";
  return harmoniousness > 0 ? "harmonic" : "dissonant";
}

function normalizeRankedPlanets(forecast: ForecastLike): Planet[] {
  const rawRanked = forecast.ranked_planets ?? forecast.rankedPlanets;
  if (Array.isArray(rawRanked)) {
    const planets = rawRanked
      .map((entry) => (isPlanet(entry) ? entry : isPlanet((entry as { planet?: unknown })?.planet) ? (entry as { planet: Planet }).planet : null))
      .filter((planet): planet is Planet => Boolean(planet));
    if (planets.length) return planets;
  }

  const importance = forecast.importance ?? {};
  return [...PLANETS_7].sort((a, b) => (importance[b] ?? 0) - (importance[a] ?? 0));
}

function mainContributionForPlanet(
  forecast: ForecastLike,
  natal: NatalProfile,
  planet: Planet,
): ActivationContribution | null {
  const transitChart = forecast.transit_chart ?? forecast.transitChart;
  if (!transitChart) return null;

  const { contributions } = computeActivation({
    natalProfile: natal,
    transitChart,
  });

  return contributions
    .filter((contribution) => contribution.natalPlanet === planet)
    .sort((a, b) => b.value - a.value)[0] ?? null;
}

export function buildTopPetals(
  forecast: ForecastLike,
  natal: NatalProfile,
  calibration: CalibrationLike | null,
  topN = 3,
): PetalData[] {
  const ranked = normalizeRankedPlanets(forecast);

  return ranked.slice(0, topN).map((planet) => {
    const natalPlanet = natal.planets[planet];
    const sCal = calibration?.s_calibrated?.[planet] ?? natalPlanet.S_initial;
    const hCal = calibration?.h_calibrated?.[planet] ?? natalPlanet.H_initial;
    const mainContribution = mainContributionForPlanet(forecast, natal, planet);

    return {
      planet,
      chakra_number: PLANET_TO_CHAKRA[planet].number,
      chakra_label: PLANET_TO_CHAKRA[planet].label,
      importance: round(forecast.importance?.[planet] ?? 0, 3),
      strength: round(sCal, 2),
      harmoniousness: round(hCal, 2),
      tone: getTone(hCal),
      main_transit: mainContribution?.transitPlanet ?? null,
      main_aspect: mainContribution?.aspect.type ?? null,
      main_orb: mainContribution ? round(mainContribution.aspect.orb, 2) : null,
      main_activation: mainContribution ? round(mainContribution.value, 3) : null,
    };
  });
}

export function describePetalsRelation(petals: PetalData[]): string {
  const tones = petals.map((petal) => petal.tone);
  const harmonicCount = tones.filter((tone) => tone === "harmonic").length;
  const dissonantCount = tones.filter((tone) => tone === "dissonant").length;

  if (harmonicCount === 3) {
    return "чистая волна — все три темы поддерживают друг друга";
  }
  if (dissonantCount === 3) {
    return "тройной вызов — много энергии для глубокой работы, но требует осознанности";
  }
  if (petals[0]?.tone === "harmonic" && dissonantCount > 0) {
    return "поток как основа, но один из обертонов проверяет на устойчивость";
  }
  if (petals[0]?.tone === "dissonant" && harmonicCount > 0) {
    return "главный вызов поддержан более лёгкими резонансами — есть на что опереться";
  }
  return "смешанная картина — несколько разнородных сигналов одновременно";
}
