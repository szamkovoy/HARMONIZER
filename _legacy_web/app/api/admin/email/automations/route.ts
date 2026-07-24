import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** List automations + steps (B1 runner: welcome via cron). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data: automations, error } = await db
      .from("email_automations")
      .select("id, key, name, trigger_type, is_active, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const ids = (automations ?? []).map((a) => a.id);
    let steps: {
      id: string;
      automation_id: string;
      position: number;
      delay_hours: number;
      subject: string;
    }[] = [];
    if (ids.length) {
      const { data: stepRows, error: stepsError } = await db
        .from("email_automation_steps")
        .select("id, automation_id, position, delay_hours, subject")
        .in("automation_id", ids)
        .order("position", { ascending: true });
      if (stepsError) throw stepsError;
      steps = stepRows ?? [];
    }

    const byAuto = new Map<string, typeof steps>();
    for (const s of steps) {
      const list = byAuto.get(s.automation_id) ?? [];
      list.push(s);
      byAuto.set(s.automation_id, list);
    }

    return json({
      automations: (automations ?? []).map((a) => ({
        ...a,
        steps: byAuto.get(a.id) ?? [],
        runner: a.key === "welcome_after_install" ? "b1_cron" : "stub",
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
