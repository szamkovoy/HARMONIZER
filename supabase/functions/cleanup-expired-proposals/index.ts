// @ts-nocheck
import { assertCronSecret, createServiceClient, daysAgo, isOptions, json } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    const now = new Date().toISOString();
    const oldCutoff = daysAgo(90);

    const { data: expired, error: expireError } = await db
      .from("ai_state_proposals")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", now)
      .select("id");
    if (expireError) throw expireError;

    const { data: deleted, error: deleteError } = await db
      .from("ai_state_proposals")
      .delete()
      .in("status", ["expired", "accepted", "rejected"])
      .lt("expires_at", oldCutoff)
      .select("id");
    if (deleteError) throw deleteError;

    return json({
      ok: true,
      expiredCount: expired?.length ?? 0,
      deletedCount: deleted?.length ?? 0,
    });
  } catch (error) {
    console.error("[cleanup-expired-proposals]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
