import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Toggle automation active flag (B1 runner respects is_active). */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = (await req.json()) as { is_active?: boolean };
    if (typeof body.is_active !== "boolean") {
      return json({ error: "is_active обязателен" }, { status: 400 });
    }
    const { data, error } = await createServiceSupabase()
      .from("email_automations")
      .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, key, name, trigger_type, is_active, updated_at")
      .single();
    if (error) throw error;
    return json({ automation: data });
  } catch (error) {
    return errorResponse(error);
  }
}
