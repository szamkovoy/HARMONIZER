// @ts-nocheck
/**
 * ⚠️ ВНИМАНИЕ: дублирует логику `modules/daily-engine` (активация, S_eff/H_eff, importance).
 * Любое изменение формул здесь должно быть зеркально отражено в модуле.
 * Покрыто parity-тестом: `supabase/functions/_shared/daily-engine-parity.test.ts`.
 *
 * Backlog: вынести общий `daily-engine-core` (PATCH 4 Вариант 1) после стабилизации.
 */
import base from "https://esm.sh/astronomia@4.2.0/base";
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
export const GLOBAL_MATH_SCHEMA_VERSION = 2;

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export const ASPECT_COEF = { conjunction: 1, opposition: 0.9, square: 0.8, trine: 0.7, sextile: 0.5 };
export const TRANSIT_WEIGHT = { Saturn: 1, Jupiter: 0.9, Mars: 0.8, Sun: 0.7, Venus: 0.5, Mercury: 0.5, Moon: 0.3 };
const ASPECT_MAX_ORB = { conjunction: 6, opposition: 6, square: 5, trine: 5, sextile: 3 };
const ASPECT_EXACT_ANGLE = { conjunction: 0, opposition: 180, trine: 120, square: 90, sextile: 60 };
const ZODIAC_SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const PLANET_TO_CHAKRA = {
  Moon: { number: 1, label: "первая чакра" },
  Venus: { number: 2, label: "вторая чакра" },
  Mars: { number: 3, label: "третья чакра" },
  Jupiter: { number: 4, label: "четвёртая чакра" },
  Saturn: { number: 5, label: "пятая чакра" },
  Mercury: { number: 6, label: "шестая чакра" },
  Sun: { number: 7, label: "седьмая чакра" },
};

const earth = new planetposition.Planet(vsop87Bearth);
const planetData = {
  Mercury: new planetposition.Planet(vsop87Bmercury),
  Venus: new planetposition.Planet(vsop87Bvenus),
  Mars: new planetposition.Planet(vsop87Bmars),
  Jupiter: new planetposition.Planet(vsop87Bjupiter),
  Saturn: new planetposition.Planet(vsop87Bsaturn),
};

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  return value ? Number(value) : 0;
}

function zonedParts(date: Date, timezone: string): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    numberPart(parts, "year"),
    numberPart(parts, "month") - 1,
    numberPart(parts, "day"),
    numberPart(parts, "hour"),
    numberPart(parts, "minute"),
    numberPart(parts, "second"),
  );
  return asUtc - date.getTime();
}

function zonedLocalDateTimeToUtc(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstPass = new Date(naiveUtc.getTime() - timezoneOffsetMs(naiveUtc, timezone));
  return new Date(naiveUtc.getTime() - timezoneOffsetMs(firstPass, timezone));
}

function addLocalDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function zonedIso(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  const offset = timezoneOffsetMs(date, timezone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(Math.trunc(offset / 60000));
  const offsetHours = String(Math.floor(abs / 60)).padStart(2, "0");
  const offsetMinutes = String(abs % 60).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return [
    `${String(numberPart(parts, "year")).padStart(4, "0")}-${String(numberPart(parts, "month")).padStart(2, "0")}-${String(numberPart(parts, "day")).padStart(2, "0")}`,
    `T${String(numberPart(parts, "hour")).padStart(2, "0")}:${String(numberPart(parts, "minute")).padStart(2, "0")}:${String(numberPart(parts, "second")).padStart(2, "0")}.${ms}`,
    `${sign}${offsetHours}:${offsetMinutes}`,
  ].join("");
}

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
    const lon = solar.apparentLongitude(base.J2000Century(jde));
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

  if (planet === "Sun") return normalizeLongitude(solar.apparentLongitude(base.J2000Century(jde)) * RAD_TO_DEG);
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

function signOf(longitude: number): string {
  return ZODIAC_SIGNS[Math.floor(normalizeLongitude(longitude) / 30)];
}

function signDegreeOf(longitude: number): number {
  return normalizeLongitude(longitude) % 30;
}

function orbToTransitAspect(a: number, b: number, exactAngle: number): number {
  return Math.abs(angularDistance(a, b) - exactAngle);
}

function findTransitAspect(fromLongitude: number, toLongitude: number) {
  for (const type of ["conjunction", "opposition", "trine", "square", "sextile"]) {
    const exactAngle = ASPECT_EXACT_ANGLE[type];
    const maxOrb = ASPECT_MAX_ORB[type];
    const orb = orbToTransitAspect(fromLongitude, toLongitude, exactAngle);
    if (orb <= maxOrb) return { type, orb, maxOrb };
  }
  return null;
}

function exactTransitAspectTime(params: { from: string; to: string; type: string; forecastDate: string }): string | null {
  const start = new Date(`${params.forecastDate}T00:00:00Z`).getTime();
  const end = new Date(`${params.forecastDate}T23:59:59.999Z`).getTime();
  const exactAngle = ASPECT_EXACT_ANGLE[params.type];
  let best = { t: start, orb: Number.POSITIVE_INFINITY };

  for (let t = start; t <= end; t += 60 * 60 * 1000) {
    const date = new Date(t);
    const orb = orbToTransitAspect(
      eclipticLongitudeForPlanetAt(params.from, date),
      eclipticLongitudeForPlanetAt(params.to, date),
      exactAngle,
    );
    if (orb < best.orb) best = { t, orb };
  }

  let lo = Math.max(start, best.t - 60 * 60 * 1000);
  let hi = Math.min(end, best.t + 60 * 60 * 1000);
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const o1 = orbToTransitAspect(
      eclipticLongitudeForPlanetAt(params.from, new Date(m1)),
      eclipticLongitudeForPlanetAt(params.to, new Date(m1)),
      exactAngle,
    );
    const o2 = orbToTransitAspect(
      eclipticLongitudeForPlanetAt(params.from, new Date(m2)),
      eclipticLongitudeForPlanetAt(params.to, new Date(m2)),
      exactAngle,
    );
    if (o1 < o2) hi = m2;
    else lo = m1;
  }

  const exact = (lo + hi) / 2;
  const finalOrb = orbToTransitAspect(
    eclipticLongitudeForPlanetAt(params.from, new Date(exact)),
    eclipticLongitudeForPlanetAt(params.to, new Date(exact)),
    exactAngle,
  );
  return finalOrb <= 0.15 ? new Date(exact).toISOString() : null;
}

export function computePlanetPositionsAt(date: Date) {
  return Object.fromEntries(
    PLANETS_7.map((planet) => {
      const position = positionForPlanetAt(planet, date);
      return [
        planet,
        {
          lon: position.longitude,
          longitude: position.longitude,
          sign: signOf(position.longitude),
          speed: position.speed,
          isRetrograde: position.isRetrograde,
        },
      ];
    }),
  );
}

export function computeAspectsBetweenPlanets(positions: Record<string, { longitude?: number; lon?: number }>, forecastDate?: string) {
  const aspects = [];
  for (let i = 0; i < PLANETS_7.length; i++) {
    for (let j = i + 1; j < PLANETS_7.length; j++) {
      const from = PLANETS_7[i];
      const to = PLANETS_7[j];
      const aspect = findTransitAspect(positions[from].longitude ?? positions[from].lon, positions[to].longitude ?? positions[to].lon);
      if (!aspect) continue;
      aspects.push({
        from,
        to,
        type: aspect.type,
        orb: aspect.orb,
        maxOrb: aspect.maxOrb,
        exact_at: forecastDate ? exactTransitAspectTime({ from, to, type: aspect.type, forecastDate }) : null,
      });
    }
  }
  return aspects;
}

function globalToneFor(planet: string, aspects: any[]): "harmonic" | "dissonant" | "ambivalent_strong" {
  const planetAspects = aspects.filter((aspect) => aspect.from === planet || aspect.to === planet);
  let harmonic = 0;
  let dissonant = 0;
  for (const aspect of planetAspects) {
    const coef = ASPECT_COEF[aspect.type] ?? 0;
    if (aspect.type === "trine" || aspect.type === "sextile") harmonic += coef;
    else if (aspect.type === "square" || aspect.type === "opposition") dissonant += coef;
    else harmonic += coef * 0.5;
  }
  if (harmonic + dissonant === 0) return "ambivalent_strong";
  const ratio = harmonic / (harmonic + dissonant);
  if (ratio > 0.65) return "harmonic";
  if (ratio < 0.35) return "dissonant";
  return "ambivalent_strong";
}

/** Numeric harmoniousness in [-1, +1] for a planet from its tight-orb transit aspects. */
function globalHarmoniousnessFor(planet: string, aspects: any[]): number {
  const planetAspects = aspects.filter((aspect) => aspect.from === planet || aspect.to === planet);
  let harmonic = 0;
  let dissonant = 0;
  for (const aspect of planetAspects) {
    const coef = ASPECT_COEF[aspect.type] ?? 0;
    if (aspect.type === "trine" || aspect.type === "sextile") harmonic += coef;
    else if (aspect.type === "square" || aspect.type === "opposition") dissonant += coef;
    else {
      harmonic += coef * 0.5;
      dissonant += coef * 0.5;
    }
  }
  const total = harmonic + dissonant;
  if (total === 0) return 0;
  return Math.max(-1, Math.min(1, (harmonic - dissonant) / total));
}

export function computeGlobalDailyForecast(forecastDate: string) {
  const positions = computePlanetPositionsAt(new Date(`${forecastDate}T12:00:00Z`));
  const aspects = computeAspectsBetweenPlanets(positions, forecastDate);
  const planetGravity = Object.fromEntries(PLANETS_7.map((planet) => [planet, 0]));

  for (const aspect of aspects) {
    const coef = ASPECT_COEF[aspect.type] ?? 0.5;
    const weightFrom = TRANSIT_WEIGHT[aspect.from] ?? 0.5;
    const weightTo = TRANSIT_WEIGHT[aspect.to] ?? 0.5;
    const orbFactor = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
    const value = coef * ((weightFrom + weightTo) / 2) * orbFactor;
    planetGravity[aspect.from] += value;
    planetGravity[aspect.to] += value;
  }

  const sorted = Object.entries(planetGravity).sort(([, a], [, b]) => b - a).slice(0, 3);
  const topPetals = sorted.map(([planet, gravity]) => ({
    planet,
    chakra_number: PLANET_TO_CHAKRA[planet].number,
    chakra_label: PLANET_TO_CHAKRA[planet].label,
    gravity: Math.round(gravity * 1000) / 1000,
    harmoniousness: Math.round(globalHarmoniousnessFor(planet, aspects) * 1000) / 1000,
    tone: globalToneFor(planet, aspects),
    main_aspects: aspects
      .filter((aspect) => aspect.from === planet || aspect.to === planet)
      .sort((a, b) => (ASPECT_COEF[b.type] ?? 0) - (ASPECT_COEF[a.type] ?? 0))
      .slice(0, 2),
  }));
  const planetScores = [...PLANETS_7]
    .map((planet) => ({
      planet,
      chakra_number: PLANET_TO_CHAKRA[planet].number,
      chakra_label: PLANET_TO_CHAKRA[planet].label,
      gravity: Math.round((planetGravity[planet] ?? 0) * 1000) / 1000,
      harmoniousness: Math.round(globalHarmoniousnessFor(planet, aspects) * 1000) / 1000,
      tone: globalToneFor(planet, aspects),
      sign: signOf(positions[planet].longitude ?? positions[planet].lon ?? 0),
      sign_degree: Math.round(signDegreeOf(positions[planet].longitude ?? positions[planet].lon ?? 0) * 10) / 10,
      is_retrograde: Boolean(positions[planet].isRetrograde),
      main_aspects: aspects
        .filter((aspect) => aspect.from === planet || aspect.to === planet)
        .sort((a, b) => (ASPECT_COEF[b.type] ?? 0) - (ASPECT_COEF[a.type] ?? 0))
        .slice(0, 3),
    }))
    .sort((a, b) => b.gravity - a.gravity);

  return {
    forecast_date: forecastDate,
    planet_positions: positions,
    aspects,
    primary_planet: topPetals[0].planet,
    primary_chakra_number: topPetals[0].chakra_number,
    primary_tone: topPetals[0].tone,
    top_petals: topPetals,
    planet_scores: planetScores,
  };
}

export function buildGlobalMathLevel(forecast: any) {
  const planetScores = Array.isArray(forecast.planet_scores) && forecast.planet_scores.length
    ? forecast.planet_scores
    : forecast.top_petals;
  const primaryPlanet = forecast.primary_planet ?? forecast.top_petals?.[0]?.planet ?? planetScores?.[0]?.planet ?? "Sun";
  const aspects = Array.isArray(forecast.aspects) ? forecast.aspects : [];
  const aspectContribution = (aspect: any) => {
    const coef = ASPECT_COEF[aspect.type] ?? 0.5;
    const weightFrom = TRANSIT_WEIGHT[aspect.from] ?? 0.5;
    const weightTo = TRANSIT_WEIGHT[aspect.to] ?? 0.5;
    const orbFactor = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
    return coef * ((weightFrom + weightTo) / 2) * orbFactor;
  };
  const harmoniousnessFor = (planet: string) =>
    typeof planetScores?.find((p: any) => p.planet === planet)?.harmoniousness === "number"
      ? planetScores.find((p: any) => p.planet === planet).harmoniousness.toFixed(3)
      : globalHarmoniousnessFor(planet, aspects).toFixed(3);
  const md = [
    "## Математика общего прогноза\n",
    "Общий прогноз строится без натальной карты: учитываются только транзитные положения семи планет на 12:00 UTC выбранного дня.",
    "Каждая планета получает оценку веса: суммируется вклад аспектов с поправкой на тип аспекта, точность орба и «вес» самой транзитной планеты.",
    "\n### Полный рейтинг планет на этот момент\n",
    ...planetScores.map(
      (planet: any, index: number) =>
        `${index + 1}. **${planet.planet}** — ${planet.sign ?? "Aries"} ${typeof planet.sign_degree === "number" ? planet.sign_degree.toFixed(1) : "0.0"}°, вес=${typeof planet.gravity === "number" ? planet.gravity.toFixed(3) : "0.000"}, гармония=${harmoniousnessFor(planet.planet)}`,
    ),
    "\n### Ключевые аспекты дня\n",
    ...aspects.map(
      (aspect: any) =>
        `- ${aspect.from} ${aspect.type} ${aspect.to}, орб=${aspect.orb.toFixed(2)}°, вес=${aspectContribution(aspect).toFixed(3)}`,
    ),
  ];
  const main_aspects = aspects.map((a: { from: string; to: string; type: string; orb: number }) => ({
    from: a.from,
    to: a.to,
    type: a.type,
    orb: a.orb,
  }));
  const primaryScore = planetScores?.find?.((planet: any) => planet.planet === primaryPlanet) ?? forecast.top_petals?.[0];
  return {
    markdown: md.join("\n"),
    structured: {
      schema_version: GLOBAL_MATH_SCHEMA_VERSION,
      chart_mode: "transit_only",
      primary_planet: primaryPlanet,
      primary_chakra_number: primaryScore?.chakra_number ?? forecast.primary_chakra_number ?? 0,
      primary_tone: primaryScore?.tone ?? forecast.primary_tone ?? "neutral",
      planet_positions: forecast.planet_positions,
      aspects: forecast.aspects,
      top_petals: forecast.top_petals,
      planet_scores: planetScores,
      main_aspects,
    },
  };
}

function localReferenceDate(forecastDate: string, timezone: string): Date {
  return zonedLocalDateTimeToUtc(forecastDate, "14:00:00", timezone);
}

function localDayBounds(forecastDate: string, timezone: string): { start: Date; end: Date } {
  return {
    start: zonedLocalDateTimeToUtc(forecastDate, "00:00:00", timezone),
    end: zonedLocalDateTimeToUtc(addLocalDays(forecastDate, 1), "00:00:00", timezone),
  };
}

function computeTransitChart(input: { forecastDate: string; timezone: string }) {
  const referenceDate = localReferenceDate(input.forecastDate, input.timezone);
  const planets = Object.fromEntries(PLANETS_7.map((planet) => [planet, positionForPlanetAt(planet, referenceDate)]));
  return {
    referenceTime: zonedIso(referenceDate, input.timezone),
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

export function effectiveNatalParams(natalProfile: any, calibration: any | null) {
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

export function computeActivation(natalProfile: any, transitChart: any) {
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

export function computeImportance(activation: Record<string, number>, S_eff: Record<string, number>) {
  const importance = emptyPlanetMap();
  for (const planet of PLANETS_7) importance[planet] = activation[planet] * (0.5 + 0.5 * S_eff[planet]);
  return importance;
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
      return zonedIso(interpolateCrossing(previous, current), input.userLocation.timezone);
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
  return zonedIso(new Date(best.t), input.userLocation.timezone);
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
  return zonedIso(new Date(best.t), input.userLocation.timezone);
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
  const importance = computeImportance(activation, S_eff);

  const rankedPlanets = rankPlanets(importance);
  const choice = chooseFinalPlanet(rankedPlanets, input.recentPlanetsOfDay);
  const mainContribution = mainContributionFor(contributions, choice.planetOfTheDay);
  const todayH = H_eff[choice.planetOfTheDay];
  let windowsOfOpportunity = { sunrise: null, culmination: null, exactAspect: null };
  if (mainContribution) {
    const sunriseTime = computeRiseTime(input, mainContribution.transitPlanet);
    const culminationTime = computeCulminationTime(input, mainContribution.transitPlanet);
    const exactAspectTime = computeExactAspectTime(input, {
      mainTransitPlanet: mainContribution.transitPlanet,
      planetOfTheDay: choice.planetOfTheDay,
      mainAspect: mainContribution.aspect,
    });
    windowsOfOpportunity = {
      sunrise: sunriseTime ? { time: sunriseTime, planet: mainContribution.transitPlanet } : null,
      culmination: culminationTime ? { time: culminationTime, planet: mainContribution.transitPlanet } : null,
      exactAspect: exactAspectTime
        ? {
            time: exactAspectTime,
            aspectType: mainContribution.aspect.type,
            toNatalPlanet: choice.planetOfTheDay,
            transitPlanet: mainContribution.transitPlanet,
          }
        : null,
    };
  }

  const { end } = localDayBounds(input.forecastDate, input.userLocation.timezone);
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
    cacheValidUntil: new Date(end.getTime() - 1).toISOString(),
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
