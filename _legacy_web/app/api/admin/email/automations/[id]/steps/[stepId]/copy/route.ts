import { emailCopyName } from "../../../../../../../_utils/emailNaming";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

/** Duplicate step at the end of the same automation chain. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId, stepId } = await ctx.params;
    const db = createServiceSupabase();

    const { data: source, error } = await db
      .from("email_automation_steps")
      .select(
        "name, delay_hours, subject, html_body, subject_i18n, html_body_i18n, blocks_i18n",
      )
      .eq("id", stepId)
      .eq("automation_id", automationId)
      .maybeSingle();
    if (error) throw error;
    if (!source) return json({ error: "Письмо не найдено" }, { status: 404 });

    const { data: last } = await db
      .from("email_automation_steps")
      .select("position")
      .eq("automation_id", automationId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const position = (last?.position ?? 0) + 1;

    const { data, error: insertError } = await db
      .from("email_automation_steps")
      .insert({
        automation_id: automationId,
        position,
        name: emailCopyName(source.name, source.subject, "Письмо"),
        delay_hours: source.delay_hours ?? 0,
        subject: source.subject ?? "",
        html_body: source.html_body ?? "",
        subject_i18n: source.subject_i18n ?? {},
        html_body_i18n: source.html_body_i18n ?? {},
        blocks_i18n: source.blocks_i18n ?? {},
      })
      .select("*")
      .single();
    if (insertError) throw insertError;
    return json({ step: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
