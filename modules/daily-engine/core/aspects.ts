import { ASPECT_EXACT_ANGLE, ASPECT_MAX_ORB } from "./constants";
import type { AspectType, TransitAspect } from "./types";

function normalizeLongitude(longitude: number): number {
  const normalized = longitude % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function angularDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta);
}

function orbToAspect(transitLongitude: number, natalLongitude: number, exactAngle: number): number {
  return Math.abs(angularDistance(transitLongitude, natalLongitude) - exactAngle);
}

function isApplying(params: {
  transitLongitude: number;
  transitSpeed: number;
  natalLongitude: number;
  exactAngle: number;
  currentOrb: number;
}): boolean {
  const nextTransitLongitude = params.transitLongitude + params.transitSpeed / 24;
  const nextOrb = orbToAspect(nextTransitLongitude, params.natalLongitude, params.exactAngle);
  return nextOrb < params.currentOrb;
}

export function findAspect(params: {
  transitLongitude: number;
  transitSpeed: number;
  natalLongitude: number;
}): TransitAspect | null {
  const candidates: AspectType[] = ["conjunction", "opposition", "trine", "square", "sextile"];

  for (const type of candidates) {
    const exactAngle = ASPECT_EXACT_ANGLE[type];
    const maxOrb = ASPECT_MAX_ORB[type];
    const orb = orbToAspect(params.transitLongitude, params.natalLongitude, exactAngle);

    if (orb <= maxOrb) {
      return {
        type,
        orb,
        maxOrb,
        isApplying: isApplying({
          ...params,
          exactAngle,
          currentOrb: orb,
        }),
      };
    }
  }

  return null;
}
