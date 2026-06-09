import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";

export const runtime = "nodejs";

type ReconcilePlansBody = {
  conversationId?: string | null;
  force?: boolean;
};

/**
 * Compatibility no-op.
 *
 * The daily-dialog "brain" is now an explicit FSM that persists planned events,
 * the day focus and summarized outcomes **synchronously** at the end of each
 * branch (see `dialogBrainPersistence.ts`). There is no longer any deferred
 * planning/summary reconciliation queue to drain, so this endpoint just
 * acknowledges the request. The client still debounce-calls it on close/unmount
 * (and tolerates a missing endpoint), so we keep the route to avoid 404 noise.
 */
export async function POST(req: Request) {
  let db: SupabaseClient | null = null;
  let userId: string | null = null;
  try {
    userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as ReconcilePlansBody;
    const conversationId = body.conversationId?.trim();
    if (!conversationId) {
      return json({ error: "conversationId is required" }, { status: 400 });
    }
    // Persistence already happened inline during the turn; nothing to reconcile.
    return json({ applied: false });
  } catch (error) {
    db = createServiceSupabase();
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/dialog/reconcile-plans",
      stage: "reconcile_pending_plans_noop",
    });
    return errorResponse(error);
  }
}
