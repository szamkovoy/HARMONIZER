import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type VersionUpdatePayload = {
  is_active?: boolean;
  notes?: string;
};

/**
 * Управление версией: активация (единственная активная на ключ) и правка notes.
 * Деактивировать активную версию можно только активацией другой — иначе ключ
 * останется без активного промпта и боевой код уйдёт в fallback.
 */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as VersionUpdatePayload;
    const db = createServiceSupabase();

    const { data: row, error: readError } = await db
      .from("prompts")
      .select("id, prompt_key, is_active")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!row) return json({ error: "Версия не найдена" }, { status: 404 });

    if (payload.is_active === false && row.is_active) {
      return json(
        { error: "Нельзя деактивировать активную версию: сначала активируйте другую" },
        { status: 400 },
      );
    }

    if (payload.is_active === true && !row.is_active) {
      const { error: deactivateError } = await db
        .from("prompts")
        .update({ is_active: false })
        .eq("prompt_key", row.prompt_key)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;
    }

    const update: Record<string, unknown> = {};
    if (payload.is_active === true) update.is_active = true;
    if (payload.notes !== undefined) update.notes = payload.notes.trim() || null;
    if (Object.keys(update).length === 0) {
      return json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const { data, error } = await db
      .from("prompts")
      .update(update)
      .eq("id", id)
      .select("id, version, is_active, notes")
      .single();
    if (error) throw error;

    return json({ version: data });
  } catch (error) {
    return errorResponse(error);
  }
}
