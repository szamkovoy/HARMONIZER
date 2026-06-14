import { computeActivation } from "../../../modules/daily-engine/core/activation";
import { ASPECT_COEF, TRANSIT_WEIGHT } from "../../../modules/daily-engine/core/constants";
import type { TransitChart } from "../../../modules/daily-engine/core/types";
import type { NatalProfile, Planet } from "../../../modules/astro-core";
import { PLANET_TO_CHAKRA, PLANETS_7 } from "./topPetals";
import type { CalibrationLike } from "./topPetals";
import type { AppContentLocale } from "./contentLocales";
import { getMathLevelStrings } from "./mathLevelI18n";

type ForecastLike = {
  importance?: Partial<Record<Planet, number>>;
  activation?: Partial<Record<Planet, number>>;
  ranked_planets?: unknown;
  rankedPlanets?: unknown;
  planet_of_the_day?: Planet;
  planetOfTheDay?: Planet;
  is_alternative_choice?: boolean;
  isAlternativeChoice?: boolean;
  alternative_reason_text?: string | null;
  alternativeReasonText?: string | null;
  transit_chart?: TransitChart;
  transitChart?: TransitChart;
};

export interface MathLevelData {
  /** Ready-to-render markdown for the future "Mathematics" modal. */
  markdown: string;
  structured: {
    natal_strengths: Array<{ planet: Planet; chakra: number; S: number; H: number; formula_summary: string }>;
    main_aspects: Array<{ from: Planet; to: Planet; type: string; orb: number; coef: number; activation: number }>;
    importance_breakdown: Array<{ planet: Planet; activation: number; S_eff: number; importance: number }>;
    calibration_deltas?: Array<{ planet: Planet; dS: number; dH: number }>;
  };
}

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS_7 as readonly string[]).includes(value);
}

function round(x: number, decimals: number): number {
  const k = Math.pow(10, decimals);
  return Math.round(x * k) / k;
}

function rankedPlanets(forecast: ForecastLike): Planet[] {
  const rawRanked = forecast.ranked_planets ?? forecast.rankedPlanets;
  if (Array.isArray(rawRanked)) {
    const planets = rawRanked
      .map((entry) => (isPlanet(entry) ? entry : isPlanet((entry as { planet?: unknown })?.planet) ? (entry as { planet: Planet }).planet : null))
      .filter((planet): planet is Planet => Boolean(planet));
    if (planets.length) return planets;
  }

  const importance = forecast.importance ?? {};
  return [...PLANETS_7].sort((a, b) => (importance[b] ?? 0) - (importance[a] ?? 0));
}

function formulaSummaryFor(natalPlanet: NatalProfile["planets"][Planet]): string {
  const essential = natalPlanet.essentialDignity?.score;
  const accidental = natalPlanet.accidentalDignity?.score;
  if (typeof essential === "number" && typeof accidental === "number") {
    return `E=${essential.toFixed(2)} + Ac=${accidental.toFixed(2)} -> S=${natalPlanet.S_initial.toFixed(2)}`;
  }
  return `S=${natalPlanet.S_initial.toFixed(2)}`;
}

export function buildMathLevel(
  forecast: ForecastLike,
  natal: NatalProfile,
  calibration: CalibrationLike | null,
  locale: AppContentLocale = "ru",
): MathLevelData {
  const t = getMathLevelStrings(locale);
  const md: string[] = [];
  const structured: MathLevelData["structured"] = {
    natal_strengths: [],
    main_aspects: [],
    importance_breakdown: [],
  };

  md.push(t.title);
  md.push(t.intro);

  md.push(t.section1Title);
  md.push(t.formulaS);
  md.push(t.formulaH);

  for (const planet of PLANETS_7) {
    const natalPlanet = natal.planets[planet];
    const sCal = calibration?.s_calibrated?.[planet];
    const hCal = calibration?.h_calibrated?.[planet];
    const formulaSummary = formulaSummaryFor(natalPlanet);

    md.push(`\n**${planet}** ${t.chakraLabel(PLANET_TO_CHAKRA[planet].number)}:`);
    md.push(`- ${t.natalS}: ${natalPlanet.S_initial.toFixed(2)} (${formulaSummary})`);
    md.push(`- ${t.natalH}: ${natalPlanet.H_initial.toFixed(2)}`);
    if (sCal !== undefined && Math.abs(sCal - natalPlanet.S_initial) > 0.01) {
      const dS = sCal - natalPlanet.S_initial;
      md.push(`- ${t.calibratedS(sCal.toFixed(2), `${dS >= 0 ? "+" : ""}${dS.toFixed(2)}`)}`);
    }
    if (hCal !== undefined && Math.abs(hCal - natalPlanet.H_initial) > 0.01) {
      const dH = hCal - natalPlanet.H_initial;
      md.push(`- ${t.calibratedH(hCal.toFixed(2), `${dH >= 0 ? "+" : ""}${dH.toFixed(2)}`)}`);
    }

    structured.natal_strengths.push({
      planet,
      chakra: PLANET_TO_CHAKRA[planet].number,
      S: round(sCal ?? natalPlanet.S_initial, 2),
      H: round(hCal ?? natalPlanet.H_initial, 2),
      formula_summary: formulaSummary,
    });
  }

  md.push(t.section2Title);
  md.push(t.section2Intro);

  const transitChart = forecast.transit_chart ?? forecast.transitChart;
  if (transitChart) {
    const { contributions } = computeActivation({ natalProfile: natal, transitChart });
    const topContributions = contributions.sort((a, b) => b.value - a.value).slice(0, 12);
    for (const contribution of topContributions) {
      const aspectCoef = ASPECT_COEF[contribution.aspect.type] ?? 0.5;
      const transitWeight = TRANSIT_WEIGHT[contribution.transitPlanet] ?? 0.5;
      const activation = round(contribution.value, 3);

      md.push(t.transitLine(contribution.transitPlanet, contribution.aspect.type, contribution.natalPlanet));
      md.push(
        t.orbLine(contribution.aspect.orb.toFixed(2), String(aspectCoef), String(transitWeight)),
      );
      md.push(t.activationLine(activation.toFixed(3)));

      structured.main_aspects.push({
        from: contribution.transitPlanet,
        to: contribution.natalPlanet,
        type: contribution.aspect.type,
        orb: round(contribution.aspect.orb, 2),
        coef: round(aspectCoef * transitWeight, 3),
        activation,
      });
    }
  } else {
    md.push(t.noTransitChart);
  }

  md.push(t.section3Title);
  md.push(t.section3Formula);
  md.push(t.section3Intro);

  for (const planet of rankedPlanets(forecast)) {
    const sEff = calibration?.s_calibrated?.[planet] ?? natal.planets[planet].S_initial;
    const activation = forecast.activation?.[planet] ?? 0;
    const importance = forecast.importance?.[planet] ?? 0;
    md.push(t.importanceLine(planet, activation.toFixed(3), sEff.toFixed(2), importance.toFixed(3)));

    structured.importance_breakdown.push({
      planet,
      activation: round(activation, 3),
      S_eff: round(sEff, 2),
      importance: round(importance, 3),
    });
  }

  const planetOfTheDay = forecast.planet_of_the_day ?? forecast.planetOfTheDay ?? rankedPlanets(forecast)[0];
  md.push(`\n${t.section4Title}`);
  md.push(t.winnerLine(planetOfTheDay, (forecast.importance?.[planetOfTheDay] ?? 0).toFixed(3)));
  if (forecast.is_alternative_choice ?? forecast.isAlternativeChoice) {
    md.push(
      t.alternativeLine(
        forecast.alternative_reason_text ??
          forecast.alternativeReasonText ??
          (locale === "en" ? "diversity rule applied" : "сработало правило разнообразия тем"),
      ),
    );
  }

  if (calibration) {
    md.push(t.section5Title);
    md.push(
      t.calibrationIntro(
        String(calibration.version ?? "?"),
        String(calibration.source ?? "unknown"),
        calibration.source === "auto_aggregated"
          ? locale === "en"
            ? "50/50 (natal / voice feedback)"
            : "50/50 (натальное / голосовая обратная связь)"
          : locale === "en"
            ? "60/40 (natal / feedback)"
            : "60/40 (натальное / обратная связь)",
      ),
    );

    structured.calibration_deltas = [];
    const deltas = calibration.delta_from_initial ?? {};
    for (const planet of PLANETS_7) {
      const delta = deltas[planet];
      const dS = delta?.dS ?? ((calibration.s_calibrated?.[planet] ?? natal.planets[planet].S_initial) - natal.planets[planet].S_initial);
      const dH = delta?.dH ?? ((calibration.h_calibrated?.[planet] ?? natal.planets[planet].H_initial) - natal.planets[planet].H_initial);
      if (Math.abs(dS) > 0.01 || Math.abs(dH) > 0.01) {
        md.push(t.deltaLine(planet, `${dS >= 0 ? "+" : ""}${dS.toFixed(2)}`, `${dH >= 0 ? "+" : ""}${dH.toFixed(2)}`));
        structured.calibration_deltas.push({ planet, dS: round(dS, 2), dH: round(dH, 2) });
      }
    }
  }

  return {
    markdown: md.join("\n"),
    structured,
  };
}
