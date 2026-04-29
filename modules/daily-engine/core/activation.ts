import { PLANETS_7 } from "../../astro-core";
import { findAspect } from "./aspects";
import { ASPECT_COEF, TRANSIT_WEIGHT } from "./constants";
import type { ActivationContribution, CalibrationLike, Planet, TransitChart } from "./types";
import type { NatalProfile } from "../../astro-core";

function emptyPlanetMap(): Record<Planet, number> {
  return Object.fromEntries(PLANETS_7.map((planet) => [planet, 0])) as Record<Planet, number>;
}

export function effectiveNatalParams(
  natalProfile: NatalProfile,
  calibration: CalibrationLike | null,
): { S_eff: Record<Planet, number>; H_eff: Record<Planet, number> } {
  const S_eff = emptyPlanetMap();
  const H_eff = emptyPlanetMap();
  const sCal = calibration?.S_calibrated ?? calibration?.s_calibrated;
  const hCal = calibration?.H_calibrated ?? calibration?.h_calibrated;

  for (const planet of PLANETS_7) {
    S_eff[planet] = sCal?.[planet] ?? natalProfile.planets[planet].S_initial;
    H_eff[planet] = hCal?.[planet] ?? natalProfile.planets[planet].H_initial;
  }

  return { S_eff, H_eff };
}

export function computeActivation(params: {
  natalProfile: NatalProfile;
  transitChart: TransitChart;
}): { activation: Record<Planet, number>; contributions: ActivationContribution[] } {
  const activation = emptyPlanetMap();
  const contributions: ActivationContribution[] = [];

  for (const natalPlanet of PLANETS_7) {
    const natalState = params.natalProfile.planets[natalPlanet];

    for (const transitPlanet of PLANETS_7) {
      const transitState = params.transitChart.planets[transitPlanet];
      const aspect = findAspect({
        transitLongitude: transitState.longitude,
        transitSpeed: transitState.speed,
        natalLongitude: natalState.longitude,
      });
      if (!aspect) continue;

      const orbCloseness = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
      const applyingMul = aspect.isApplying ? 1.2 : 0.8;
      const sameBodyBonus = transitPlanet === natalPlanet ? (aspect.type === "conjunction" ? 1.5 : 1.3) : 1;
      let value = ASPECT_COEF[aspect.type] * orbCloseness * applyingMul * TRANSIT_WEIGHT[transitPlanet] * sameBodyBonus;

      if (params.natalProfile.precisionMode === "approximate" && (transitPlanet === "Moon" || natalPlanet === "Moon")) {
        value *= 0.7;
      }
      if (params.natalProfile.precisionMode === "unknown" && (transitPlanet === "Moon" || natalPlanet === "Moon")) {
        value *= 0.5;
      }

      activation[natalPlanet] += value;
      contributions.push({ natalPlanet, transitPlanet, aspect, value });
    }
  }

  return { activation, contributions };
}

export function computeImportance(activation: Record<Planet, number>, S_eff: Record<Planet, number>): Record<Planet, number> {
  const importance = emptyPlanetMap();
  for (const planet of PLANETS_7) {
    importance[planet] = activation[planet] * (0.5 + 0.5 * S_eff[planet]);
  }
  return importance;
}
