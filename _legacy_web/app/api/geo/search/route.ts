import { errorResponse, json, requireUserId } from "../../_utils/supabase";

// Прокси к Open-Meteo Geocoding API: автодополнение города рождения.
// Бесплатно, без ключа, мультиязычно (все 8 локалей приложения),
// возвращает координаты и IANA-таймзону места.
export const runtime = "nodejs";

const OPEN_METEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const SUPPORTED_LANGS = new Set(["ru", "en", "de", "fr", "it", "es", "pt", "nl"]);
const MAX_RESULTS = 8;

type OpenMeteoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  admin1?: string;
};

export async function GET(req: Request) {
  try {
    await requireUserId(req);

    const url = new URL(req.url);
    const query = (url.searchParams.get("q") ?? "").trim();
    const langRaw = (url.searchParams.get("lang") ?? "en").toLowerCase().slice(0, 2);
    const lang = SUPPORTED_LANGS.has(langRaw) ? langRaw : "en";
    if (query.length < 2) {
      return json({ places: [] });
    }

    const upstream = new URL(OPEN_METEO_URL);
    upstream.searchParams.set("name", query);
    upstream.searchParams.set("count", String(MAX_RESULTS));
    upstream.searchParams.set("language", lang);
    upstream.searchParams.set("format", "json");

    const res = await fetch(upstream.toString(), {
      signal: AbortSignal.timeout(6_000),
      // Одинаковые запросы кэшируем на CDN-час: подсказки городов статичны.
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return json({ error: `Geocoding upstream HTTP ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { results?: OpenMeteoResult[] };

    const places = (data.results ?? [])
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.timezone)
      .map((r) => ({
        id: String(r.id),
        name: r.name,
        region: r.admin1 ?? null,
        country: r.country ?? null,
        lat: r.latitude,
        lng: r.longitude,
        timezone: r.timezone as string,
      }));

    return json({ places });
  } catch (error) {
    return errorResponse(error);
  }
}
