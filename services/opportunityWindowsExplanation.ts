import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import { fillHomeTemplate, type HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";

interface OpportunityWindowsExplanationParams {
  accessMode: AccessMode;
  planetOfTheDay: Planet;
  windows: DailyForecast["windowsOfOpportunity"];
  strings: HomeStrings;
}

function formatTime(strings: HomeStrings, value?: string | null): string | null {
  if (!value) return null;
  return strings.formatTime(value);
}

function aspectLabel(strings: HomeStrings, aspectType?: AspectType | null): string | null {
  if (!aspectType) return null;
  return strings.opportunityWindows.aspectLabels[aspectType] ?? aspectType;
}

function transitPlanetForGraph(params: OpportunityWindowsExplanationParams): Planet | null {
  return (
    params.windows.sunrise?.planet ??
    params.windows.culmination?.planet ??
    params.windows.exactAspect?.transitPlanet ??
    null
  );
}

export async function loadOpportunityWindowsExplanation(
  params: OpportunityWindowsExplanationParams,
): Promise<string> {
  const planetLabel = params.strings.planetLabels[params.planetOfTheDay];
  const isFree = params.accessMode === "free";

  if (isFree) {
    return buildFreeExplanation(params, planetLabel);
  }

  return buildPaidExplanation(params, planetLabel);
}

function buildFreeExplanation(
  params: OpportunityWindowsExplanationParams,
  planet: string,
): string {
  const help = params.strings.opportunityWindows.help;
  const sunriseTime = formatTime(params.strings, params.windows.sunrise?.time);
  const culminationTime = formatTime(params.strings, params.windows.culmination?.time);

  const opening = fillHomeTemplate(help.freeOpening, { planet });

  const timingLines = [
    sunriseTime ? fillHomeTemplate(help.sunriseLine, { time: sunriseTime, planet }) : null,
    culminationTime
      ? fillHomeTemplate(help.culminationLine, { time: culminationTime, planet })
      : null,
  ].filter(Boolean) as string[];

  return [opening, ...timingLines, help.closing, help.remindersHint].filter(Boolean).join("\n\n");
}

function buildPaidExplanation(
  params: OpportunityWindowsExplanationParams,
  natalPlanet: string,
): string {
  const help = params.strings.opportunityWindows.help;
  const transitPlanetKey = transitPlanetForGraph(params);
  const transitPlanet = transitPlanetKey ? params.strings.planetLabels[transitPlanetKey] : null;
  const sunriseTime = formatTime(params.strings, params.windows.sunrise?.time);
  const culminationTime = formatTime(params.strings, params.windows.culmination?.time);
  const exactAspectTime = formatTime(params.strings, params.windows.exactAspect?.time);
  const exactAspectLbl = aspectLabel(params.strings, params.windows.exactAspect?.aspectType);
  const exactAspectTransit = params.windows.exactAspect
    ? params.strings.planetLabels[params.windows.exactAspect.transitPlanet]
    : null;
  const exactAspectNatal = params.windows.exactAspect
    ? params.strings.planetLabels[params.windows.exactAspect.toNatalPlanet]
    : null;

  const opening = transitPlanet
    ? fillHomeTemplate(help.paidOpening, { natalPlanet, transitPlanet })
    : help.paidOpeningNoTransit;

  const timingLines = [
    sunriseTime && transitPlanet
      ? fillHomeTemplate(help.sunriseLine, { time: sunriseTime, planet: transitPlanet })
      : sunriseTime
        ? `${params.strings.opportunityWindows.windowTitles.sunrise}: ${sunriseTime}.`
        : null,
    culminationTime && transitPlanet
      ? fillHomeTemplate(help.culminationLine, { time: culminationTime, planet: transitPlanet })
      : culminationTime
        ? `${params.strings.opportunityWindows.windowTitles.culmination}: ${culminationTime}.`
        : null,
    exactAspectTime && exactAspectLbl && exactAspectTransit && exactAspectNatal
      ? fillHomeTemplate(help.exactAspectLine, {
          time: exactAspectTime,
          aspect: exactAspectLbl,
          transitPlanet: exactAspectTransit,
          natalPlanet: exactAspectNatal,
        })
      : null,
  ].filter(Boolean) as string[];

  return [opening, ...timingLines, help.closing, help.remindersHint].filter(Boolean).join("\n\n");
}
