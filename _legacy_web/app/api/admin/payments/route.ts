import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { loadAdminPaymentLedger } from "../_utils/paymentLedger";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Общий список: гранты + Lava/YuKassa (gross в исходной валюте). Свежие сверху. ?limit=&offset= */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    // Default 50 — Auth email backfill is expensive; page can request more.
    const rawLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 50;
    const rawOffset = Number(url.searchParams.get("offset") ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
    const db = createServiceSupabase();
    const page = await loadAdminPaymentLedger(db, { limit, offset });
    return json(page);
  } catch (error) {
    return errorResponse(error);
  }
}
