import { enrollWelcomeForUser } from "../../_utils/emailAutomationRunner";
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

/** Triggered when users.onboarded_at is first set. Enroll + send due welcome step. */
export async function POST(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;
  try {
    const body = (await req.json().catch(() => ({}))) as { user_id?: unknown };
    const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
    if (!userId) return json({ error: "user_id is required" }, { status: 400 });
    const result = await enrollWelcomeForUser(createServiceSupabase(), userId);
    console.info("[email-welcome]", { userId, ...result });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
