import { ZODIAC_SIGNS } from "./constants";
import type { Planet, ZodiacSign } from "./types";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLongitude(longitude: number): number {
  const normalized = longitude % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function signOf(longitude: number): ZodiacSign {
  return ZODIAC_SIGNS[Math.floor(normalizeLongitude(longitude) / 30)]!;
}

export function signDegree(longitude: number): number {
  return normalizeLongitude(longitude) % 30;
}

export function signNumber(sign: ZodiacSign): number {
  return ZODIAC_SIGNS.indexOf(sign);
}

export function signWithOffset(sign: ZodiacSign, offset: number): ZodiacSign {
  return ZODIAC_SIGNS[(signNumber(sign) + offset + 1200) % 12]!;
}

export function oppositeSign(sign: ZodiacSign): ZodiacSign {
  return signWithOffset(sign, 6);
}

export function wholeSignHouse(planetSign: ZodiacSign, house1Sign: ZodiacSign): number {
  return ((signNumber(planetSign) - signNumber(house1Sign) + 12) % 12) + 1;
}

export function angularDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta);
}

export function signedForwardDistance(from: number, to: number): number {
  return (normalizeLongitude(to) - normalizeLongitude(from) + 360) % 360;
}

export function isBetweenByLongitude(target: number, left: number, right: number, orb = 10): boolean {
  const leftAhead = signedForwardDistance(target, left);
  const rightAhead = signedForwardDistance(target, right);
  return (
    ((leftAhead > 0 && leftAhead <= orb && rightAhead >= 360 - orb) ||
      (rightAhead > 0 && rightAhead <= orb && leftAhead >= 360 - orb))
  );
}

export function aspectOrb(
  longitudeA: number,
  longitudeB: number,
  exactAngle: number,
): number {
  return Math.abs(angularDistance(longitudeA, longitudeB) - exactAngle);
}

export function combinedOrb(a: Planet, b: Planet, orbs: Record<Planet, number>): number {
  return (orbs[a] + orbs[b]) / 2;
}
