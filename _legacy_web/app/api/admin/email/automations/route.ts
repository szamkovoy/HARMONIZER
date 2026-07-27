import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** List automations + steps. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data: automations, error } = await db
      .from("email_automations")
      .select(
        "id, key, name, trigger_type, is_active, activated_at, trigger_config, created_at, updated_at",
      )
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
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type CreateBody = {
  name?: string;
  trigger_type?: string;
  key?: string;
};

const TRIGGERS = new Set([
  "manual",
  "account_registered",
  "subscription_expired",
  "inactive",
  "app_first_open",
  "onboarded",
]);

/** Create a new automation chain (manual by default). */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as CreateBody;
    const name = body.name?.trim() || "Новая цепочка";
    const trigger_type = TRIGGERS.has(body.trigger_type ?? "")
      ? (body.trigger_type as string)
      : "manual";
    const key =
      body.key?.trim() ||
      `chain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const { data, error } = await createServiceSupabase()
      .from("email_automations")
      .insert({
        key,
        name,
        trigger_type,
        is_active: false,
      })
      .select(
        "id, key, name, trigger_type, is_active, activated_at, created_at, updated_at",
      )
      .single();
    if (error) throw error;
    return json({ automation: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
