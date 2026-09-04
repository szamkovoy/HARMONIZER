export type GpsCoords = { lat: number; lng: number; timezone: string };

/** Skip rewriting users.lat/lon/tz for ordinary GPS jitter (Android Balanced is often 20–50 m). */
export const GPS_PERSIST_MIN_MOVE_METERS = 500;

const EARTH_RADIUS_M = 6_371_000;

export function metersBetweenCoords(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function shouldPersistGpsUpdate(previous: GpsCoords | null, next: GpsCoords): boolean {
  if (!previous) return true;
  const prevTz = previous.timezone.trim();
  const nextTz = next.timezone.trim();
  if (prevTz && nextTz && prevTz !== nextTz) return true;
  return metersBetweenCoords(previous, next) >= GPS_PERSIST_MIN_MOVE_METERS;
}
