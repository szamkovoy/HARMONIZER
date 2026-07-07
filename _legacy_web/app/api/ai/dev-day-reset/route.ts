import { runDevDayContentReset, type DevDayContentResetScope } from "../../_utils/devDayContentReset";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";

export const runtime = "nodejs";

function parseScope(value: unknown): DevDayContentResetScope {
  if (value === "personal") return "personal";
  if (value === "both") return "both";
  return "global";
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as { resetScope?: unknown };
    const scope = parseScope(body.resetScope);
    const db = createServiceSupabase();
    const devReset = await runDevDayContentReset(db, userId, scope);
    return json({ ok: true, dev_reset: devReset });
  } catch (error) {
    return errorResponse(error);
  }
}
