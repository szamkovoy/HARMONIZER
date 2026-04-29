import type { Planet } from "@/modules/daily-engine";
import planetChakraMap from "./data/planet_chakra_map.json";

export interface PlanetChakraMeta {
  planet: Planet;
  chakraNumber: number;
  chakraKey: string;
  chakraName: string;
  color: string;
  label: string;
}

type PlanetMapEntry = {
  chakra_number: number;
  chakra_key: string;
  chakra_name_ru: string;
  color_hex: string;
  short_label_ru: string;
};

const rawMap = planetChakraMap as {
  order: Planet[];
  planets: Record<Planet, PlanetMapEntry>;
};

export const PLANET_ORDER: Planet[] = rawMap.order;

export const PLANET_CHAKRA = PLANET_ORDER.reduce(
  (acc, planet) => {
    const item = rawMap.planets[planet];
    acc[planet] = {
      planet,
      chakraNumber: item.chakra_number,
      chakraKey: item.chakra_key,
      chakraName: item.chakra_name_ru,
      color: item.color_hex,
      label: item.short_label_ru,
    };
    return acc;
  },
  {} as Record<Planet, PlanetChakraMeta>,
);
