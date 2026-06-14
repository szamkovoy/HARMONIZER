import type { Planet } from "@/modules/daily-engine";
import { chakraLabel, chakraShortLabel, type ChakraLocale } from "@/modules/chakra/i18n";
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

function buildPlanetChakraMap(locale: ChakraLocale): Record<Planet, PlanetChakraMeta> {
  return PLANET_ORDER.reduce(
    (acc, planet) => {
      const item = rawMap.planets[planet];
      acc[planet] = {
        planet,
        chakraNumber: item.chakra_number,
        chakraKey: item.chakra_key,
        chakraName: chakraLabel(locale, item.chakra_number),
        color: item.color_hex,
        label: chakraShortLabel(locale, item.chakra_number),
      };
      return acc;
    },
    {} as Record<Planet, PlanetChakraMeta>,
  );
}

/** @deprecated Prefer `getPlanetChakraMap(locale)` — defaults to Russian. */
export const PLANET_CHAKRA = buildPlanetChakraMap("ru");

export function getPlanetChakraMap(locale: ChakraLocale): Record<Planet, PlanetChakraMeta> {
  return locale === "ru" ? PLANET_CHAKRA : buildPlanetChakraMap(locale);
}
