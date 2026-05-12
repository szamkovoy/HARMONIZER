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
  const natalPlanet = params.strings.planetLabels[params.planetOfTheDay];
  const transitPlanetKey = transitPlanetForGraph(params);
  const transitPlanet = transitPlanetKey ? params.strings.planetLabels[transitPlanetKey] : null;
  const sunriseTime = formatTime(params.strings, params.windows.sunrise?.time);
  const culminationTime = formatTime(params.strings, params.windows.culmination?.time);
  const exactAspectTime = formatTime(params.strings, params.windows.exactAspect?.time);
  const exactAspectLabel = aspectLabel(params.strings, params.windows.exactAspect?.aspectType);
  const exactAspectNatal = params.windows.exactAspect
    ? params.strings.planetLabels[params.windows.exactAspect.toNatalPlanet]
    : null;

  const opening = params.strings.locale === "ru"
    ? [
        `В этом графике опорной натальной планетой дня является ${natalPlanet}.`,
        transitPlanet
          ? `На линии окна возможностей показано движение транзитной планеты ${transitPlanet}: именно она даёт основной импульс сегодняшнему сюжету.`
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
      ? params.strings.locale === "ru"
        ? `Восход: ${sunriseTime}${transitPlanet ? ` — ${transitPlanet} поднимается над горизонтом.` : "."}`
        : `Rise: ${sunriseTime}${transitPlanet ? ` — ${transitPlanet} rises above the horizon.` : "."}`
      : null,
    culminationTime
      ? params.strings.locale === "ru"
        ? `Кульминация: ${culminationTime}${transitPlanet ? ` — ${transitPlanet} достигает максимальной силы.` : "."}`
        : `Culmination: ${culminationTime}${transitPlanet ? ` — ${transitPlanet} reaches peak strength.` : "."}`
      : null,
    exactAspectTime && exactAspectLabel && exactAspectNatal
      ? params.strings.locale === "ru"
        ? `Точный аспект: ${exactAspectTime} — ${exactAspectLabel} транзитной планеты к натальной планете ${exactAspectNatal}.`
        : `Exact aspect: ${exactAspectTime} — ${exactAspectLabel} from the transit planet to natal ${exactAspectNatal}.`
      : null,
  ].filter(Boolean);

  const closing = params.strings.locale === "ru"
    ? params.accessMode === "free"
      ? "Для бесплатного режима акцент сделан на универсальной теме дня; времена уже учтены по вашей текущей локации и часовому поясу."
      : "Эти времена уже пересчитаны под вашу текущую локацию и часовой пояс, поэтому они подходят для проверки графика и для практического планирования дня."
    : params.accessMode === "free"
      ? "For the free tier, the graph follows the shared theme of the day; all times are already adjusted to your current location and timezone."
      : "These times are already adjusted to your current location and timezone, so they can be used both to verify the graph and to plan the day in practice.";

  return [...opening, ...timingLines, closing].join("\n\n");
}
