import { DateTime } from "luxon";

import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";

export const runtime = "nodejs";

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(7, Math.min(365, parsed));
}

export function practiceByChakraWindow(days: number, timezone: string, now = DateTime.utc()) {
  const zone = timezone?.trim() || "UTC";
  const zonedNow = now.setZone(zone);
  const endLocalExclusive = zonedNow.startOf("day").plus({ days: 1 });
  const startLocalInclusive = endLocalExclusive.minus({ days }).startOf("day");
  return {
    fromLocalDate: startLocalInclusive.toFormat("yyyy-MM-dd"),
    throughLocalDate: endLocalExclusive.minus({ days: 1 }).toFormat("yyyy-MM-dd"),
    startUtc: startLocalInclusive.toUTC().toISO() ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    endUtcExclusive: endLocalExclusive.toUTC().toISO() ?? new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const { data: user, error: userError } = await db.from("users").select("tz").eq("id", userId).maybeSingle();
    if (userError) throw userError;
    const timezone = typeof user?.tz === "string" && user.tz.trim() ? user.tz.trim() : "UTC";
    const window = practiceByChakraWindow(days, timezone);

    const { data, error } = await db
      .from("practice_sessions")
      .select("duration_sec,chakra_focus_ids,started_at,ended_at")
      .eq("user_id", userId)
      .not("ended_at", "is", null)
      .gte("started_at", window.startUtc)
      .lt("started_at", window.endUtcExclusive)
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
