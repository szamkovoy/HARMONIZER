import egyptianTerms from "../data/egyptian_terms.json";
import { DOMICILES, EXALTATIONS, SIGN_ELEMENTS, TRIPLICITY_RULERS } from "./constants";
import { oppositeSign } from "./math";
import type { EssentialDignity, Planet, ZodiacSign } from "./types";

type TermRow = [Planet, number, number];

const FACE_RULERS: Planet[] = ["Mars", "Sun", "Venus", "Mercury", "Moon", "Saturn", "Jupiter"];

export function termRulerOf(sign: ZodiacSign, degree: number): Planet | null {
  const rows = (egyptianTerms as Record<ZodiacSign, TermRow[]>)[sign];
  return rows.find(([, start, end]) => degree >= start && degree < end)?.[0] ?? null;
}

export function faceRulerOf(sign: ZodiacSign, degree: number): Planet {
  const signOffset = Object.keys(egyptianTerms).indexOf(sign) * 3;
  const decan = Math.min(2, Math.floor(degree / 10));
  return FACE_RULERS[(signOffset + decan) % FACE_RULERS.length]!;
}

export function computeEssentialDignity(params: {
  planet: Planet;
  sign: ZodiacSign;
  signDegree: number;
  isDayChart: boolean;
}): EssentialDignity {
  const { planet, sign, signDegree, isDayChart } = params;
  const element = SIGN_ELEMENTS[sign];
  const triplicityRuler = isDayChart ? TRIPLICITY_RULERS[element].day : TRIPLICITY_RULERS[element].night;

  const domicile = DOMICILES[planet].includes(sign);
  const exaltation = EXALTATIONS[planet] === sign;
  const triplicity = triplicityRuler === planet;
  const term = termRulerOf(sign, signDegree) === planet;
  const face = faceRulerOf(sign, signDegree) === planet;
  const detriment = DOMICILES[planet].some((domicileSign) => oppositeSign(domicileSign) === sign);
  const fall = oppositeSign(EXALTATIONS[planet]) === sign;

  let score = 0;
  if (domicile) score += 5;
  if (exaltation) score += 4;
  if (triplicity) score += 3;
  if (term) score += 2;
  if (face) score += 1;
  if (detriment) score -= 5;
  if (fall) score -= 4;

  const peregrine = score === 0;
  if (peregrine) score = -5;

  return {
    domicile,
    exaltation,
    triplicity,
    term,
    face,
    detriment,
    fall,
    peregrine,
    score,
  };
}
