import type { SupabaseClient } from "@supabase/supabase-js";

export function cronSecretDenied(req: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return Response.json({ error: "CRON_SECRET is required" }, { status: 500 });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  if (bearer === expected || header === expected) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/** True when there is no campaign send and no master-grant revert to do. */
export async function campaignCronIsIdle(db: SupabaseClient, now = new Date()): Promise<boolean> {
  const nowIso = now.toISOString();
  const [sending, dueWave, grants] = await Promise.all([
    db
      .from("email_campaigns")
      .select("id")
      .eq("status", "sending")
      .is("send_halted_at", null)
      .limit(1),
    db
      .from("email_campaigns")
      .select("id")
      .eq("status", "paused")
      .is("send_halted_at", null)
      .lte("next_wave_at", nowIso)
      .limit(1),
    db
      .from("email_campaign_access_grants")
      .select("campaign_id")
      .eq("kind", "master")
      .is("reverted_at", null)
      .lte("revert_at", nowIso)
      .limit(1),
  ]);
  if (sending.error) throw sending.error;
  if (dueWave.error) throw dueWave.error;
  if (grants.error) throw grants.error;
  return (sending.data?.length ?? 0) === 0
    && (dueWave.data?.length ?? 0) === 0
    && (grants.data?.length ?? 0) === 0;
}

/**
 * Quarter-hour ticks still run enrollers. Any other tick is idle unless a
 * step is already due — matching `invoke_run_email_automations`.
 */
export async function automationCronIsIdle(db: SupabaseClient, now = new Date()): Promise<boolean> {
  if (now.getUTCMinutes() % 15 === 0) return false;
  const { data, error } = await db
    .from("email_automation_enrollments")
    .select("id")
    .eq("status", "active")
    .lte("next_step_at", now.toISOString())
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) === 0;
}
