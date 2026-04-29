// @ts-nocheck
import { DateTime } from "https://esm.sh/luxon@3.7.2";
import julian from "https://esm.sh/astronomia@4.2.0/julian";
import solar from "https://esm.sh/astronomia@4.2.0/solar";
import moonposition from "https://esm.sh/astronomia@4.2.0/moonposition";
import planetposition from "https://esm.sh/astronomia@4.2.0/planetposition";
import elliptic from "https://esm.sh/astronomia@4.2.0/elliptic";
import nutation from "https://esm.sh/astronomia@4.2.0/nutation";
import coord from "https://esm.sh/astronomia@4.2.0/coord";
import sidereal from "https://esm.sh/astronomia@4.2.0/sidereal";
import vsop87Bearth from "https://esm.sh/astronomia@4.2.0/data/vsop87Bearth";
import vsop87Bmercury from "https://esm.sh/astronomia@4.2.0/data/vsop87Bmercury";
import vsop87Bvenus from "https://esm.sh/astronomia@4.2.0/data/vsop87Bvenus";
import vsop87Bmars from "https://esm.sh/astronomia@4.2.0/data/vsop87Bmars";
import vsop87Bjupiter from "https://esm.sh/astronomia@4.2.0/data/vsop87Bjupiter";
import vsop87Bsaturn from "https://esm.sh/astronomia@4.2.0/data/vsop87Bsaturn";

export const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const ASPECT_COEF = { conjunction: 1, opposition: 0.9, square: 0.8, trine: 0.7, sextile: 0.5 };
const TRANSIT_WEIGHT = { Saturn: 1, Jupiter: 0.9, Mars: 0.8, Sun: 0.7, Venus: 0.5, Mercury: 0.5, Moon: 0.3 };
const ASPECT_MAX_ORB = { conjunction: 6, opposition: 6, square: 5, trine: 5, sextile: 3 };
const ASPECT_EXACT_ANGLE = { conjunction: 0, opposition: 180, trine: 120, square: 90, sextile: 60 };

const earth = new planetposition.Planet(vsop87Bearth);
const planetData = {
  Mercury: new planetposition.Planet(vsop87Bmercury),
  Venus: new planetposition.Planet(vsop87Bvenus),
  Mars: new planetposition.Planet(vsop87Bmars),
  Jupiter: new planetposition.Planet(vsop87Bjupiter),
  Saturn: new planetposition.Planet(vsop87Bsaturn),
};

function normalizeLongitude(longitude: number): number {
  const normalized = longitude % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function signedDeltaDegrees(next: number, current: number): number {
  const delta = normalizeLongitude(next - current);
  return delta > 180 ? delta - 360 : delta;
}

function angularDistance(a: number, b: number): number {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta);
}

function toJulianDay(date: Date): number {
  return new julian.Calendar(date).toJD();
}

function toJde(date: Date): number {
  return new julian.Calendar(date).toJDE();
}

function equatorialForPlanetAt(planet: string, date: Date) {
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

function eclipticLongitudeForPlanetAt(planet: string, date: Date): number {
  const jde = toJde(date);

  if (planet === "Sun") return normalizeLongitude(solar.apparentLongitude(jde) * RAD_TO_DEG);
  if (planet === "Moon") return normalizeLongitude(moonposition.position(jde).lon * RAD_TO_DEG);

  const eq = equatorialForPlanetAt(planet, date);
  const epsilon = nutation.meanObliquity(jde) + nutation.nutation(jde)[1];
  return normalizeLongitude(new coord.Equatorial(eq.ra, eq.dec).toEcliptic(epsilon).lon * RAD_TO_DEG);
}

function positionForPlanetAt(planet: string, date: Date) {
  const longitude = eclipticLongitudeForPlanetAt(planet, date);
  const nextLongitude = eclipticLongitudeForPlanetAt(planet, new Date(date.getTime() + 24 * 60 * 60 * 1000));
  const speed = signedDeltaDegrees(nextLongitude, longitude);
  return {
    longitude,
    speed,
    isRetrograde: planet !== "Sun" && planet !== "Moon" && speed < 0,
  };
}

function localReferenceDate(forecastDate: string, timezone: string): Date {
  return DateTime.fromISO(`${forecastDate}T14:00`, { zone: timezone }).toUTC().toJSDate();
}

function localDayBounds(forecastDate: string, timezone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(forecastDate, { zone: timezone }).startOf("day");
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
}

function computeTransitChart(input: { forecastDate: string; timezone: string }) {
  const referenceDate = localReferenceDate(input.forecastDate, input.timezone);
  const planets = Object.fromEntries(PLANETS_7.map((planet) => [planet, positionForPlanetAt(planet, referenceDate)]));
  return {
    referenceTime: DateTime.fromJSDate(referenceDate, { zone: "utc" }).setZone(input.timezone).toISO(),
    planets,
  };
}

function orbToAspect(transitLongitude: number, natalLongitude: number, exactAngle: number): number {
  return Math.abs(angularDistance(transitLongitude, natalLongitude) - exactAngle);
}

function findAspect(params: { transitLongitude: number; transitSpeed: number; natalLongitude: number }) {
  for (const type of ["conjunction", "opposition", "trine", "square", "sextile"]) {
    const exactAngle = ASPECT_EXACT_ANGLE[type];
    const maxOrb = ASPECT_MAX_ORB[type];
    const orb = orbToAspect(params.transitLongitude, params.natalLongitude, exactAngle);
    if (orb <= maxOrb) {
      const nextOrb = orbToAspect(params.transitLongitude + params.transitSpeed / 24, params.natalLongitude, exactAngle);
      return { type, orb, maxOrb, isApplying: nextOrb < orb };
    }
  }
  return null;
}

function emptyPlanetMap() {
  return Object.fromEntries(PLANETS_7.map((planet) => [planet, 0]));
}

function effectiveNatalParams(natalProfile: any, calibration: any | null) {
  const S_eff = emptyPlanetMap();
  const H_eff = emptyPlanetMap();
  const sCal = calibration?.S_calibrated ?? calibration?.s_calibrated;
  const hCal = calibration?.H_calibrated ?? calibration?.h_calibrated;
  for (const planet of PLANETS_7) {
    S_eff[planet] = sCal?.[planet] ?? natalProfile.planets[planet].S_initial;
    H_eff[planet] = hCal?.[planet] ?? natalProfile.planets[planet].H_initial;
  }
  return { S_eff, H_eff };
}

function computeActivation(natalProfile: any, transitChart: any) {
  const activation = emptyPlanetMap();
  const contributions: any[] = [];

  for (const natalPlanet of PLANETS_7) {
    const natalState = natalProfile.planets[natalPlanet];
    for (const transitPlanet of PLANETS_7) {
      const transitState = transitChart.planets[transitPlanet];
      const aspect = findAspect({
        transitLongitude: transitState.longitude,
        transitSpeed: transitState.speed,
        natalLongitude: natalState.longitude,
      });
      if (!aspect) continue;

      const orbCloseness = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
      const applyingMul = aspect.isApplying ? 1.2 : 0.8;
      const sameBodyBonus = transitPlanet === natalPlanet ? (aspect.type === "conjunction" ? 1.5 : 1.3) : 1;
      let value = ASPECT_COEF[aspect.type] * orbCloseness * applyingMul * TRANSIT_WEIGHT[transitPlanet] * sameBodyBonus;

      if (natalProfile.precisionMode === "approximate" && (transitPlanet === "Moon" || natalPlanet === "Moon")) value *= 0.7;
      if (natalProfile.precisionMode === "unknown" && (transitPlanet === "Moon" || natalPlanet === "Moon")) value *= 0.5;

      activation[natalPlanet] += value;
      contributions.push({ natalPlanet, transitPlanet, aspect, value });
    }
  }

  return { activation, contributions };
}

function rankPlanets(importance: Record<string, number>) {
  return [...PLANETS_7].sort((a, b) => importance[b] - importance[a]);
}

function chooseFinalPlanet(rankedPlanets: string[], recentPlanetsOfDay: string[]) {
  const firstChoice = rankedPlanets[0];
  const [previousDay, dayBefore] = recentPlanetsOfDay;
  if (previousDay === firstChoice && dayBefore === firstChoice && rankedPlanets[1]) {
    return {
      planetOfTheDay: rankedPlanets[1],
      isAlternativeChoice: true,
      alternativeReasonText: "Сегодня предлагаем направить внимание на другую тему. Это разнообразит ваши усилия по гармонизации.",
    };
  }
  return { planetOfTheDay: firstChoice, isAlternativeChoice: false };
}

function altitudeAt(planet: string, date: Date, lat: number, lng: number): number {
  const eq = equatorialForPlanetAt(planet, date);
  const theta = (sidereal.apparent(toJulianDay(date)) / 240) * DEG_TO_RAD;
  const localSidereal = theta + lng * DEG_TO_RAD;
  const hourAngle = localSidereal - eq.ra;
  const phi = lat * DEG_TO_RAD;
  return Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(hourAngle));
}

function interpolateCrossing(a: { t: number; altitude: number }, b: { t: number; altitude: number }): Date {
  const ratio = Math.abs(a.altitude) / (Math.abs(a.altitude) + Math.abs(b.altitude));
  return new Date(a.t + (b.t - a.t) * ratio);
}

function computeRiseTime(input: any, planet: string): string | null {
  const { start, end } = localDayBounds(input.forecastDate, input.userLocation.timezone);
  let previous = { t: start.getTime(), altitude: altitudeAt(planet, start, input.userLocation.lat, input.userLocation.lng) };

  for (let t = previous.t + TEN_MINUTES_MS; t <= end.getTime(); t += TEN_MINUTES_MS) {
    const current = { t, altitude: altitudeAt(planet, new Date(t), input.userLocation.lat, input.userLocation.lng) };
    if (previous.altitude < 0 && current.altitude >= 0) {
      return DateTime.fromJSDate(interpolateCrossing(previous, current), { zone: "utc" }).setZone(input.userLocation.timezone).toISO();
    }
    previous = current;
  }

  return null;
}

function computeCulminationTime(input: any, planet: string): string | null {
  const { start, end } = localDayBounds(input.forecastDate, input.userLocation.timezone);
  let best: { t: number; altitude: number } | null = null;

  for (let t = start.getTime(); t <= end.getTime(); t += TEN_MINUTES_MS) {
    const altitude = altitudeAt(planet, new Date(t), input.userLocation.lat, input.userLocation.lng);
    if (!best || altitude > best.altitude) best = { t, altitude };
  }

  if (!best || best.altitude < 0) return null;
  return DateTime.fromMillis(best.t, { zone: "utc" }).setZone(input.userLocation.timezone).toISO();
}

function computeExactAspectTime(input: any, context: any): string | null {
  const { start, end } = localDayBounds(input.forecastDate, input.userLocation.timezone);
  const natalLongitude = input.natalProfile.planets[context.planetOfTheDay].longitude;
  const exactAngle = ASPECT_EXACT_ANGLE[context.mainAspect.type];
  let best = { t: start.getTime(), orb: Number.POSITIVE_INFINITY };

  for (let t = start.getTime(); t <= end.getTime(); t += TEN_MINUTES_MS) {
    const longitude = eclipticLongitudeForPlanetAt(context.mainTransitPlanet, new Date(t));
    const orb = Math.abs(angularDistance(longitude, natalLongitude) - exactAngle);
    if (orb < best.orb) best = { t, orb };
  }

  if (best.orb > 0.1) return null;
  return DateTime.fromMillis(best.t, { zone: "utc" }).setZone(input.userLocation.timezone).toISO();
}

function mainContributionFor(contributions: any[], planetOfTheDay: string) {
  return contributions.filter((item) => item.natalPlanet === planetOfTheDay).sort((a, b) => b.value - a.value)[0];
}

export function computeDailyForecast(input: {
  natalProfile: any;
  calibration: any | null;
  forecastDate: string;
  userLocation: { lat: number; lng: number; timezone: string };
  recentPlanetsOfDay: string[];
}) {
  const transitChart = computeTransitChart({
    forecastDate: input.forecastDate,
    timezone: input.userLocation.timezone,
  });
  const { S_eff, H_eff } = effectiveNatalParams(input.natalProfile, input.calibration);
  const { activation, contributions } = computeActivation(input.natalProfile, transitChart);
  const importance = emptyPlanetMap();
  for (const planet of PLANETS_7) importance[planet] = activation[planet] * (0.5 + 0.5 * S_eff[planet]);

  const rankedPlanets = rankPlanets(importance);
  const choice = chooseFinalPlanet(rankedPlanets, input.recentPlanetsOfDay);
  const mainContribution = mainContributionFor(contributions, choice.planetOfTheDay);
  const todayH = H_eff[choice.planetOfTheDay];
  const windowsOfOpportunity = mainContribution
    ? {
        sunrise: computeRiseTime(input, mainContribution.transitPlanet)
          ? { time: computeRiseTime(input, mainContribution.transitPlanet), planet: mainContribution.transitPlanet }
          : null,
        culmination: computeCulminationTime(input, mainContribution.transitPlanet)
          ? { time: computeCulminationTime(input, mainContribution.transitPlanet), planet: mainContribution.transitPlanet }
          : null,
        exactAspect: computeExactAspectTime(input, {
          mainTransitPlanet: mainContribution.transitPlanet,
          planetOfTheDay: choice.planetOfTheDay,
          mainAspect: mainContribution.aspect,
        })
          ? {
              time: computeExactAspectTime(input, {
                mainTransitPlanet: mainContribution.transitPlanet,
                planetOfTheDay: choice.planetOfTheDay,
                mainAspect: mainContribution.aspect,
              }),
              aspectType: mainContribution.aspect.type,
              toNatalPlanet: choice.planetOfTheDay,
            }
          : null,
      }
    : { sunrise: null, culmination: null, exactAspect: null };

  const endOfDay = DateTime.fromISO(input.forecastDate, { zone: input.userLocation.timezone }).endOf("day");
  return {
    date: input.forecastDate,
    importance,
    activation,
    rankedPlanets,
    ...choice,
    todayPlanetState: {
      naturalHarmoniousness: todayH,
      todayTone: todayH > 0.3 ? "harmonic" : todayH < -0.3 ? "dissonant" : "neutral",
    },
    windowsOfOpportunity,
    transitChart,
    computedAt: new Date().toISOString(),
    cacheValidUntil: endOfDay.toUTC().toISO(),
  };
}

export function dailyForecastToInsert(userId: string, userTimezone: string, forecast: any) {
  return {
    user_id: userId,
    forecast_date: forecast.date,
    user_timezone: userTimezone,
    importance: forecast.importance,
    activation: forecast.activation,
    ranked_planets: forecast.rankedPlanets,
    planet_of_the_day: forecast.planetOfTheDay,
    is_alternative_choice: forecast.isAlternativeChoice,
    alternative_reason_text: forecast.alternativeReasonText ?? null,
    today_planet_state: forecast.todayPlanetState,
    windows_of_opportunity: forecast.windowsOfOpportunity,
    transit_chart: forecast.transitChart,
    computed_at: forecast.computedAt,
    cache_valid_until: forecast.cacheValidUntil,
  };
}
