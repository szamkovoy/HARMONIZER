import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

type PatchBody = {
  name?: string;
  delay_hours?: number;
  subject?: string;
  html_body?: string;
  subject_i18n?: Record<string, string>;
  html_body_i18n?: Record<string, string>;
  blocks_i18n?: unknown;
};

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId, stepId } = await ctx.params;
    const body = (await req.json()) as PatchBody;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.delay_hours === "number" && body.delay_hours >= 0) {
      patch.delay_hours = Math.floor(body.delay_hours);
    }
    if (typeof body.subject === "string") patch.subject = body.subject;
    if (typeof body.html_body === "string") patch.html_body = body.html_body;
    if (body.subject_i18n && typeof body.subject_i18n === "object") {
      patch.subject_i18n = body.subject_i18n;
    }
    if (body.html_body_i18n && typeof body.html_body_i18n === "object") {
      patch.html_body_i18n = body.html_body_i18n;
    }
    if (body.blocks_i18n !== undefined) patch.blocks_i18n = body.blocks_i18n;

    const { data, error } = await createServiceSupabase()
      .from("email_automation_steps")
      .update(patch)
      .eq("id", stepId)
      .eq("automation_id", automationId)
      .select("*")
      .single();
    if (error) throw error;
    return json({ step: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId, stepId } = await ctx.params;
    const db = createServiceSupabase();
    const { error } = await db
      .from("email_automation_steps")
      .delete()
      .eq("id", stepId)
      .eq("automation_id", automationId);
    if (error) throw error;

    // Re-pack positions 1..n
    const { data: left } = await db
      .from("email_automation_steps")
      .select("id")
      .eq("automation_id", automationId)
      .order("position", { ascending: true });
    const ids = (left ?? []).map((s) => s.id);
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i++) {
      await db
        .from("email_automation_steps")
        .update({ position: -(i + 1), updated_at: now })
        .eq("id", ids[i]);
    }
    for (let i = 0; i < ids.length; i++) {
      await db
        .from("email_automation_steps")
        .update({ position: i + 1, updated_at: now })
        .eq("id", ids[i]);
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
