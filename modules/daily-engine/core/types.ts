import type { NatalProfile, Planet, PlanetPosition } from "../../astro-core";

export type { Planet };

export type AspectType = "conjunction" | "opposition" | "square" | "trine" | "sextile";
export type TodayTone = "harmonic" | "neutral" | "dissonant";

export interface CalibrationLike {
  S_calibrated?: Partial<Record<Planet, number>>;
  H_calibrated?: Partial<Record<Planet, number>>;
  s_calibrated?: Partial<Record<Planet, number>>;
  h_calibrated?: Partial<Record<Planet, number>>;
}

export interface DailyEngineInput {
  natalProfile: NatalProfile;
  calibration: CalibrationLike | null;
  forecastDate: string;
  userLocation: {
    lat: number;
    lng: number;
    timezone: string;
  };
  recentPlanetsOfDay: Planet[];
}

export interface TransitChart {
  referenceTime: string;
  planets: Record<Planet, PlanetPosition>;
}

export interface TransitAspect {
  type: AspectType;
  orb: number;
  maxOrb: number;
  isApplying: boolean;
}

export interface ActivationContribution {
  natalPlanet: Planet;
  transitPlanet: Planet;
  aspect: TransitAspect;
  value: number;
}

export interface DailyForecast {
  date: string;
  importance: Record<Planet, number>;
  activation: Record<Planet, number>;
  rankedPlanets: Planet[];
  planetOfTheDay: Planet;
  isAlternativeChoice: boolean;
  alternativeReasonText?: string;
  todayPlanetState: {
    naturalHarmoniousness: number;
    todayTone: TodayTone;
  };
  windowsOfOpportunity: {
    sunrise: { time: string; planet: Planet } | null;
    culmination: { time: string; planet: Planet } | null;
    exactAspect: { time: string; aspectType: AspectType; toNatalPlanet: Planet; transitPlanet: Planet } | null;
  };
  transitChart: TransitChart;
  computedAt: string;
  cacheValidUntil: string;
  recommendationShortText?: string;
  recommendationLongText?: string;
  slogan?: string;
  mathLevel?: {
    markdown: string;
    structured?: unknown;
  };
  isGlobal?: boolean;
}

export interface WindowComputationContext {
  mainTransitPlanet: Planet;
  planetOfTheDay: Planet;
  mainAspect: TransitAspect;
}
