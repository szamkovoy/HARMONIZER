import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
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
  const ru = params.strings.locale === "ru";

  if (isFree) {
    return buildFreeExplanation(params, planetLabel, ru);
  }

  return buildPaidExplanation(params, planetLabel, ru);
}

function buildFreeExplanation(
  params: OpportunityWindowsExplanationParams,
  planet: string,
  ru: boolean,
): string {
  const sunriseTime = formatTime(params.strings, params.windows.sunrise?.time);
  const culminationTime = formatTime(params.strings, params.windows.culmination?.time);

  const opening = ru
    ? `Сильнейшая планета дня — ${planet}. На графике показано, когда именно ${planet} поднимается над горизонтом и достигает зенита в вашем местоположении.`
    : `The strongest planet of the day is ${planet}. The graph shows when ${planet} rises and reaches its zenith at your location.`;

  const timingLines = [
    sunriseTime
      ? ru
        ? `Восход: ${sunriseTime} — ${planet} поднимается над горизонтом.`
        : `Rise: ${sunriseTime} — ${planet} rises above the horizon.`
      : null,
    culminationTime
      ? ru
        ? `Кульминация: ${culminationTime} — ${planet} в наивысшей точке суточного пути.`
        : `Culmination: ${culminationTime} — ${planet} at the highest point of its daily path.`
      : null,
  ].filter(Boolean);

  const closing = ru
    ? "Это ключевые моменты времени именно в вашей локации. Используйте их для духовных практик, аффирмаций, постановки намерения, медитации и т.п."
    : "These are key moments specifically for your location. Use them for spiritual practices, affirmations, setting intentions, meditation, etc.";

  return [opening, ...timingLines, closing].join("\n\n");
}

function buildPaidExplanation(
  params: OpportunityWindowsExplanationParams,
  natalPlanet: string,
  ru: boolean,
): string {
  const transitPlanetKey = transitPlanetForGraph(params);
  const transitPlanet = transitPlanetKey ? params.strings.planetLabels[transitPlanetKey] : null;
  const sunriseTime = formatTime(params.strings, params.windows.sunrise?.time);
  const culminationTime = formatTime(params.strings, params.windows.culmination?.time);
  const exactAspectTime = formatTime(params.strings, params.windows.exactAspect?.time);
  const exactAspectLbl = aspectLabel(params.strings, params.windows.exactAspect?.aspectType);
  const exactAspectNatal = params.windows.exactAspect
    ? params.strings.planetLabels[params.windows.exactAspect.toNatalPlanet]
    : null;

  const opening = ru
    ? [
        `Опорной натальной планетой сегодня является ${natalPlanet}.`,
        transitPlanet
          ? `На линии окна возможностей показано движение транзитной планеты ${transitPlanet}. Именно ${transitPlanet} сегодня включает ${natalPlanet} и даёт основной импульс сюжету дня.`
          : "Сегодня график показывает общее окно возможностей без отдельной явно выраженной транзитной планеты.",
      ]
    : [
        `The natal anchor planet for today is ${natalPlanet}.`,
        transitPlanet
          ? `The opportunity window curve tracks the transit planet ${transitPlanet}, which carries the main impulse of today's pattern.`
          : "Today the graph shows a general opportunity window without a single clearly highlighted transit planet.",
      ];

  const timingLines = [
    sunriseTime
      ? ru
        ? `Восход: ${sunriseTime}${transitPlanet ? ` — ${transitPlanet} поднимается над горизонтом.` : "."}`
        : `Rise: ${sunriseTime}${transitPlanet ? ` — ${transitPlanet} rises above the horizon.` : "."}`
      : null,
    culminationTime
      ? ru
        ? `Кульминация: ${culminationTime}${transitPlanet ? ` — ${transitPlanet} в наивысшей точке суточного пути.` : "."}`
        : `Culmination: ${culminationTime}${transitPlanet ? ` — ${transitPlanet} at the highest point of its daily path.` : "."}`
      : null,
    exactAspectTime && exactAspectLbl && transitPlanet && exactAspectNatal
      ? ru
        ? `Точный аспект: ${exactAspectTime} — ${exactAspectLbl} ${transitPlanet} к ${exactAspectNatal}.`
        : `Exact aspect: ${exactAspectTime} — ${exactAspectLbl} of ${transitPlanet} to ${exactAspectNatal}.`
      : null,
  ].filter(Boolean);

  const closing = ru
    ? "Это ключевые моменты времени именно в вашей локации. Используйте их для духовных практик, аффирмаций, постановки намерения, медитации и т.п."
    : "These are key moments specifically for your location. Use them for spiritual practices, affirmations, setting intentions, meditation, etc.";

  return [...opening, ...timingLines, closing].join("\n\n");
}
