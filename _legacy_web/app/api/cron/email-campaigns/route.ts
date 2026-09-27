import { campaignCronIsIdle, cronSecretDenied } from "../../_utils/emailCronIdle";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Drain in-flight campaign waves and start a due scheduled wave. */
export async function POST(req: Request) {
  const denied = cronSecretDenied(req);
  if (denied) return denied;

  try {
    const { createServiceSupabase } = await import("../../_utils/supabase");
    const db = createServiceSupabase();
    let idle = false;
    try {
      idle = await campaignCronIsIdle(db);
    } catch (error) {
      console.error("[email-campaigns] idle check failed", error);
    }
    if (idle) {
      return Response.json({ ok: true, skipped: "idle" });
    }

    const { runDueCampaignSends } = await import("../../_utils/emailCampaignSend");
    const result = await runDueCampaignSends(db);
    console.info("[email-campaigns]", result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const { errorResponse } = await import("../../_utils/supabase");
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
