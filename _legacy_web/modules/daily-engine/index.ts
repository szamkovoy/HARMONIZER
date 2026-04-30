/**
 * Public API for M2 Daily-Engine.
 *
 * Like M1, the mathematical layer is pure and receives transit positions from
 * an injected provider. Rise/culmination windows are intentionally adapter-level
 * work and can be filled once the ephemeris implementation is connected.
 */

export { computeDailyForecast, computeDailyForecastFromTransits } from "./computeDailyForecast";
export type { TransitProvider } from "./computeDailyForecast";
export { AstronomiaTransitProvider, computeDailyForecastWithAstronomia } from "./ephemeris";
export { computeActivation, computeImportance, effectiveNatalParams } from "./core/activation";
export { findAspect } from "./core/aspects";
export { chooseFinalPlanet, rankPlanets } from "./core/chooseFinalPlanet";
export type {
  ActivationContribution,
  AspectType,
  CalibrationLike,
  DailyEngineInput,
  DailyForecast,
  Planet,
  TodayTone,
  TransitAspect,
  TransitChart,
  WindowComputationContext,
} from "./core/types";
