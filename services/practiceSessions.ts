import { getSupabase } from "@/services/supabase";
import type { Database, Json } from "@/services/supabase-types";
import { getResponseLocale } from "@/modules/i18n";
import { clearCachedDayPlan } from "@/services/dayPlanCache";
import { clearPrefetchedDayPlan, markDayPlanStale } from "@/services/dayPlanReloadRequest";

type PracticeSessionInsert = Database["public"]["Tables"]["practice_sessions"]["Insert"];
export type DailyPracticeStat = Database["public"]["Tables"]["user_daily_stats"]["Row"];

export type PracticeCompletionMood = "better" | "same" | "worse";

export interface RecordPracticeSessionInput {
  userId: string;
  practiceId?: string | null;
  practiceSlug: string;
  practiceVersion?: number;
  startedAt: string;
  endedAt: string;
  selfRating?: -1 | 0 | 1 | null;
  completionPct?: number | null;
  metrics?: Json | null;
  chakraFocusIds?: number[];
  context?: Json | null;
}

export async function recordPracticeSession(input: RecordPracticeSessionInput): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const row: PracticeSessionInsert = {
    user_id: input.userId,
    practice_id: input.practiceId ?? null,
    practice_slug: input.practiceSlug,
    practice_version: input.practiceVersion ?? 1,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    self_rating: input.selfRating ?? null,
    completion_pct: input.completionPct ?? 100,
    metrics: input.metrics ?? {},
    chakra_focus_ids: input.chakraFocusIds ?? [],
    context: input.context ?? {},
  };

  const { data, error } = await supabase.from("practice_sessions").insert(row).select("id").single();
  if (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[practiceSessions] failed to record practice session", error.message);
    }
    return null;
  }
  // Stale Day cache/prefetch/in-memory still shows pending practice cards until network refresh.
  markDayPlanStale();
  clearPrefetchedDayPlan();
  void clearCachedDayPlan({ userId: input.userId, locale: getResponseLocale() });
  return data.id;
}

export async function loadDailyPracticeStats(userId: string, limit = 14): Promise<DailyPracticeStat[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("user_daily_stats")
    .select("user_id,local_date,total_practice_seconds,practice_count,chakras_touched,updated_at")
    .eq("user_id", userId)
    .order("local_date", { ascending: false })
    .limit(limit);

  if (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[practiceSessions] failed to load daily stats", error.message);
    }
    return [];
  }

  return data ?? [];
}

export function selfRatingFromMood(mood: PracticeCompletionMood | null): -1 | 0 | 1 | null {
  if (mood === "better") return 1;
  if (mood === "same") return 0;
  if (mood === "worse") return -1;
  return null;
}
