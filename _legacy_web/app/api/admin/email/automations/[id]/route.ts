import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const TRIGGERS = new Set([
  "manual",
  "account_registered",
  "subscription_expired",
  "inactive",
  "app_first_open",
  "onboarded",
]);

/** Load one automation + steps. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();
    const { data: automation, error } = await db
      .from("email_automations")
      .select(
        "id, key, name, trigger_type, is_active, activated_at, trigger_config, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!automation) return json({ error: "Цепочка не найдена" }, { status: 404 });

    const { data: steps, error: stepsError } = await db
      .from("email_automation_steps")
      .select(
        "id, position, delay_hours, subject, subject_i18n, html_body, html_body_i18n, blocks_i18n, sent_count, delivered_count, opened_count, clicked_count, bounced_count, complained_count, failed_count, created_at, updated_at",
      )
      .eq("automation_id", id)
      .order("position", { ascending: true });
    if (stepsError) throw stepsError;

    return json({ automation, steps: steps ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

type PatchBody = {
  name?: string;
  trigger_type?: string;
  is_active?: boolean;
  trigger_config?: Record<string, unknown>;
};

/** Update name / trigger / active (sets activated_at on first activate). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = (await req.json()) as PatchBody;
    const db = createServiceSupabase();

    const { data: current, error: loadError } = await db
      .from("email_automations")
      .select("id, is_active, activated_at")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!current) return json({ error: "Цепочка не найдена" }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") patch.name = body.name.trim() || "Цепочка";
    if (typeof body.trigger_type === "string" && TRIGGERS.has(body.trigger_type)) {
      patch.trigger_type = body.trigger_type;
    }
    if (body.trigger_config && typeof body.trigger_config === "object") {
      patch.trigger_config = body.trigger_config;
    }
    if (typeof body.is_active === "boolean") {
      patch.is_active = body.is_active;
      if (body.is_active && !current.is_active) {
        // Anti-backfill for welcome: enroll only confirms after this moment.
        patch.activated_at = new Date().toISOString();
      }
    }

    const { data, error } = await db
      .from("email_automations")
      .update(patch)
      .eq("id", id)
      .select(
        "id, key, name, trigger_type, is_active, activated_at, trigger_config, updated_at",
      )
      .single();
    if (error) throw error;
    return json({ automation: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const { error } = await createServiceSupabase()
      .from("email_automations")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
