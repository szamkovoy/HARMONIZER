import type { SupabaseClient } from "@supabase/supabase-js";

import { effectiveDialogNowLocal } from "@legacy/app/api/_utils/testMode";
import { createServiceSupabase, errorResponse, json, requireUserId } from "@legacy/app/api/_utils/supabase";
import { reportRouteError } from "@legacy/app/api/_utils/monitoring";
import { loadDialogDailyContext } from "@legacy/app/api/communicator/v2/dialog/dialogDailyContext";
import { reconcilePendingPlanningCandidates } from "@legacy/app/api/communicator/v2/dialog/planningReconciliation";

export const runtime = "nodejs";

type ReconcilePlansBody = {
  conversationId?: string | null;
  force?: boolean;
};

type ConversationRow = {
  id: string;
  trigger_meta?: Record<string, unknown> | null;
};

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

    db = createServiceSupabase();
    const { data, error } = await db
      .from("conversations")
      .select("id,trigger_meta")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return json({ error: "Conversation not found" }, { status: 404 });
    }

    const context = await loadDialogDailyContext(db, userId);
    const result = await reconcilePendingPlanningCandidates({
      db,
      userId,
      conversation: data as ConversationRow,
      nowLocal: context.nowLocal,
      eventParseNowLocal: effectiveDialogNowLocal(context.nowLocal),
      eventParseRelativeNowLocal: context.nowLocal,
      timezone: context.user.tz ?? "UTC",
      locale: context.user.locale ?? "ru",
      dueEvents: context.dueEvents,
      planningHorizonLocalDates: [
        context.nowLocal.toFormat("yyyy-MM-dd"),
        context.nowLocal.plus({ days: 1 }).toFormat("yyyy-MM-dd"),
      ],
      force: body.force === true,
    });

    return json({
      applied: result.applied,
      planningPersistence: result.planningPersistence,
    });
  } catch (error) {
    await reportRouteError(error, {
      db,
      userId,
      endpoint: "communicator/v2/dialog/reconcile-plans",
      stage: "reconcile_pending_plans",
    });
    return errorResponse(error);
  }
}
