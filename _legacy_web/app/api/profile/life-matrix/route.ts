import { getLifeMatrixLogSmoothingK, getRangeGroupSize } from "@legacy/app/api/_utils/dialogConfig";
import { groupRangeTrend, logSmoothedVisMatrix, sumMatrices, type DenseMatrix } from "@legacy/app/api/_utils/lifeMatrix";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";
import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";

export const runtime = "nodejs";

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(7, Math.min(365, parsed));
}

export async function GET(req: Request) {
  let db = null;
  let userId: string | null = null;
  try {
    userId = await requireUserId(req);
    db = createServiceSupabase();
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const fromDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data, error } = await db
      .from("daily_matrices")
      .select("local_date,matrix,range_metric,source,events_count")
      .eq("user_id", userId)
      .gte("local_date", fromDate)
      .order("local_date", { ascending: true });
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      local_date: string;
      matrix: DenseMatrix;
      range_metric: number | null;
      source: "summary" | "plan";
      events_count: number;
    }>;

    const rawMatrix = rows.length ? sumMatrices(rows.map((row) => row.matrix)) : Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 0));
    const visualMatrix = logSmoothedVisMatrix(rawMatrix, getLifeMatrixLogSmoothingK());

    return json({
      intervalDays: days,
      matrixReady: rows.length >= 5,
      daysCovered: rows.length,
      chakras: buildChakraLegend(),
      spheres: getLifeSpheresBaseline("ru").map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
      })),
      rawMatrix,
      visualMatrix,
      trend: rows.map((row) => ({
        localDate: row.local_date,
        rangeMetric: row.range_metric,
        source: row.source,
        eventsCount: row.events_count,
      })),
      groupedTrend: groupRangeTrend(rows.map((row) => row.range_metric), getRangeGroupSize()),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
