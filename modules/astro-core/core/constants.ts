import type { Planet, ZodiacSign } from "./types";

export const PLANETS_7: Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

export const ZODIAC_SIGNS: ZodiacSign[] = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];

export const BENEFICS: Planet[] = ["Jupiter", "Venus"];
export const MALEFICS: Planet[] = ["Mars", "Saturn"];

export const DOMICILES: Record<Planet, ZodiacSign[]> = {
  Sun: ["Leo"],
  Moon: ["Cancer"],
  Mercury: ["Gemini", "Virgo"],
  Venus: ["Taurus", "Libra"],
  Mars: ["Aries", "Scorpio"],
  Jupiter: ["Sagittarius", "Pisces"],
  Saturn: ["Capricorn", "Aquarius"],
};

export const EXALTATIONS: Record<Planet, ZodiacSign> = {
  Sun: "Aries",
  Moon: "Taurus",
  Mercury: "Virgo",
  Venus: "Pisces",
  Mars: "Capricorn",
  Jupiter: "Cancer",
  Saturn: "Libra",
};

export const TRIPLICITY_RULERS: Record<"fire" | "earth" | "air" | "water", { day: Planet; night: Planet }> = {
  fire: { day: "Sun", night: "Jupiter" },
  earth: { day: "Venus", night: "Moon" },
  air: { day: "Saturn", night: "Mercury" },
  water: { day: "Venus", night: "Mars" },
};

export const SIGN_ELEMENTS: Record<ZodiacSign, keyof typeof TRIPLICITY_RULERS> = {
  Aries: "fire",
  Leo: "fire",
  Sagittarius: "fire",
  Taurus: "earth",
  Virgo: "earth",
  Capricorn: "earth",
  Gemini: "air",
  Libra: "air",
  Aquarius: "air",
  Cancer: "water",
  Scorpio: "water",
  Pisces: "water",
};

export const MEAN_SPEED: Record<Planet, number> = {
  Sun: 0.9856,
  Moon: 13.176,
  Mercury: 1.2,
  Venus: 1.2,
  Mars: 0.52,
  Jupiter: 0.083,
  Saturn: 0.033,
};

export const PLANET_ORBS: Record<Planet, number> = {
  Sun: 15,
  Moon: 12,
  Mercury: 7,
  Venus: 7,
  Mars: 7,
  Jupiter: 9,
  Saturn: 9,
};
