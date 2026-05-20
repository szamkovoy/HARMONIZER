export type PeriodPresetId = "7d" | "30d" | "90d";

export type PeriodPreset = {
  id: PeriodPresetId;
  label: string;
  days: number;
};

export const PERIOD_PRESETS = [
  { id: "7d", label: "7д", days: 7 },
  { id: "30d", label: "30д", days: 30 },
  { id: "90d", label: "90д", days: 90 },
  // { id: "180d", label: "180д", days: 180 },
  // { id: "1y", label: "1г", days: 365 },
  // { id: "all", label: "всё", days: null },
] as const satisfies readonly PeriodPreset[];

export const DEFAULT_PERIOD_DAYS = PERIOD_PRESETS[0].days;
