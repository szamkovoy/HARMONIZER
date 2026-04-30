import type { AspectType, Planet } from "./types";

export const ASPECT_COEF: Record<AspectType, number> = {
  conjunction: 1,
  opposition: 0.9,
  square: 0.8,
  trine: 0.7,
  sextile: 0.5,
};

export const TRANSIT_WEIGHT: Record<Planet, number> = {
  Saturn: 1,
  Jupiter: 0.9,
  Mars: 0.8,
  Sun: 0.7,
  Venus: 0.5,
  Mercury: 0.5,
  Moon: 0.3,
};

export const ASPECT_MAX_ORB: Record<AspectType, number> = {
  conjunction: 6,
  opposition: 6,
  square: 5,
  trine: 5,
  sextile: 3,
};

export const ASPECT_EXACT_ANGLE: Record<AspectType, number> = {
  conjunction: 0,
  opposition: 180,
  trine: 120,
  square: 90,
  sextile: 60,
};
