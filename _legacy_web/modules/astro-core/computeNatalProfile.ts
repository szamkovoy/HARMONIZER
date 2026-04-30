import { computeAccidentalDignity } from "./core/accidentalDignity";
import { PLANETS_7 } from "./core/constants";
import { computeEssentialDignity } from "./core/essentialDignity";
import { computeHarmoniousness } from "./core/harmoniousness";
import { clamp, signDegree, signOf, wholeSignHouse } from "./core/math";
import type { BirthData, ChartPositions, NatalProfile, Planet, PlanetState } from "./core/types";

export interface EphemerisProvider {
  computeNatalChart(input: BirthData): Promise<ChartPositions> | ChartPositions;
}

function sectBonusFor(planet: Planet, isDayChart: boolean): number {
  if (isDayChart && (planet === "Sun" || planet === "Jupiter" || planet === "Saturn")) return 2;
  if (!isDayChart && (planet === "Moon" || planet === "Venus" || planet === "Mars")) return 2;
  return 0;
}

function validateBirthData(input: BirthData): void {
  if (!input.date) throw new Error("Birth date is required");
  if (input.timeMode !== "unknown" && !input.time) {
    throw new Error("Birth time is required for precise and approximate modes");
  }
  if (
    input.timeMode === "approximate" &&
    input.timeIntervalMinutes != null &&
    (input.timeIntervalMinutes < 30 || input.timeIntervalMinutes > 240)
  ) {
    throw new Error("Approximate birth time interval must be between 30 and 240 minutes");
  }
}

export function computeNatalProfileFromPositions(params: {
  precisionMode: BirthData["timeMode"];
  chart: ChartPositions;
}): NatalProfile {
  const { precisionMode, chart } = params;
  const sunSign = signOf(chart.planets.Sun.longitude);
  const ascendantSign = chart.ascendantLongitude == null ? undefined : signOf(chart.ascendantLongitude);
  const houseSystem = precisionMode === "unknown" ? "whole_sign_sun" : "whole_sign_asc";
  const house1Sign = houseSystem === "whole_sign_sun" ? sunSign : ascendantSign;

  if (!house1Sign) {
    throw new Error("Ascendant longitude is required when precision mode is not unknown");
  }

  const planets = {} as Record<Planet, PlanetState>;

  for (const planet of PLANETS_7) {
    const position = chart.planets[planet];
    const sign = signOf(position.longitude);
    const degree = signDegree(position.longitude);
    const house = wholeSignHouse(sign, house1Sign);
    const essentialDignity = computeEssentialDignity({
      planet,
      sign,
      signDegree: degree,
      isDayChart: chart.isDayChart,
    });
    const accidentalDignity = computeAccidentalDignity({
      planet,
      position,
      house,
      precisionMode,
      allPositions: chart.planets,
    });
    const sectBonus = sectBonusFor(planet, chart.isDayChart);
    const rawS = essentialDignity.score + accidentalDignity.score + sectBonus;

    planets[planet] = {
      ...position,
      sign,
      signDegree: degree,
      house,
      essentialDignity,
      accidentalDignity,
      sectBonus,
      S_initial: clamp((rawS + 25) / 50, 0, 1),
      harmoniousnessFactors: {
        bonifications: [],
        maltreatments: [],
        rawScore: 0,
      },
      H_initial: 0,
    };
  }

  for (const planet of PLANETS_7) {
    const harmoniousness = computeHarmoniousness({
      planet,
      states: planets,
      precisionMode,
      isDayChart: chart.isDayChart,
    });
    planets[planet] = {
      ...planets[planet],
      harmoniousnessFactors: {
        bonifications: harmoniousness.bonifications,
        maltreatments: harmoniousness.maltreatments,
        rawScore: harmoniousness.rawScore,
      },
      H_initial: harmoniousness.H_initial,
    };
  }

  return {
    precisionMode,
    isDayChart: chart.isDayChart,
    ascendant:
      precisionMode !== "unknown" && chart.ascendantLongitude != null
        ? { longitude: chart.ascendantLongitude, sign: signOf(chart.ascendantLongitude) }
        : undefined,
    houseSystem,
    planets,
    computedAt: chart.computedAt ?? new Date().toISOString(),
    ephemerisLibVersion: chart.ephemerisLibVersion,
  };
}

export async function computeNatalProfile(
  birthData: BirthData,
  ephemerisProvider: EphemerisProvider,
): Promise<NatalProfile> {
  validateBirthData(birthData);
  const chart = await ephemerisProvider.computeNatalChart(birthData);
  return computeNatalProfileFromPositions({
    precisionMode: birthData.timeMode,
    chart,
  });
}
