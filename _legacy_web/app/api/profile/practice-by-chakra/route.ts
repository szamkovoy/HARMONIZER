import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";

export const runtime = "nodejs";

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(7, Math.min(365, parsed));
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await db
      .from("practice_sessions")
      .select("duration_sec,chakra_focus_ids,started_at,ended_at")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .gte("started_at", fromIso)
      .order("started_at", { ascending: false });
    if (error) throw error;

    const totals = new Map<number, number>();
    for (const item of (data ?? []) as Array<{ duration_sec: number | null; chakra_focus_ids: number[] | null }>) {
      const durationSec = Number(item.duration_sec ?? 0);
      const chakraIds = [...new Set((item.chakra_focus_ids ?? []).filter((value) => Number.isInteger(value) && value >= 1 && value <= 7))];
      if (!durationSec || chakraIds.length === 0) continue;
      const perChakra = durationSec / chakraIds.length;
      for (const chakra of chakraIds) {
        totals.set(chakra, (totals.get(chakra) ?? 0) + perChakra);
      }
    }

    const chakraStats = buildChakraLegend().map((chakra) => ({
      ...chakra,
      durationSec: Math.round(totals.get(chakra.chakra) ?? 0),
    }));
    const totalDurationSec = chakraStats.reduce((sum, item) => sum + item.durationSec, 0);

    return json({
      intervalDays: days,
      totalDurationSec,
      chakraStats,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
