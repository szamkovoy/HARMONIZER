/**
 * Fallback coords when profile/GPS are unavailable.
 * Matches natal-bridge Moscow default used by Profile locale ensure.
 */
export const DEFAULT_DAY_CONTENT_LOCATION = {
  lat: 55.7558,
  lng: 37.6173,
  timezone: "Europe/Moscow",
} as const;

export function dayContentLocationFallback(timezone?: string | null): {
  lat: number;
  lng: number;
  timezone: string;
} {
  const tz = timezone?.trim();
  return {
    lat: DEFAULT_DAY_CONTENT_LOCATION.lat,
    lng: DEFAULT_DAY_CONTENT_LOCATION.lng,
    timezone: tz && tz !== "UTC" ? tz : DEFAULT_DAY_CONTENT_LOCATION.timezone,
  };
}
