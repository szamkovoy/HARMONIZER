import planetChakraMap from "../../../data/planet_chakra_map.json";

export type ChakraLegendItem = {
  chakra: number;
  label: string;
  shortLabel: string;
  color: string;
};

type PlanetMapEntry = {
  chakra_number: number;
  chakra_key: string;
  chakra_name_ru: string;
  color_hex: string;
  short_label_ru: string;
};

const rawMap = planetChakraMap as {
  order: string[];
  planets: Record<string, PlanetMapEntry>;
};

/** Chakra legend for profile reports — sourced from `_legacy_web/data/planet_chakra_map.json` (Vercel-safe). */
export function buildChakraLegend(): ChakraLegendItem[] {
  const byChakra = new Map<number, ChakraLegendItem>();
  for (const planet of rawMap.order) {
    const item = rawMap.planets[planet];
    if (!item) continue;
    byChakra.set(item.chakra_number, {
      chakra: item.chakra_number,
      label: item.chakra_name_ru,
      shortLabel: item.short_label_ru,
      color: item.color_hex,
    });
  }
  return [...byChakra.values()].sort((a, b) => a.chakra - b.chakra);
}
