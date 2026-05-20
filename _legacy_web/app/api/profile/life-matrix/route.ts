import { getLifeMatrixLogSmoothingK, getRangeGroupSize } from "@legacy/app/api/_utils/dialogConfig";
import {
  buildCalendarRangeTrend,
  isMatrixReady,
  logSmoothedVisMatrix,
  sumMatrices,
  uniqueSortedDates,
  type DenseMatrix,
} from "@legacy/app/api/_utils/lifeMatrix";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";
import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();

    const { data: activeDayRows, error: activeDaysError } = await db
      .from("planned_events")
      .select("planned_local_date")
      .eq("user_id", userId)
      .eq("status", "summarized");
    if (activeDaysError) throw activeDaysError;

    const activeDates = uniqueSortedDates(
      ((activeDayRows ?? []) as Array<{ planned_local_date: string }>).map((row) => row.planned_local_date),
    );

    let matrixRows: Array<{ local_date: string; matrix: DenseMatrix }> = [];
    if (activeDates.length > 0) {
      const { data, error } = await db
        .from("daily_matrices")
        .select("local_date,matrix")
        .eq("user_id", userId)
        .in("local_date", activeDates)
        .order("local_date", { ascending: true });
      if (error) throw error;
      matrixRows = (data ?? []) as Array<{ local_date: string; matrix: DenseMatrix }>;
    }

    const matrixByDate = new Map(matrixRows.map((row) => [row.local_date, row.matrix]));
    const aggregatedMatrices = matrixRows.map((row) => row.matrix);
    const rawMatrix = aggregatedMatrices.length
      ? sumMatrices(aggregatedMatrices)
      : Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => 0));
    const visualMatrix = logSmoothedVisMatrix(rawMatrix, getLifeMatrixLogSmoothingK());
    const calendarTrend = buildCalendarRangeTrend(activeDates, matrixByDate, getRangeGroupSize());

    return json({
      activeDaysCount: activeDates.length,
      matrixReady: isMatrixReady(activeDates.length),
      chakras: buildChakraLegend(),
      spheres: getLifeSpheresBaseline("ru").map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
      })),
      rawMatrix,
      visualMatrix,
      calendarTrend,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
