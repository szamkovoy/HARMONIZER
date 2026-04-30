import { BENEFICS, DOMICILES, MALEFICS, PLANET_ORBS } from "./constants";
import { angularDistance, aspectOrb, combinedOrb, clamp, signNumber } from "./math";
import type { BonificationDetail, MaltreatmentDetail, Planet, PlanetState, PrecisionMode, ZodiacSign } from "./types";

function rulerOf(sign: ZodiacSign): Planet {
  const ruler = (Object.entries(DOMICILES) as Array<[Planet, ZodiacSign[]]>).find(([, signs]) => signs.includes(sign));
  if (!ruler) throw new Error(`No domicile ruler for sign ${sign}`);
  return ruler[0];
}

function hasReception(receiver: Planet, giver: Planet, states: Record<Planet, PlanetState>): boolean {
  const receiverSign = states[receiver].sign;
  return DOMICILES[giver].includes(receiverSign);
}

function isMutualReception(a: Planet, b: Planet, states: Record<Planet, PlanetState>): boolean {
  return hasReception(a, b, states) && hasReception(b, a, states);
}

function isInSect(planet: Planet, isDayChart: boolean): boolean {
  if (isDayChart) return planet === "Sun" || planet === "Jupiter" || planet === "Saturn";
  return planet === "Moon" || planet === "Venus" || planet === "Mars";
}

function isOvercomingByRightSquare(actor: Planet, target: Planet, states: Record<Planet, PlanetState>): boolean {
  const signsBetween = (signNumber(states[actor].sign) - signNumber(states[target].sign) + 12) % 12;
  return signsBetween === 9;
}

function isInAspect(
  a: Planet,
  b: Planet,
  exactAngle: number,
  states: Record<Planet, PlanetState>,
  orb = combinedOrb(a, b, PLANET_ORBS),
): boolean {
  return aspectOrb(states[a].longitude, states[b].longitude, exactAngle) <= orb;
}

function moderateMaltreatment(score: number, malefic: Planet, planet: Planet, states: Record<Planet, PlanetState>, isDayChart: boolean): number {
  let result = score;
  if (hasReception(malefic, planet, states)) result *= 0.5;
  if (isMutualReception(malefic, planet, states)) result *= 0.25;
  if (!isInSect(malefic, isDayChart)) result *= 1.5;
  return result;
}

function applyMoonUncertainty(score: number, precisionMode: PrecisionMode, a: Planet, b: Planet): number {
  return precisionMode === "unknown" && (a === "Moon" || b === "Moon") ? score * 0.5 : score;
}

function beneficAspectScore(baseScore: number, benefic: Planet, planet: Planet, states: Record<Planet, PlanetState>, isDayChart: boolean): number {
  let score = baseScore;
  if (hasReception(benefic, planet, states)) score *= 1.5;
  if (states[benefic].essentialDignity.score > 0) score *= 1.5;
  if (isInSect(benefic, isDayChart)) score *= 1.3;
  return score;
}

export function computeHarmoniousness(params: {
  planet: Planet;
  states: Record<Planet, PlanetState>;
  precisionMode: PrecisionMode;
  isDayChart: boolean;
}): {
  bonifications: BonificationDetail[];
  maltreatments: MaltreatmentDetail[];
  rawScore: number;
  H_initial: number;
} {
  const { planet, states, precisionMode, isDayChart } = params;
  const bonifications: BonificationDetail[] = [];
  const maltreatments: MaltreatmentDetail[] = [];
  let rawScore = 0;

  for (const malefic of MALEFICS) {
    if (planet === malefic) continue;

    if (angularDistance(states[planet].longitude, states[malefic].longitude) <= 3) {
      const score = applyMoonUncertainty(
        moderateMaltreatment(-4, malefic, planet, states, isDayChart),
        precisionMode,
        planet,
        malefic,
      );
      rawScore += score;
      maltreatments.push({ by: malefic, kind: "conjunction", score });
    }

    if (isInAspect(planet, malefic, 180, states, combinedOrb(planet, malefic, PLANET_ORBS) / 2)) {
      const score = applyMoonUncertainty(
        moderateMaltreatment(-3, malefic, planet, states, isDayChart),
        precisionMode,
        planet,
        malefic,
      );
      rawScore += score;
      maltreatments.push({ by: malefic, kind: "opposition", score });
    }

    if (isOvercomingByRightSquare(malefic, planet, states)) {
      const score = applyMoonUncertainty(
        moderateMaltreatment(-4, malefic, planet, states, isDayChart),
        precisionMode,
        planet,
        malefic,
      );
      rawScore += score;
      maltreatments.push({ by: malefic, kind: "overcoming", score });
    } else if (isInAspect(planet, malefic, 90, states)) {
      const score = applyMoonUncertainty(
        moderateMaltreatment(-2, malefic, planet, states, isDayChart),
        precisionMode,
        planet,
        malefic,
      );
      rawScore += score;
      maltreatments.push({ by: malefic, kind: "square", score });
    }
  }

  if (states[planet].accidentalDignity.besieged) {
    rawScore -= 5;
    maltreatments.push({ by: "Mars-Saturn", kind: "besiegement", score: -5 });
  }

  const dispositor = rulerOf(states[planet].sign);
  if ([6, 8, 12].includes(states[dispositor].house)) {
    rawScore -= 2;
    maltreatments.push({ by: dispositor, kind: "dispositor", score: -2 });
  }
  if (states[dispositor].accidentalDignity.sunRelation === "combust") {
    rawScore -= 2;
    maltreatments.push({ by: dispositor, kind: "dispositor", score: -2 });
  }

  for (const benefic of BENEFICS) {
    if (planet === benefic) continue;

    if (angularDistance(states[planet].longitude, states[benefic].longitude) <= 5) {
      let score = 4;
      if (hasReception(benefic, planet, states)) score *= 1.5;
      if (isInSect(benefic, isDayChart)) score *= 1.3;
      score = applyMoonUncertainty(score, precisionMode, planet, benefic);
      rawScore += score;
      bonifications.push({ by: benefic, kind: "conjunction", score });
    }

    if (isInAspect(planet, benefic, 120, states)) {
      const score = applyMoonUncertainty(beneficAspectScore(3, benefic, planet, states, isDayChart), precisionMode, planet, benefic);
      rawScore += score;
      bonifications.push({ by: benefic, kind: "trine", score });
    }

    if (isInAspect(planet, benefic, 60, states)) {
      const score = applyMoonUncertainty(beneficAspectScore(2, benefic, planet, states, isDayChart), precisionMode, planet, benefic);
      rawScore += score;
      bonifications.push({ by: benefic, kind: "sextile", score });
    }

    if (isOvercomingByRightSquare(benefic, planet, states)) {
      const score = applyMoonUncertainty(4, precisionMode, planet, benefic);
      rawScore += score;
      bonifications.push({ by: benefic, kind: "overcoming", score });
    }
  }

  if (
    angularDistance(states[planet].longitude, states.Jupiter.longitude) <= 10 &&
    angularDistance(states[planet].longitude, states.Venus.longitude) <= 10
  ) {
    rawScore += 5;
    bonifications.push({ by: "Jupiter", kind: "besiegement", score: 5 });
  }

  return {
    bonifications,
    maltreatments,
    rawScore,
    H_initial: clamp(rawScore / 10, -1, 1),
  };
}
