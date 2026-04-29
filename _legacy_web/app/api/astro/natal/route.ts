import { computeNatalProfileWithAstronomia, type BirthData } from "../../../../../modules/astro-core";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { nextVersionFor } from "../../_utils/astro-db";

// Запись в user_natal_charts только через service_role (RLS: владелец — SELECT).
export const runtime = "nodejs";

type Body = {
  birthData: BirthData;
};

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    if (!body.birthData) {
      return json({ error: "birthData is required" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const profile = await computeNatalProfileWithAstronomia(body.birthData);
    const version = await nextVersionFor(db, "user_natal_charts", userId);

    const { error: deactivateError } = await db
      .from("user_natal_charts")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;

    const { data, error } = await db
      .from("user_natal_charts")
      .insert({
        user_id: userId,
        version,
        is_active: true,
        precision_mode: profile.precisionMode,
        is_day_chart: profile.isDayChart,
        ascendant_longitude: profile.ascendant?.longitude ?? null,
        house_system: profile.houseSystem,
        planets: profile.planets,
        ephemeris_lib_version: profile.ephemerisLibVersion,
        computed_at: profile.computedAt,
      })
      .select("*")
      .single();
    if (error) throw error;

    return json({ natalChart: data, profile });
  } catch (error) {
    return errorResponse(error);
  }
}
