import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { loadAdminPaymentLedger } from "../_utils/paymentLedger";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Общий список: гранты + Lava/YuKassa (gross в исходной валюте). Свежие сверху. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    // Default 50 — Auth email backfill is expensive; page can request more.
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const db = createServiceSupabase();
    const payments = await loadAdminPaymentLedger(db, { limit });
    return json({ payments });
  } catch (error) {
    return errorResponse(error);
  }
}
