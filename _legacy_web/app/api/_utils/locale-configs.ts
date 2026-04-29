import type { UserSignal } from "./orchestrator";

export type SupportedLocale = "ru" | "en";

export type SignalMarker = {
  signal: UserSignal;
  patterns: RegExp[];
};

export type OrchestratorLocaleConfig = {
  locale: SupportedLocale;
  transitionMarkers: RegExp[];
  signalMarkers: SignalMarker[];
};

const sharedTransitionMarkers = [/[?!]/];

export const ORCHESTRATOR_LOCALE_CONFIGS: Record<SupportedLocale, OrchestratorLocaleConfig> = {
  ru: {
    locale: "ru",
    signalMarkers: [
      {
        signal: "deflecting",
        patterns: [/(не знаю|не уверен|не уверена|не понимаю)/i],
      },
      {
        signal: "self_reflective",
        patterns: [/(чувствую|думаю|замечаю|вижу|понимаю)/i],
      },
      {
        signal: "ready_for_action",
        patterns: [/(давай|хочу|готов|готова|пора|сделаем|попробуем)/i],
      },
    ],
    transitionMarkers: [
      /давай(те)?\s+(попроб|сделаем|начн[её]м)/i,
      /хочу\s+(попроб|сделать|выполнить)/i,
      /(сколько\s+времени|какая\s+практика|какую\s+практику)/i,
      /(вс[её]|хватит|закончим|давай\s+уже)/i,
      /(а\s+если|а\s+что|а\s+почему|расскажи)/i,
      /\b\d{1,3}\s*(мин|минут)\b/i,
      ...sharedTransitionMarkers,
    ],
  },
  en: {
    locale: "en",
    signalMarkers: [
      {
        signal: "deflecting",
        patterns: [/\b(i don't know|not sure|confused)\b/i],
      },
      {
        signal: "self_reflective",
        patterns: [/\b(i feel|i think|i notice|i see)\b/i],
      },
      {
        signal: "ready_for_action",
        patterns: [/\b(let'?s|i want|ready|try)\b/i],
      },
    ],
    transitionMarkers: [
      /\b(let'?s|start|try|practice|exercise|how long|which practice|finish|enough|tell me why|what if)\b/i,
      /\b\d{1,3}\s*(min|mins|minutes)\b/i,
      ...sharedTransitionMarkers,
    ],
  },
};

export function resolveOrchestratorLocale(locale?: string | null): SupportedLocale {
  const normalized = locale?.toLowerCase().split(/[-_]/)[0];
  return normalized === "en" ? "en" : "ru";
}

export function getOrchestratorLocaleConfig(locale?: string | null): OrchestratorLocaleConfig {
  return ORCHESTRATOR_LOCALE_CONFIGS[resolveOrchestratorLocale(locale)];
}
