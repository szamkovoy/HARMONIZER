import { createServiceSupabase, errorResponse } from "../../_utils/supabase";
import { cabinetBearerUserId, corsJson, corsPreflight, withCors } from "../_utils";
import { buildAccountOverview } from "../overview-data";

// Обновление данных кабинета по действующей кабинетной сессии
// (например, после возврата с оплаты). CORS ограничен доменом сайта.
export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(req: Request) {
  try {
    const userId = cabinetBearerUserId(req);
    if (!userId) return corsJson({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const currency = url.searchParams.get("currency") ?? undefined;
    const overview = await buildAccountOverview(createServiceSupabase(), userId, { currency });
    return corsJson({ overview });
  } catch (error) {
    return withCors(errorResponse(error));
  }
}
