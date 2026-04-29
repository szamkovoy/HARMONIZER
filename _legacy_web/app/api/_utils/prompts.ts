import type { SupabaseClient } from "@supabase/supabase-js";

export type PromptRecord = {
  prompt_key: string;
  prompt_type: string;
  use_case: string | null;
  version: number;
  template: string;
  variables: Record<string, unknown>;
  model_hint: string | null;
  max_output_tokens: number | null;
  temperature: number | null;
  response_format: "text" | "json_object" | null;
};

export async function getActivePrompt(db: SupabaseClient, promptKey: string): Promise<PromptRecord> {
  const { data, error } = await db
    .from("prompts")
    .select(
      "prompt_key,prompt_type,use_case,version,template,variables,model_hint,max_output_tokens,temperature,response_format",
    )
    .eq("prompt_key", promptKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Response(JSON.stringify({ error: `Active prompt not found: ${promptKey}` }), { status: 500 });
  }

  return data as PromptRecord;
}

export function renderPrompt(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  });
}
