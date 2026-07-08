import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ key: string }> };

const VERSION_FIELDS =
  "id, prompt_key, prompt_type, use_case, version, is_active, template, variables, model_hint, temperature, max_output_tokens, response_format, notes, created_at";

/** Все версии одного prompt_key, свежие сверху. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { key } = await ctx.params;
    const { data, error } = await createServiceSupabase()
      .from("prompts")
      .select(VERSION_FIELDS)
      .eq("prompt_key", key)
      .order("version", { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) return json({ error: "Промпт не найден" }, { status: 404 });
    return json({ versions: data });
  } catch (error) {
    return errorResponse(error);
  }
}

type NewVersionPayload = {
  template?: string;
  notes?: string;
  model_hint?: string | null;
  temperature?: number | null;
  max_output_tokens?: number | null;
  activate?: boolean;
};

/**
 * Новая версия промпта: version = max + 1, prompt_type/use_case/variables/
 * response_format наследуются от последней версии. При activate=true остальные
 * версии ключа деактивируются.
 */
export async function POST(req: Request, ctx: RouteContext) {
  try {
    const adminId = await requireAdmin(req);
    const { key } = await ctx.params;
    const payload = (await req.json()) as NewVersionPayload;
    const template = payload.template?.trim() ?? "";
    if (!template) return json({ error: "Шаблон пуст" }, { status: 400 });

    const db = createServiceSupabase();
    const { data: latest, error: latestError } = await db
      .from("prompts")
      .select("prompt_type, use_case, version, variables, model_hint, temperature, max_output_tokens, response_format")
      .eq("prompt_key", key)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (!latest) return json({ error: "Промпт не найден" }, { status: 404 });

    const activate = payload.activate !== false;
    if (activate) {
      const { error: deactivateError } = await db
        .from("prompts")
        .update({ is_active: false })
        .eq("prompt_key", key)
        .eq("is_active", true);
      if (deactivateError) throw deactivateError;
    }

    const { data: created, error } = await db
      .from("prompts")
      .insert({
        prompt_key: key,
        prompt_type: latest.prompt_type,
        use_case: latest.use_case,
        version: latest.version + 1,
        is_active: activate,
        template,
        variables: latest.variables,
        model_hint: payload.model_hint === undefined ? latest.model_hint : payload.model_hint,
        temperature: payload.temperature === undefined ? latest.temperature : payload.temperature,
        max_output_tokens:
          payload.max_output_tokens === undefined ? latest.max_output_tokens : payload.max_output_tokens,
        response_format: latest.response_format,
        notes: payload.notes?.trim() || null,
        created_by: adminId,
      })
      .select("id, version, is_active")
      .single();
    if (error) throw error;

    return json({ version: created });
  } catch (error) {
    return errorResponse(error);
  }
}
