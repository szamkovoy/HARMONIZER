import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserTimezone, todayLocalDate } from "../calibration/extract/forecast-cache-date";
import { createServiceSupabase } from "./supabase";
import type { Scenario } from "./scenarios";

async function buildCacheKey(
  db: SupabaseClient,
  scenario: Scenario,
  userId: string,
): Promise<string | null> {
  switch (scenario.cache_strategy) {
    case "per_user_per_day": {
      const userTz = await getUserTimezone(db, userId);
      return `${scenario.id}:${userId}:${todayLocalDate(userTz)}`;
    }
    case "per_user_per_calibration": {
      const { data, error } = await db
        .from("user_calibrations")
        .select("version")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return `${scenario.id}:${userId}:cal_v${data?.version ?? 0}`;
    }
    case "no_cache":
      return null;
  }
}

export async function checkScenarioCache<T>(
  scenario: Scenario,
  userId: string,
  db: SupabaseClient = createServiceSupabase(),
): Promise<T | null> {
  const cacheKey = await buildCacheKey(db, scenario, userId);
  if (!cacheKey) return null;

  const { data, error } = await db
    .from("scenario_cache")
    .select("data")
    .eq("cache_key", cacheKey)
    .maybeSingle();
  if (error) throw error;
  return (data?.data as T | undefined) ?? null;
}

export async function saveScenarioCache(
  scenario: Scenario,
  userId: string,
  data: unknown,
  db: SupabaseClient = createServiceSupabase(),
): Promise<void> {
  const cacheKey = await buildCacheKey(db, scenario, userId);
  if (!cacheKey) return;

  const { error } = await db.from("scenario_cache").upsert({
    cache_key: cacheKey,
    scenario_id: scenario.id,
    user_id: userId,
    data,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}
