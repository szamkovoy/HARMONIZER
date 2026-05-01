/**
 * Транзитная «математика дня» без натальной карты (PATCH 14).
 * Держите в синхроне с `supabase/functions/_shared/dailyForecast.ts` (computeGlobalDailyForecast / buildGlobalMathLevel).
 */
import julian from "astronomia/julian";
import solar from "astronomia/solar";
import moonposition from "astronomia/moonposition";
import planetposition from "astronomia/planetposition";
import elliptic from "astronomia/elliptic";
import nutation from "astronomia/nutation";
import coord from "astronomia/coord";
import vsop87Bearth from "astronomia/data/vsop87Bearth";
import vsop87Bmercury from "astronomia/data/vsop87Bmercury";
import vsop87Bvenus from "astronomia/data/vsop87Bvenus";
import vsop87Bmars from "astronomia/data/vsop87Bmars";
import vsop87Bjupiter from "astronomia/data/vsop87Bjupiter";
import vsop87Bsaturn from "astronomia/data/vsop87Bsaturn";

export const PLANETS_7 = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"] as const;

const RAD_TO_DEG = 180 / Math.PI;

const ASPECT_COEF = { conjunction: 1, opposition: 0.9, square: 0.8, trine: 0.7, sextile: 0.5 };
const TRANSIT_WEIGHT: Record<string, number> = {
  Saturn: 1,
  Jupiter: 0.9,
  Mars: 0.8,
  Sun: 0.7,
  Venus: 0.5,
  Mercury: 0.5,
  Moon: 0.3,
};
const ASPECT_MAX_ORB: Record<string, number> = { conjunction: 6, opposition: 6, square: 5, trine: 5, sextile: 3 };
const ASPECT_EXACT_ANGLE: Record<string, number> = { conjunction: 0, opposition: 180, trine: 120, square: 90, sextile: 60 };
const ZODIAC_SIGNS = [
  "Aries",
  "Taurus",
  "Gemini",
  "Cancer",
  "Leo",
  "Virgo",
  "Libra",
  "Scorpio",
  "Sagittarius",
  "Capricorn",
  "Aquarius",
  "Pisces",
];
const PLANET_TO_CHAKRA: Record<string, { number: number; label: string }> = {
  Moon: { number: 1, label: "муладхара" },
  Venus: { number: 2, label: "свадхистхана" },
  Mars: { number: 3, label: "манипура" },
  Jupiter: { number: 4, label: "анахата" },
  Saturn: { number: 5, label: "вишуддха" },
  Mercury: { number: 6, label: "аджна" },
  Sun: { number: 7, label: "сахасрара" },
};

const earth = new planetposition.Planet(vsop87Bearth);
const planetData: Record<string, InstanceType<typeof planetposition.Planet>> = {
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

function signOf(longitude: number): string {
  return ZODIAC_SIGNS[Math.floor(normalizeLongitude(longitude) / 30)] ?? "Aries";
}

function orbToTransitAspect(a: number, b: number, exactAngle: number): number {
  return Math.abs(angularDistance(a, b) - exactAngle);
}

function findTransitAspect(fromLongitude: number, toLongitude: number) {
  for (const type of ["conjunction", "opposition", "trine", "square", "sextile"] as const) {
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

export function computeAspectsBetweenPlanets(
  positions: Record<string, { longitude?: number; lon?: number }>,
  forecastDate?: string,
) {
  const aspects: Array<{
    from: string;
    to: string;
    type: string;
    orb: number;
    maxOrb: number;
    exact_at: string | null;
  }> = [];
  for (let i = 0; i < PLANETS_7.length; i++) {
    for (let j = i + 1; j < PLANETS_7.length; j++) {
      const from = PLANETS_7[i];
      const to = PLANETS_7[j];
      const aspect = findTransitAspect(
        positions[from].longitude ?? positions[from].lon ?? 0,
        positions[to].longitude ?? positions[to].lon ?? 0,
      );
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

function globalToneFor(planet: string, aspects: { from: string; to: string; type: string }[]): "harmonic" | "dissonant" | "ambivalent_strong" {
  const planetAspects = aspects.filter((aspect) => aspect.from === planet || aspect.to === planet);
  let harmonic = 0;
  let dissonant = 0;
  for (const aspect of planetAspects) {
    const coef = ASPECT_COEF[aspect.type as keyof typeof ASPECT_COEF] ?? 0;
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

export function computeGlobalDailyForecast(forecastDate: string) {
  const positions = computePlanetPositionsAt(new Date(`${forecastDate}T12:00:00Z`));
  const aspects = computeAspectsBetweenPlanets(positions, forecastDate);
  const planetGravity = Object.fromEntries(PLANETS_7.map((planet) => [planet, 0]));

  for (const aspect of aspects) {
    const coef = ASPECT_COEF[aspect.type as keyof typeof ASPECT_COEF] ?? 0.5;
    const weightFrom = TRANSIT_WEIGHT[aspect.from] ?? 0.5;
    const weightTo = TRANSIT_WEIGHT[aspect.to] ?? 0.5;
    const orbFactor = Math.max(0, 1 - aspect.orb / aspect.maxOrb);
    const value = coef * ((weightFrom + weightTo) / 2) * orbFactor;
    planetGravity[aspect.from] += value;
    planetGravity[aspect.to] += value;
  }

  const sorted = Object.entries(planetGravity)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);
  const topPetals = sorted.map(([planet, gravity]) => ({
    planet,
    chakra_number: PLANET_TO_CHAKRA[planet].number,
    chakra_label: PLANET_TO_CHAKRA[planet].label,
    gravity: Math.round(gravity * 1000) / 1000,
    tone: globalToneFor(planet, aspects),
    main_aspects: aspects
      .filter((aspect) => aspect.from === planet || aspect.to === planet)
      .sort((a, b) => (ASPECT_COEF[b.type as keyof typeof ASPECT_COEF] ?? 0) - (ASPECT_COEF[a.type as keyof typeof ASPECT_COEF] ?? 0))
      .slice(0, 2),
  }));

  return {
    forecast_date: forecastDate,
    planet_positions: positions,
    aspects,
    primary_planet: topPetals[0].planet,
    primary_chakra_number: topPetals[0].chakra_number,
    primary_tone: topPetals[0].tone,
    top_petals: topPetals,
  };
}

export function buildGlobalMathLevel(forecast: {
  top_petals: { planet: string; gravity: number; chakra_number: number; tone: string }[];
  aspects: { from: string; to: string; type: string; orb: number }[];
  planet_positions: Record<string, unknown>;
}) {
  const md = [
    "## Математика общего прогноза\n",
    "Общий прогноз строится без натальной карты: учитываются только транзитные положения семи планет на 12:00 UTC выбранного дня.",
    "\n### Топ-3 лепестка\n",
    ...forecast.top_petals.map((petal) => `- **${petal.planet}**: gravity=${petal.gravity}, чакра ${petal.chakra_number}, тон=${petal.tone}`),
    "\n### Активные аспекты дня\n",
    ...forecast.aspects.map((aspect) => `- ${aspect.from} ${aspect.type} ${aspect.to}, orb=${aspect.orb.toFixed(2)}°`),
  ];
  const main_aspects = forecast.aspects.map((a) => ({
    from: a.from,
    to: a.to,
    type: a.type,
    orb: a.orb,
  }));
  return {
    markdown: md.join("\n"),
    structured: {
      planet_positions: forecast.planet_positions,
      aspects: forecast.aspects,
      top_petals: forecast.top_petals,
      main_aspects,
    },
  };
}
