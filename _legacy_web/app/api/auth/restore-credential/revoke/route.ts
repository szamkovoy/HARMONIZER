/**
 * POST /api/auth/restore-credential/revoke
 * Authenticated — deletes server-side restore credential (on sign-out).
 */
import { revokeRestoreCredential } from "../../../_utils/webauthnRestore";
import { json, requireUser } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await revokeRestoreCredential(user.id);
    return json({ ok: true });
  } catch (e) {
    console.error("restore-credential/revoke", e);
    return json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
