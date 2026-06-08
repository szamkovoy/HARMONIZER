import { DateTime } from "luxon";
import {
  hasEnoughLifeMatrixHistory,
} from "@legacy/app/api/_utils/lifeMatrix";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";
import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { loadLifeMatrixReadinessMeta, loadOrRebuildProfileReportSnapshot } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

export const runtime = "nodejs";

function projection(values: number[], labels: Array<{ id?: number; chakra?: number; title?: string; shortLabel?: string; label?: string; color?: string }>) {
  const max = Math.max(0, ...values);
  return values.map((value, index) => ({
    id: index + 1,
    label: labels[index]?.title ?? labels[index]?.shortLabel ?? labels[index]?.label ?? String(index + 1),
    color: labels[index]?.color ?? null,
    value,
    radius: max > 0 ? Math.sqrt(value / max) : 0,
  }));
}

function columnSums(matrix: number[][]): number[] {
  return Array.from({ length: 7 }, (_, col) =>
    matrix.reduce((sum, row) => sum + (Number(row?.[col]) || 0), 0),
  );
}

function rowSums(matrix: number[][]): number[] {
  return Array.from({ length: 7 }, (_, row) =>
    (matrix[row] ?? []).reduce((sum, value) => sum + (Number(value) || 0), 0),
  );
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const nowIso = new Date().toISOString();
    const [{ data: user, error: userError }, snapshot, readiness] = await Promise.all([
      db.from("users").select("tz").eq("id", userId).maybeSingle(),
      loadOrRebuildProfileReportSnapshot(db, userId, nowIso),
      loadLifeMatrixReadinessMeta(db, userId),
    ]);
    if (userError) throw userError;

    const zonedNow = DateTime.now().setZone(user?.tz ?? "UTC");
    const currentLocalDate = zonedNow.isValid ? zonedNow.toFormat("yyyy-MM-dd") : DateTime.utc().toFormat("yyyy-MM-dd");
    const reportReady = hasEnoughLifeMatrixHistory({
      summarizedEventsCount: readiness.summarizedEventsCount,
      firstSummaryLocalDate: readiness.firstSummaryLocalDate,
      currentLocalDate,
    });

    const chakras = buildChakraLegend();
    const spheres = getLifeSpheresBaseline("ru").map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
    }));

    return json({
      activeDaysCount: readiness.activeDaysCount,
      summarizedEventsCount: readiness.summarizedEventsCount,
      firstSummaryLocalDate: readiness.firstSummaryLocalDate,
      matrixReady: reportReady,
      trendReady: reportReady && snapshot.calendarTrend.length > 0,
      chakras,
      spheres,
      rawMatrix: snapshot.rawMatrix,
      visualMatrix: snapshot.visualMatrix,
      calendarTrend: snapshot.calendarTrend,
      sphereProjection: projection(columnSums(snapshot.rawMatrix), spheres.map((sphere, index) => ({
        ...sphere,
        color: chakras[index]?.color,
      }))),
      stateProjection: projection(rowSums(snapshot.rawMatrix), chakras),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
