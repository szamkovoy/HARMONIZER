import { DateTime } from "luxon";
import julian from "astronomia/julian";
import solar from "astronomia/solar";
import moonposition from "astronomia/moonposition";
import planetposition from "astronomia/planetposition";
import elliptic from "astronomia/elliptic";
import nutation from "astronomia/nutation";
import coord from "astronomia/coord";
import sidereal from "astronomia/sidereal";
import vsop87Bearth from "astronomia/data/vsop87Bearth";
import vsop87Bmercury from "astronomia/data/vsop87Bmercury";
import vsop87Bvenus from "astronomia/data/vsop87Bvenus";
import vsop87Bmars from "astronomia/data/vsop87Bmars";
import vsop87Bjupiter from "astronomia/data/vsop87Bjupiter";
import vsop87Bsaturn from "astronomia/data/vsop87Bsaturn";
import { computeNatalProfile, type EphemerisProvider } from "./computeNatalProfile";
import { PLANETS_7 } from "./core/constants";
import { normalizeLongitude } from "./core/math";
import type { BirthData, ChartPositions, NatalProfile, Planet, PlanetPosition } from "./core/types";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const EPHEMERIS_LIB_VERSION = "astronomia@4.2.0";

const earth = new planetposition.Planet(vsop87Bearth);
const planetData: Partial<Record<Planet, unknown>> = {
  Mercury: new planetposition.Planet(vsop87Bmercury),
  Venus: new planetposition.Planet(vsop87Bvenus),
  Mars: new planetposition.Planet(vsop87Bmars),
  Jupiter: new planetposition.Planet(vsop87Bjupiter),
  Saturn: new planetposition.Planet(vsop87Bsaturn),
};

export interface EquatorialPosition {
  ra: number;
  dec: number;
}

function toJulianDay(date: Date): number {
  return new julian.Calendar(date).toJD();
}

function toJde(date: Date): number {
  return new julian.Calendar(date).toJDE();
}

function normalizeRad(rad: number): number {
  const normalized = rad % (2 * Math.PI);
  return normalized < 0 ? normalized + 2 * Math.PI : normalized;
}

function signedDeltaDegrees(next: number, current: number): number {
  const delta = normalizeLongitude(next - current);
  return delta > 180 ? delta - 360 : delta;
}

function localChartDateTime(birthData: BirthData): DateTime {
  if (birthData.timeMode === "unknown") {
    return DateTime.fromISO(`${birthData.date}T12:00`, { zone: birthData.location.timezone });
  }

  return DateTime.fromISO(`${birthData.date}T${birthData.time}`, {
    zone: birthData.location.timezone,
  });
}

export function equatorialForPlanetAt(planet: Planet, date: Date): EquatorialPosition {
  const jde = toJde(date);

  if (planet === "Sun") {
    const lon = solar.apparentLongitude(jde);
    const epsilon = nutation.meanObliquity(jde) + nutation.nutation(jde)[1];
    const eq = new coord.Ecliptic(lon, 0).toEquatorial(epsilon);
    return { ra: eq.ra, dec: eq.dec };
  }

  if (planet === "Moon") {
    const moon = moonposition.position(jde);
    const epsilon = nutation.meanObliquity(jde) + nutation.nutation(jde)[1];
    const eq = new coord.Ecliptic(moon.lon, moon.lat).toEquatorial(epsilon);
    return { ra: eq.ra, dec: eq.dec };
  }

  const planetModel = planetData[planet];
  if (!planetModel) throw new Error(`Unsupported planet: ${planet}`);
  const eq = elliptic.position(planetModel, earth, jde);
  return { ra: eq.ra, dec: eq.dec };
}

export function eclipticLongitudeForPlanetAt(planet: Planet, date: Date): number {
  const jde = toJde(date);

  if (planet === "Sun") {
    return normalizeLongitude(solar.apparentLongitude(jde) * RAD_TO_DEG);
  }

  if (planet === "Moon") {
    return normalizeLongitude(moonposition.position(jde).lon * RAD_TO_DEG);
  }

  const eq = equatorialForPlanetAt(planet, date);
  const epsilon = nutation.meanObliquity(jde) + nutation.nutation(jde)[1];
  return normalizeLongitude(new coord.Equatorial(eq.ra, eq.dec).toEcliptic(epsilon).lon * RAD_TO_DEG);
}

export function positionForPlanetAt(planet: Planet, date: Date): PlanetPosition {
  const longitude = eclipticLongitudeForPlanetAt(planet, date);
  const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const nextLongitude = eclipticLongitudeForPlanetAt(planet, nextDate);
  const speed = signedDeltaDegrees(nextLongitude, longitude);

  return {
    longitude,
    speed,
    isRetrograde: planet !== "Sun" && planet !== "Moon" && speed < 0,
  };
}

function sunAltitude(date: Date, lat: number, lng: number): number {
  const jd = toJulianDay(date);
  const eq = equatorialForPlanetAt("Sun", date);
  const theta = (sidereal.apparent(jd) / 240) * DEG_TO_RAD;
  const localSidereal = theta + lng * DEG_TO_RAD;
  const hourAngle = localSidereal - eq.ra;
  const phi = lat * DEG_TO_RAD;
  return Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(hourAngle));
}

function ascendantLongitude(date: Date, lat: number, lng: number): number {
  const jd = toJulianDay(date);
  const epsilon = nutation.meanObliquity(jd) + nutation.nutation(jd)[1];
  const theta = (sidereal.apparent(jd) / 240) * DEG_TO_RAD + lng * DEG_TO_RAD;
  const phi = lat * DEG_TO_RAD;
  const raw = Math.atan2(
    -Math.cos(theta),
    Math.sin(theta) * Math.cos(epsilon) + Math.tan(phi) * Math.sin(epsilon),
  );
  return normalizeLongitude(normalizeRad(raw) * RAD_TO_DEG);
}

export class AstronomiaEphemerisProvider implements EphemerisProvider {
  computeNatalChart(birthData: BirthData): ChartPositions {
    const localDateTime = localChartDateTime(birthData);
    if (!localDateTime.isValid) {
      throw new Error(`Invalid birth date/time: ${localDateTime.invalidReason ?? "unknown"}`);
    }

    const date = localDateTime.toUTC().toJSDate();
    const planets = Object.fromEntries(
      PLANETS_7.map((planet) => [planet, positionForPlanetAt(planet, date)]),
    ) as Record<Planet, PlanetPosition>;

    return {
      planets,
      ascendantLongitude:
        birthData.timeMode === "unknown"
          ? undefined
          : ascendantLongitude(date, birthData.location.lat, birthData.location.lng),
      isDayChart: sunAltitude(date, birthData.location.lat, birthData.location.lng) > 0,
      ephemerisLibVersion: EPHEMERIS_LIB_VERSION,
      computedAt: new Date().toISOString(),
    };
  }
}

export async function computeNatalProfileWithAstronomia(birthData: BirthData): Promise<NatalProfile> {
  return computeNatalProfile(birthData, new AstronomiaEphemerisProvider());
}
