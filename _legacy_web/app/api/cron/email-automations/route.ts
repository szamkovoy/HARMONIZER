import { automationCronIsIdle, cronSecretDenied } from "../../_utils/emailCronIdle";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Cron: enroll welcome drip + send due automation steps. */
export async function POST(req: Request) {
  const denied = cronSecretDenied(req);
  if (denied) return denied;

  try {
    const { createServiceSupabase } = await import("../../_utils/supabase");
    const db = createServiceSupabase();
    let idle = false;
    try {
      idle = await automationCronIsIdle(db);
    } catch (error) {
      console.error("[email-automations] idle check failed", error);
    }
    if (idle) {
      return Response.json({ ok: true, skipped: "idle" });
    }

    const { runEmailAutomations } = await import("../../_utils/emailAutomationRunner");
    const result = await runEmailAutomations(db);
    console.info("[email-automations]", result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const { errorResponse } = await import("../../_utils/supabase");
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
