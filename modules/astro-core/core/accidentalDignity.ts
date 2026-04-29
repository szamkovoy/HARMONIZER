import { BENEFICS, MEAN_SPEED } from "./constants";
import { angularDistance, isBetweenByLongitude } from "./math";
import type { AccidentalDignity, Planet, PlanetPosition, PrecisionMode, SunRelation } from "./types";

const HOUSE_SCORE: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
  4: 4,
  5: 3,
  6: -2,
  7: 4,
  8: -2,
  9: 2,
  10: 5,
  11: 4,
  12: -5,
};

function scoreSunRelation(planet: Planet, position: PlanetPosition, sun: PlanetPosition): {
  relation: SunRelation;
  score: number;
} {
  if (planet === "Sun") return { relation: "free", score: 0 };

  const angle = angularDistance(position.longitude, sun.longitude);
  if (angle < 0.283) return { relation: "cazimi", score: 5 };
  if (angle < 8.5) return { relation: "combust", score: -5 };
  if (angle < 17) return { relation: "under_beams", score: -4 };
  return { relation: "free", score: 0 };
}

function scoreMotion(planet: Planet, position: PlanetPosition): number {
  if (planet === "Sun" || planet === "Moon") return 0;
  if (position.isRetrograde) return -5;
  if (position.speed > MEAN_SPEED[planet] * 1.1) return 2;
  return 4;
}

export function computeAccidentalDignity(params: {
  planet: Planet;
  position: PlanetPosition;
  house: number;
  precisionMode: PrecisionMode;
  allPositions: Record<Planet, PlanetPosition>;
}): AccidentalDignity {
  const { planet, position, house, precisionMode, allPositions } = params;
  const houseMultiplier = precisionMode === "approximate" ? 0.7 : 1;
  const houseScore = (HOUSE_SCORE[house] ?? 0) * houseMultiplier;
  const motionScore = scoreMotion(planet, position);
  const { relation: sunRelation, score: sunRelationScore } = scoreSunRelation(planet, position, allPositions.Sun);

  const conjunctionWithBenefic = BENEFICS.some(
    (benefic) => benefic !== planet && angularDistance(position.longitude, allPositions[benefic].longitude) <= 5,
  );
  const beneficScore = conjunctionWithBenefic ? 5 : 0;

  const besieged = isBetweenByLongitude(
    position.longitude,
    allPositions.Mars.longitude,
    allPositions.Saturn.longitude,
  );
  const besiegedScore = besieged ? -5 : 0;

  return {
    houseScore,
    motionScore,
    sunRelation,
    sunRelationScore,
    conjunctionWithBenefic,
    besieged,
    score: houseScore + motionScore + sunRelationScore + beneficScore + besiegedScore,
  };
}
