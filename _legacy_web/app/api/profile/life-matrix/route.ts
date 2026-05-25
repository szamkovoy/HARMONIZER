import {
  isMatrixReady,
} from "@legacy/app/api/_utils/lifeMatrix";
import { errorResponse, requireUserId, createServiceSupabase, json } from "@legacy/app/api/_utils/supabase";
import { buildChakraLegend } from "@legacy/app/api/_utils/planetChakraLegend";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { loadOrRebuildProfileReportSnapshot } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const snapshot = await loadOrRebuildProfileReportSnapshot(
      db,
      userId,
      new Date().toISOString(),
    );

    return json({
      activeDaysCount: snapshot.activeDaysCount,
      matrixReady: isMatrixReady(snapshot.activeDaysCount),
      chakras: buildChakraLegend(),
      spheres: getLifeSpheresBaseline("ru").map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
      })),
      rawMatrix: snapshot.rawMatrix,
      visualMatrix: snapshot.visualMatrix,
      calendarTrend: snapshot.calendarTrend,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
