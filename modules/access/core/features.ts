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

/**
 * Матрица уровней (модель «Навигатор / Наставник / Мастер»):
 *   free («Навигатор»)   — универсальный прогноз + профиль;
 *   oracle («Наставник») — + персональный прогноз, калибровка, ИИ-ассистент,
 *                          планирование дня, статистика;
 *   practitioner         — скрытый legacy-уровень, эквивалент «Наставника»;
 *   master («Мастер»)    — + весь каталог практик (асаны, дыхание, медитации)
 *                          и вебинары.
 */
const ORACLE_FEATURES: readonly FeatureKey[] = [
  "global_daily_forecast",
  "personal_daily_forecast",
  "calibration",
  "assistant_dialog",
  "day_planning",
  "profile",
  "stats",
];

export const TIER_FEATURES: Record<ProductTier, readonly FeatureKey[]> = {
  free: ["global_daily_forecast", "profile"],
  oracle: ORACLE_FEATURES,
  practitioner: ORACLE_FEATURES,
  master: [
    ...ORACLE_FEATURES,
    "practice_catalog",
    "breath_practices",
    "meditations",
    "asana_practices",
    "webinar_community",
  ],
};

export const FEATURE_REQUIRED_TIER: Record<FeatureKey, ProductTier> = {
  global_daily_forecast: "free",
  personal_daily_forecast: "oracle",
  calibration: "oracle",
  assistant_dialog: "oracle",
  day_planning: "oracle",
  practice_catalog: "master",
  breath_practices: "master",
  meditations: "master",
  asana_practices: "master",
  webinar_community: "master",
  profile: "free",
  stats: "oracle",
};
