import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Сводка по ключам промптов: активная версия, число версий, метаданные. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { data, error } = await createServiceSupabase()
      .from("prompts")
      .select("prompt_key, prompt_type, use_case, version, is_active, model_hint, created_at")
      .order("prompt_key", { ascending: true })
      .order("version", { ascending: false });
    if (error) throw error;

    const byKey = new Map<
      string,
      {
        prompt_key: string;
        prompt_type: string;
        use_case: string | null;
        versions: number;
        active_version: number | null;
        latest_version: number;
        model_hint: string | null;
        updated_at: string;
      }
    >();
    for (const row of data ?? []) {
      const existing = byKey.get(row.prompt_key);
      if (!existing) {
        byKey.set(row.prompt_key, {
          prompt_key: row.prompt_key,
          prompt_type: row.prompt_type,
          use_case: row.use_case,
          versions: 1,
          active_version: row.is_active ? row.version : null,
          latest_version: row.version,
          model_hint: row.model_hint,
          updated_at: row.created_at,
        });
        continue;
      }
      existing.versions += 1;
      if (row.is_active && existing.active_version === null) existing.active_version = row.version;
    }

    return json({ prompts: [...byKey.values()] });
  } catch (error) {
    return errorResponse(error);
  }
}
