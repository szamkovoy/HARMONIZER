import { ZODIAC_SIGNS, type BirthData, type NatalProfile } from "@/modules/astro-core";
import { getAstroNatalUrl } from "@/services/communicatorConfig";
import { requireSupabase } from "@/services/supabase";

export interface CreateNatalProfileResult {
  natalChart?: unknown;
  profile: NatalProfile;
}

type NatalChartRow = {
  precision_mode: NatalProfile["precisionMode"];
  is_day_chart: boolean;
  ascendant_longitude: number | null;
  house_system: NatalProfile["houseSystem"];
  planets: NatalProfile["planets"];
  computed_at: string;
  ephemeris_lib_version: string | null;
};

async function getAccessToken(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Нужна авторизация Supabase для сохранения натальной карты.");
  return token;
}

async function readError(res: Response): Promise<Error> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
  }

  const text = await res.text().catch(() => res.statusText);
  if (text.includes("DEPLOYMENT_NOT_FOUND")) {
    return new Error(
      `Vercel deployment is not available for EXPO_PUBLIC_COMMUNICATOR_API_URL (${res.status}).`,
    );
  }
  return new Error(text.slice(0, 280) || `HTTP ${res.status}`);
}

function networkError(url: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Natal profile network error for ${url}: ${message}`);
}

function houseCusps(row: NatalChartRow): number[] | undefined {
  if (row.precision_mode !== "precise" || row.ascendant_longitude == null) return undefined;
  const house1Cusp = Math.floor(row.ascendant_longitude / 30) * 30;
  return Array.from({ length: 12 }, (_, i) => (house1Cusp + i * 30) % 360);
}

function natalProfileFromRow(row: NatalChartRow): NatalProfile {
  const ascendantIndex =
    row.ascendant_longitude == null ? null : Math.floor((((row.ascendant_longitude % 360) + 360) % 360) / 30);
  return {
    precisionMode: row.precision_mode,
    isDayChart: row.is_day_chart,
    ascendant:
      row.ascendant_longitude == null || ascendantIndex == null
        ? undefined
        : {
            longitude: row.ascendant_longitude,
            sign: ZODIAC_SIGNS[ascendantIndex],
          },
    houseSystem: row.house_system,
    houseCusps: houseCusps(row),
    planets: row.planets,
    computedAt: row.computed_at,
    ephemerisLibVersion: row.ephemeris_lib_version ?? "unknown",
  };
}

export async function createNatalProfile(birthData: BirthData, signal?: AbortSignal): Promise<CreateNatalProfileResult> {
  const token = await getAccessToken();
  const url = getAstroNatalUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ birthData }),
      signal,
    });
  } catch (error) {
    throw networkError(url, error);
  }

  if (!res.ok) throw await readError(res);
  return (await res.json()) as CreateNatalProfileResult;
}

export async function fetchActiveNatalProfile(): Promise<NatalProfile | null> {
  const { data, error } = await requireSupabase()
    .from("user_natal_charts")
    .select("precision_mode,is_day_chart,ascendant_longitude,house_system,planets,computed_at,ephemeris_lib_version")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? natalProfileFromRow(data as unknown as NatalChartRow) : null;
}
