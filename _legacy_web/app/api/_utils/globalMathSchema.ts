/** Kept out of `globalTransitMath.ts` so cron freshness checks do not load ephemerides. */
export const GLOBAL_MATH_SCHEMA_VERSION = 2;

export function isGlobalMathLevelCurrent(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const structured = (value as { structured?: unknown }).structured;
  if (!structured || typeof structured !== "object") return false;
  const payload = structured as {
    schema_version?: unknown;
    chart_mode?: unknown;
    planet_positions?: unknown;
    main_aspects?: unknown;
    planet_scores?: unknown;
  };
  return (
    payload.schema_version === GLOBAL_MATH_SCHEMA_VERSION
    && payload.chart_mode === "transit_only"
    && Boolean(payload.planet_positions && typeof payload.planet_positions === "object")
    && Array.isArray(payload.main_aspects)
    && Array.isArray(payload.planet_scores)
  );
}
