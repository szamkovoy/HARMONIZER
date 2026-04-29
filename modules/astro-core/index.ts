/**
 * Public API for M1 Astro-Core.
 *
 * The current layer is intentionally pure: astronomical positions come from an
 * injected ephemeris provider, while all dignity/S/H math is deterministic and
 * unit-testable on fixtures.
 */

export { computeNatalProfile, computeNatalProfileFromPositions } from "./computeNatalProfile";
export type { EphemerisProvider } from "./computeNatalProfile";
export {
  AstronomiaEphemerisProvider,
  computeNatalProfileWithAstronomia,
  eclipticLongitudeForPlanetAt,
  equatorialForPlanetAt,
  positionForPlanetAt,
} from "./ephemeris";
export type { EquatorialPosition } from "./ephemeris";
export { computeEssentialDignity, faceRulerOf, termRulerOf } from "./core/essentialDignity";
export { computeAccidentalDignity } from "./core/accidentalDignity";
export { computeHarmoniousness } from "./core/harmoniousness";
export { PLANETS_7, ZODIAC_SIGNS } from "./core/constants";
export type {
  AccidentalDignity,
  AspectType,
  BirthData,
  BonificationDetail,
  ChartPositions,
  EssentialDignity,
  HouseSystem,
  MaltreatmentDetail,
  NatalProfile,
  Planet,
  PlanetPosition,
  PlanetState,
  PrecisionMode,
  SunRelation,
  ZodiacSign,
} from "./core/types";
