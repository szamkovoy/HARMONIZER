export type Planet = "Sun" | "Moon" | "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";

export type ZodiacSign =
  | "Aries"
  | "Taurus"
  | "Gemini"
  | "Cancer"
  | "Leo"
  | "Virgo"
  | "Libra"
  | "Scorpio"
  | "Sagittarius"
  | "Capricorn"
  | "Aquarius"
  | "Pisces";

export type PrecisionMode = "precise" | "approximate" | "unknown";
export type HouseSystem = "whole_sign_asc" | "whole_sign_sun";
export type SunRelation = "cazimi" | "combust" | "under_beams" | "free";
export type AspectType = "conjunction" | "opposition" | "square" | "trine" | "sextile";

export interface BirthData {
  date: string;
  timeMode: PrecisionMode;
  time?: string;
  timeIntervalMinutes?: number;
  location: {
    lat: number;
    lng: number;
    timezone: string;
  };
}

export interface PlanetPosition {
  longitude: number;
  speed: number;
  isRetrograde: boolean;
}

export interface ChartPositions {
  planets: Record<Planet, PlanetPosition>;
  ascendantLongitude?: number;
  isDayChart: boolean;
  ephemerisLibVersion: string;
  computedAt?: string;
}

export interface BonificationDetail {
  by: Planet;
  kind: "conjunction" | "trine" | "sextile" | "overcoming" | "besiegement";
  score: number;
}

export interface MaltreatmentDetail {
  by: Planet | "Mars-Saturn";
  kind: "conjunction" | "opposition" | "square" | "overcoming" | "besiegement" | "dispositor";
  score: number;
}

export interface EssentialDignity {
  domicile: boolean;
  exaltation: boolean;
  triplicity: boolean;
  term: boolean;
  face: boolean;
  detriment: boolean;
  fall: boolean;
  peregrine: boolean;
  score: number;
}

export interface AccidentalDignity {
  houseScore: number;
  motionScore: number;
  sunRelation: SunRelation;
  sunRelationScore: number;
  conjunctionWithBenefic: boolean;
  besieged: boolean;
  score: number;
}

export interface PlanetState extends PlanetPosition {
  sign: ZodiacSign;
  signDegree: number;
  house: number;
  essentialDignity: EssentialDignity;
  accidentalDignity: AccidentalDignity;
  sectBonus: number;
  S_initial: number;
  harmoniousnessFactors: {
    bonifications: BonificationDetail[];
    maltreatments: MaltreatmentDetail[];
    rawScore: number;
  };
  H_initial: number;
}

export interface NatalProfile {
  precisionMode: PrecisionMode;
  isDayChart: boolean;
  ascendant?: { longitude: number; sign: ZodiacSign };
  houseSystem: HouseSystem;
  planets: Record<Planet, PlanetState>;
  computedAt: string;
  ephemerisLibVersion: string;
}
