import { computeActivation, computeImportance, effectiveNatalParams } from "./core/activation";
import { chooseFinalPlanet, rankPlanets } from "./core/chooseFinalPlanet";
import type {
  ActivationContribution,
  DailyEngineInput,
  DailyForecast,
  Planet,
  TodayTone,
  TransitChart,
  WindowComputationContext,
} from "./core/types";

export interface TransitProvider {
  computeTransitChart(input: DailyEngineInput): Promise<TransitChart> | TransitChart;
  computeWindowsOfOpportunity?: (
    input: DailyEngineInput,
    context: WindowComputationContext,
  ) => Promise<DailyForecast["windowsOfOpportunity"]> | DailyForecast["windowsOfOpportunity"];
}

function todayToneFor(harmoniousness: number): TodayTone {
  if (harmoniousness > 0.3) return "harmonic";
  if (harmoniousness < -0.3) return "dissonant";
  return "neutral";
}

function endOfForecastDateUtc(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

function mainContributionFor(
  contributions: ActivationContribution[],
  planetOfTheDay: Planet,
): ActivationContribution | undefined {
  return contributions
    .filter((contribution) => contribution.natalPlanet === planetOfTheDay)
    .sort((a, b) => b.value - a.value)[0];
}

export function computeDailyForecastFromTransits(params: {
  input: DailyEngineInput;
  transitChart: TransitChart;
  computedAt?: string;
  windowsOfOpportunity?: DailyForecast["windowsOfOpportunity"];
}): DailyForecast {
  const { input, transitChart } = params;
  const { S_eff, H_eff } = effectiveNatalParams(input.natalProfile, input.calibration);
  const { activation, contributions } = computeActivation({
    natalProfile: input.natalProfile,
    transitChart,
  });
  const importance = computeImportance(activation, S_eff);
  const rankedPlanets = rankPlanets(importance);
  const choice = chooseFinalPlanet({
    rankedPlanets,
    recentPlanetsOfDay: input.recentPlanetsOfDay,
  });
  const mainContribution = mainContributionFor(contributions, choice.planetOfTheDay);

  return {
    date: input.forecastDate,
    importance,
    activation,
    rankedPlanets,
    ...choice,
    todayPlanetState: {
      naturalHarmoniousness: H_eff[choice.planetOfTheDay],
      todayTone: todayToneFor(H_eff[choice.planetOfTheDay]),
    },
    windowsOfOpportunity: params.windowsOfOpportunity ?? {
      sunrise: mainContribution ? null : null,
      culmination: mainContribution ? null : null,
      exactAspect: null,
    },
    transitChart,
    computedAt: params.computedAt ?? new Date().toISOString(),
    cacheValidUntil: endOfForecastDateUtc(input.forecastDate),
  };
}

export async function computeDailyForecast(input: DailyEngineInput, transitProvider: TransitProvider): Promise<DailyForecast> {
  const transitChart = await transitProvider.computeTransitChart(input);
  const baseForecast = computeDailyForecastFromTransits({ input, transitChart });
  const { contributions } = computeActivation({
    natalProfile: input.natalProfile,
    transitChart,
  });
  const mainContribution = mainContributionFor(contributions, baseForecast.planetOfTheDay);

  if (!mainContribution || !transitProvider.computeWindowsOfOpportunity) {
    return baseForecast;
  }

  const windowsOfOpportunity = await transitProvider.computeWindowsOfOpportunity(input, {
    mainTransitPlanet: mainContribution.transitPlanet,
    planetOfTheDay: baseForecast.planetOfTheDay,
    mainAspect: mainContribution.aspect,
  });

  return {
    ...baseForecast,
    windowsOfOpportunity,
  };
}
