import type { ProductTier } from "./tiers";

export type FeatureKey =
  | "global_daily_forecast"
  | "personal_daily_forecast"
  | "calibration"
  | "assistant_dialog"
  | "day_planning"
  | "practice_catalog"
  | "breath_practices"
  | "meditations"
  | "asana_practices"
  | "webinar_community"
  | "profile"
  | "stats";

export const TIER_FEATURES: Record<ProductTier, readonly FeatureKey[]> = {
  free: ["global_daily_forecast", "profile"],
  oracle: ["global_daily_forecast", "personal_daily_forecast", "calibration", "profile"],
  practitioner: [
    "global_daily_forecast",
    "personal_daily_forecast",
    "calibration",
    "assistant_dialog",
    "day_planning",
    "practice_catalog",
    "breath_practices",
    "meditations",
    "profile",
    "stats",
  ],
  master: [
    "global_daily_forecast",
    "personal_daily_forecast",
    "calibration",
    "assistant_dialog",
    "day_planning",
    "practice_catalog",
    "breath_practices",
    "meditations",
    "asana_practices",
    "webinar_community",
    "profile",
    "stats",
  ],
};

export const FEATURE_REQUIRED_TIER: Record<FeatureKey, ProductTier> = {
  global_daily_forecast: "free",
  personal_daily_forecast: "oracle",
  calibration: "oracle",
  assistant_dialog: "practitioner",
  day_planning: "practitioner",
  practice_catalog: "practitioner",
  breath_practices: "practitioner",
  meditations: "practitioner",
  asana_practices: "master",
  webinar_community: "master",
  profile: "free",
  stats: "practitioner",
};
