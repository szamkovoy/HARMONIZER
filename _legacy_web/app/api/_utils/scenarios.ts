import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "./supabase";

export type ScenarioType = "monologue" | "dialogue";
export type CacheStrategy = "per_user_per_day" | "per_user_per_calibration" | "no_cache";

export type Scenario = {
  id: string;
  scenario_type: ScenarioType;
  display_name: Record<string, string>;
  description: string | null;
  monologue_prompt_key: string | null;
  dialogue_use_case: string | null;
  output_schema: Record<string, unknown> | null;
  cache_strategy: CacheStrategy;
  is_active: boolean;
  display_order: number | null;
};

const scenarioCache = new Map<string, { scenario: Scenario; expiresAt: number }>();
const SCENARIO_CACHE_TTL_MS = 60_000;

function cacheKey(scenarioId: string): string {
  return scenarioId.trim();
}

export function clearScenarioMemoryCache(): void {
  scenarioCache.clear();
}

export async function getScenario(
  scenarioId: string,
  db: SupabaseClient = createServiceSupabase(),
): Promise<Scenario | null> {
  const key = cacheKey(scenarioId);
  if (!key) return null;

  const cached = scenarioCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.scenario;

  const { data, error } = await db
    .from("scenarios")
    .select("id,scenario_type,display_name,description,monologue_prompt_key,dialogue_use_case,output_schema,cache_strategy,is_active,display_order")
    .eq("id", key)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const scenario = data as Scenario;
  scenarioCache.set(key, {
    scenario,
    expiresAt: Date.now() + SCENARIO_CACHE_TTL_MS,
  });
  return scenario;
}

export async function listScenarios(
  type?: ScenarioType,
  db: SupabaseClient = createServiceSupabase(),
): Promise<Scenario[]> {
  let query = db
    .from("scenarios")
    .select("id,scenario_type,display_name,description,monologue_prompt_key,dialogue_use_case,output_schema,cache_strategy,is_active,display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (type) query = query.eq("scenario_type", type);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Scenario[];
}
