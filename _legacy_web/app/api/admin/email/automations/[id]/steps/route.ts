import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

type CreateStepBody = {
  name?: string;
  delay_hours?: number;
  subject?: string;
  html_body?: string;
  subject_i18n?: Record<string, string>;
  html_body_i18n?: Record<string, string>;
  blocks_i18n?: unknown;
};

/** Add a step at the end of the chain. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId } = await ctx.params;
    const body = (await req.json()) as CreateStepBody;
    const db = createServiceSupabase();

    const { data: existing } = await db
      .from("email_automation_steps")
      .select("position")
      .eq("automation_id", automationId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (existing?.position ?? 0) + 1;

    const subject = body.subject?.trim() ?? "";
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : subject || "Новое письмо";

    const { data, error } = await db
      .from("email_automation_steps")
      .insert({
        automation_id: automationId,
        position,
        name,
        delay_hours:
          typeof body.delay_hours === "number" && body.delay_hours >= 0
            ? Math.floor(body.delay_hours)
            : 0,
        subject,
        html_body: body.html_body ?? "",
        subject_i18n: body.subject_i18n ?? {},
        html_body_i18n: body.html_body_i18n ?? {},
        blocks_i18n: body.blocks_i18n ?? {},
      })
      .select("*")
      .single();
    if (error) throw error;
    return json({ step: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

type ReorderBody = { ordered_ids?: string[] };

/** Reorder steps by full ordered id list (positions 1..n). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId } = await ctx.params;
    const body = (await req.json()) as ReorderBody;
    const ids = Array.isArray(body.ordered_ids) ? body.ordered_ids : [];
    if (!ids.length) return json({ error: "ordered_ids обязателен" }, { status: 400 });

    const db = createServiceSupabase();
    const now = new Date().toISOString();
    // Two-phase to avoid unique (automation_id, position) collisions.
    for (let i = 0; i < ids.length; i++) {
      const { error } = await db
        .from("email_automation_steps")
        .update({ position: -(i + 1), updated_at: now })
        .eq("id", ids[i])
        .eq("automation_id", automationId);
      if (error) throw error;
    }
    for (let i = 0; i < ids.length; i++) {
      const { error } = await db
        .from("email_automation_steps")
        .update({ position: i + 1, updated_at: now })
        .eq("id", ids[i])
        .eq("automation_id", automationId);
      if (error) throw error;
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
