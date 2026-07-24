import { runEmailAutomations } from "../../_utils/emailAutomationRunner";
import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

function assertCronSecret(req: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return json({ error: "CRON_SECRET is required" }, { status: 500 });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  if (bearer === expected || header === expected) return null;
  return json({ error: "Unauthorized" }, { status: 401 });
}

/** Cron: enroll welcome drip + send due automation steps. */
export async function POST(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;
  try {
    const result = await runEmailAutomations(createServiceSupabase());
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
